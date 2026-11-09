import sharp from 'sharp';
import { validateImageModelRequest } from '../image-model-capabilities';
import { readProviderImage } from '../provider-image-preflight';
import type { GenerateImageRequest, ModelBackend } from './types';

export const SEEDREAM55_MODEL = 'seedream-5.5';
export const SEEDREAM55_PROVIDER_MODEL = 'bytedance/seedream-v5.5';
const API = 'https://api.wavespeed.ai/api/v3';
const OUTPUT_PRICES: Record<string, number> = { '1K': 0.02, '1.5K': 0.02, '2K': 0.027, '3K': 0.054 };
export interface Seedream55Receipt {
  taskId: string;
  provider: 'wavespeed';
  model: string;
  status: string;
}
export class Seedream55RequestError extends Error {
  constructor(message: string, public readonly taskId?: string) {
    super(`Seedream 5.5: ${message}${taskId ? ` Task: ${taskId}. Query this task only.` : ''} No automatic resubmission or provider/model switch.`);
  }
}

/** Published fixed tariff, not a provider invoice. Inputs include the base and every reference. */
export function seedream55CostUsd(resolution = '1K', inputCount = 0): number {
  const price = OUTPUT_PRICES[resolution];
  if (price === undefined || !Number.isInteger(inputCount) || inputCount < 0 || inputCount > 10) throw new Error('Invalid Seedream 5.5 pricing inputs');
  return Number((price + inputCount * 0.008).toFixed(3));
}
export function estimateSeedream55Credits(options: { imageResolution?: string; imageInputCount?: number }, markup: number): number {
  if (!Number.isFinite(markup) || markup <= 0) throw new Error('Invalid Seedream 5.5 markup');
  return Math.ceil(seedream55CostUsd(options.imageResolution, options.imageInputCount) * markup / 0.01);
}
export function buildSeedream55Request(req: GenerateImageRequest) {
  validateImageModelRequest(req, SEEDREAM55_MODEL);
  if (!req.prompt.trim()) throw new Seedream55RequestError('A non-empty prompt is required; nothing was submitted.');
  const images = [req.image, ...(req.references ?? []).map(ref => ref.url)].filter((s): s is string => Boolean(s));
  const model = `${SEEDREAM55_PROVIDER_MODEL}${images.length ? '/edit' : ''}`;
  return { model, body: {
    prompt: req.prompt,
    ...(images.length ? { images } : {}),
    ...(req.aspectRatio && req.aspectRatio !== 'auto' ? { aspect_ratio: req.aspectRatio } : images.length ? {} : { aspect_ratio: '1:1' }),
    resolution: (req.imageResolution ?? '1K').toLowerCase(),
    output_format: req.outputFormat ?? 'png',
    background: req.background ?? 'auto',
  }, costUsd: seedream55CostUsd(req.imageResolution, images.length) };
}
function validTaskId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id); }
function parseTask(data: unknown, expectedId?: string): Seedream55Receipt & { outputs: string[] } {
  const task = data as { id?: unknown; model?: unknown; status?: unknown; outputs?: unknown } | null;
  if (!task || !validTaskId(task.id) || (expectedId && task.id !== expectedId)
    || ![SEEDREAM55_PROVIDER_MODEL, `${SEEDREAM55_PROVIDER_MODEL}/edit`].includes(String(task.model))
    || !['created', 'pending', 'queued', 'processing', 'completed', 'failed', 'cancelled', 'timeout', 'deleted'].includes(String(task.status))) {
    throw new Seedream55RequestError('Invalid or mismatched provider receipt; the paid outcome may be unknown.', expectedId);
  }
  return { taskId: task.id, provider: 'wavespeed', model: String(task.model), status: String(task.status), outputs: Array.isArray(task.outputs) ? task.outputs.filter((v): v is string => typeof v === 'string') : [] };
}

/** Read-only recovery. Never creates a prediction. Keep its receipt private to the owned project. */
export async function querySeedream55Task(taskId: string): Promise<ReturnType<typeof parseTask>> {
  if (!validTaskId(taskId)) throw new Seedream55RequestError('Invalid task ID; no request sent.');
  const key = process.env.WAVESPEED_API_KEY?.trim();
  if (!key) throw new Seedream55RequestError('WAVESPEED_API_KEY is not configured.', taskId);
  let response: Response;
  try { response = await fetch(`${API}/predictions/${taskId}/result`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Seedream55RequestError('Task query transport failed; the task may still be running.', taskId); }
  if (!response.ok) throw new Seedream55RequestError(`Task query HTTP ${response.status}; inspect the same task before any new submission.`, taskId);
  const payload = await response.json().catch(() => null);
  if (!payload || payload.code !== 200) throw new Seedream55RequestError('Task query returned no valid result.', taskId);
  return parseTask(payload.data, taskId);
}

export const seedream55Backend: ModelBackend = {
  id: SEEDREAM55_MODEL,
  canHandle: () => Boolean(process.env.WAVESPEED_API_KEY?.trim()),
  async generate(req) {
    const key = process.env.WAVESPEED_API_KEY?.trim();
    if (!key) throw new Seedream55RequestError('WAVESPEED_API_KEY is not configured; nothing was submitted.');
    const { model, body, costUsd } = buildSeedream55Request(req);
    // Reject inaccessible or corrupt references before a paid POST. Do not flatten input alpha.
    for (const source of body.images ?? []) {
      await sharp(await readProviderImage(source, 30 * 1024 * 1024), { limitInputPixels: 64_000_000 }).metadata();
    }
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${API}/${model}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new Seedream55RequestError('Submission transport failed; a billed task may already exist. Check provider History before any new submission.'); }
    const payload = await response.json().catch(() => null);
    const recoverableId = validTaskId(payload?.data?.id) ? payload.data.id : undefined;
    if (!response.ok || payload?.code !== 200) throw new Seedream55RequestError(`Submission HTTP ${response.status}; provider rejected or did not confirm the request.`, recoverableId);
    let task = parseTask(payload.data, recoverableId);
    if (task.model !== model) throw new Seedream55RequestError('Provider model differs from the submitted endpoint.', task.taskId);
    try { await req.onSeedream55Receipt?.({ taskId: task.taskId, provider: task.provider, model: task.model, status: task.status }); }
    catch { throw new Seedream55RequestError('Accepted task receipt could not be saved; polling stopped to avoid losing recovery state.', task.taskId); }
    while (task.status !== 'completed') {
      if (['failed', 'cancelled', 'timeout', 'deleted'].includes(task.status)) throw new Seedream55RequestError(`Provider task ended: ${task.status}.`, task.taskId);
      if (Date.now() - started > 240_000) throw new Seedream55RequestError('Polling deadline reached; the paid task may still be running.', task.taskId);
      await new Promise(resolve => setTimeout(resolve, 2000));
      task = await querySeedream55Task(task.taskId);
      if (task.model !== model) throw new Seedream55RequestError('Query model differs from the submitted endpoint.', task.taskId);
    }
    if (task.outputs.length !== 1) throw new Seedream55RequestError('Expected exactly one completed image.', task.taskId);
    try {
      const bytes = await readProviderImage(task.outputs[0], 50 * 1024 * 1024, { wavespeedAsset: true });
      const input = sharp(bytes, { failOn: 'error', limitInputPixels: 16_777_216 });
      const meta = await input.metadata();
      if (meta.format !== body.output_format || (meta.pages ?? 1) !== 1) throw new Error('format mismatch');
      await input.clone().raw().toBuffer();
      if (body.background === 'transparent' && (!meta.hasAlpha || (await input.clone().stats()).channels.at(-1)!.min === 255)) throw new Error('opaque result');
      console.log(`[seedream-5.5] provider=wavespeed model=${model} task=${task.taskId} totalMs=${Date.now() - started} tariffUsd=${costUsd}`);
      return { image: `data:image/${body.output_format};base64,${bytes.toString('base64')}`, taskId: task.taskId, provider: 'wavespeed', usage: { modelId: SEEDREAM55_MODEL, inputTokens: 0, outputTokens: 0, provider: 'wavespeed', providerCostUsd: costUsd } };
    } catch { throw new Seedream55RequestError('Completed output could not be downloaded/decoded or did not satisfy format/alpha. Query the existing result; do not regenerate.', task.taskId); }
  },
};
