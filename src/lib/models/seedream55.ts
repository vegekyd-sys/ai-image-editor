import sharp from 'sharp';
import { providerCostToCredits } from '../billing/token-rates';
import { validateImageModelRequest } from '../image-model-capabilities';
import { readProviderImage } from '../provider-image-preflight';
import type { GenerateImageRequest, ModelBackend } from './types';

export const SEEDREAM55_MODEL = 'seedream-5.5';
export const SEEDREAM55_PROVIDER_MODEL = 'doubao-seedream-5.5';
const API = 'https://api.evolink.ai/v1';
const OUTPUT_PRICES: Record<string, number> = { '1K': 0.016, '1.5K': 0.016, '2K': 0.028 };
export interface Seedream55Receipt {
  taskId: string;
  provider: 'evolink';
  model: string;
  status: string;
  providerCreditsReserved?: number;
  providerCreditsUsed?: number;
}
export class Seedream55RequestError extends Error {
  constructor(message: string, public readonly taskId?: string) {
    super(`Seedream 5.5: ${message}${taskId ? ` Task: ${taskId}. Query this task only.` : ''} No automatic resubmission or provider/model switch.`);
  }
}

/** Published fixed tariff, not a provider invoice. Count base plus all references. */
export function seedream55CostUsd(resolution = '1K', inputCount = 0): number {
  const price = OUTPUT_PRICES[resolution];
  if (price === undefined || !Number.isInteger(inputCount) || inputCount < 0 || inputCount > 10) throw new Error('Invalid Seedream 5.5 pricing inputs');
  return Number((price + inputCount * 0.0064).toFixed(4));
}
export function estimateSeedream55Credits(options: { imageResolution?: string; imageInputCount?: number }, markup: number): number {
  if (!Number.isFinite(markup) || markup <= 0) throw new Error('Invalid Seedream 5.5 markup');
  return providerCostToCredits(seedream55CostUsd(options.imageResolution, options.imageInputCount), markup);
}
export function buildSeedream55Request(req: GenerateImageRequest) {
  validateImageModelRequest(req, SEEDREAM55_MODEL);
  if (!req.prompt.trim()) throw new Seedream55RequestError('A non-empty prompt is required; nothing was submitted.');
  const images = [req.image, ...(req.references ?? []).map(ref => ref.url)].filter((s): s is string => Boolean(s));
  // EvoLink requires remotely accessible originals; chat uploads already supply these.
  for (const source of images) {
    let url: URL;
    try { url = new URL(source); } catch { throw new Seedream55RequestError('Inputs require public HTTPS image URLs; upload local originals first. Nothing was submitted.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Seedream55RequestError('Inputs require public HTTPS image URLs. Nothing was submitted.');
  }
  return { model: SEEDREAM55_PROVIDER_MODEL, body: {
    model: SEEDREAM55_PROVIDER_MODEL, prompt: req.prompt,
    ...(images.length ? { image_urls: images } : {}),
    size: req.aspectRatio && req.aspectRatio !== 'auto' ? req.aspectRatio : images.length ? 'auto' : '1:1',
    quality: req.imageResolution ?? '1K', prompt_priority: 'standard',
    output_format: req.outputFormat ?? 'png', background: req.background ?? 'auto', watermark: false,
  }, costUsd: seedream55CostUsd(req.imageResolution, images.length) };
}
function validTaskId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id); }
function safeReason(value: unknown): string {
  return typeof value === 'string' ? value.replace(/https?:\/\/\S+|data:\S+|Bearer\s+\S+/gi, '[redacted]').slice(0, 400) : '';
}
function parseTask(data: unknown, expectedId?: string): Seedream55Receipt & { outputs: string[]; failure?: string } {
  const task = data as { id?: unknown; model?: unknown; status?: unknown; results?: unknown; error?: { code?: unknown; message?: unknown }; usage?: { credits_reserved?: number; credits_used?: number } } | null;
  if (!task || !validTaskId(task.id) || (expectedId && task.id !== expectedId) || task.model !== SEEDREAM55_PROVIDER_MODEL
    || !['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(String(task.status))) {
    throw new Seedream55RequestError('Invalid or mismatched provider receipt; the paid outcome may be unknown.', expectedId);
  }
  return { taskId: task.id, provider: 'evolink', model: task.model, status: String(task.status),
    ...(Number.isFinite(task.usage?.credits_reserved) ? { providerCreditsReserved: task.usage!.credits_reserved } : {}),
    ...(Number.isFinite(task.usage?.credits_used) ? { providerCreditsUsed: task.usage!.credits_used } : {}),
    outputs: Array.isArray(task.results) ? task.results.filter((v): v is string => typeof v === 'string') : [],
    ...(task.error ? { failure: `${safeReason(task.error.code)} ${safeReason(task.error.message)}`.trim() } : {}),
  };
}

/** GET only. Transient query failures may retry; paid submissions never do. */
export async function querySeedream55Task(taskId: string, signal?: AbortSignal): Promise<ReturnType<typeof parseTask>> {
  if (!validTaskId(taskId)) throw new Seedream55RequestError('Invalid task ID; no request sent.');
  const key = process.env.EVOLINK_API_KEY?.trim();
  if (!key) throw new Seedream55RequestError('EVOLINK_API_KEY is not configured.', taskId);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try { response = await fetch(`${API}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) }); }
    catch {
      if (signal?.aborted) throw new Seedream55RequestError('Task query cancelled; retain and query this task before a new request.', taskId);
      if (attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
      throw new Seedream55RequestError('Task query transport failed; the task may still be running.', taskId);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
    if (!response.ok) throw new Seedream55RequestError(`Task query HTTP ${response.status}; inspect the same task before any new submission.`, taskId);
    return parseTask(await response.json().catch(() => null), taskId);
  }
}

export const seedream55Backend: ModelBackend = {
  id: SEEDREAM55_MODEL,
  canHandle: () => Boolean(process.env.EVOLINK_API_KEY?.trim()),
  async generate(req) {
    const key = process.env.EVOLINK_API_KEY?.trim();
    if (!key) throw new Seedream55RequestError('EVOLINK_API_KEY is not configured; nothing was submitted.');
    const { model, body, costUsd } = buildSeedream55Request(req);
    for (const source of body.image_urls ?? []) {
      const meta = await sharp(await readProviderImage(source, 30 * 1024 * 1024), { limitInputPixels: 36_000_000 }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '')) throw new Seedream55RequestError('Input format must be PNG, JPEG or WebP; nothing was submitted.');
      const width = meta.width ?? 0, height = meta.height ?? 0;
      if (width <= 14 || height <= 14 || width * height > 36_000_000 || width / height < 1 / 16 || width / height > 16 || (meta.pages ?? 1) !== 1) {
        throw new Seedream55RequestError('Each input must be a still image, dimensions >14px, at most 36MP and ratio 1:16–16:1; nothing was submitted.');
      }
    }
    if (req.signal?.aborted || (req.deadlineMs !== undefined && Date.now() >= req.deadlineMs)) throw new Seedream55RequestError('Request cancelled before submission; nothing was submitted.');
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${API}/images/generations`, { method: 'POST', redirect: 'error', signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new Seedream55RequestError('Submission transport failed; a billed task may already exist. Check provider History before any new submission.'); }
    const payload = await response.json().catch(() => null);
    const recoverableId = validTaskId(payload?.id) ? payload.id : undefined;
    if (!response.ok) throw new Seedream55RequestError(`Submission HTTP ${response.status}: ${safeReason(payload?.error?.code)} ${safeReason(payload?.error?.message)}`.trim(), recoverableId);
    let task = parseTask(payload, recoverableId);
    const saveReceipt = async () => {
      try { await req.onSeedream55Receipt?.({ taskId: task.taskId, provider: task.provider, model: task.model, status: task.status, providerCreditsReserved: task.providerCreditsReserved, providerCreditsUsed: task.providerCreditsUsed }); }
      catch { throw new Seedream55RequestError('Accepted task receipt could not be saved; polling stopped to retain recovery state.', task.taskId); }
    };
    await saveReceipt();
    while (task.status !== 'completed') {
      if (['failed', 'cancelled'].includes(task.status)) {
        await saveReceipt();
        throw new Seedream55RequestError(`Provider task ended: ${task.status}. ${task.failure ?? ''}`, task.taskId);
      }
      if (Date.now() - started > 240_000 || req.signal?.aborted || (req.deadlineMs !== undefined && Date.now() >= req.deadlineMs)) throw new Seedream55RequestError('Polling deadline reached; the paid task may still be running.', task.taskId);
      await new Promise(resolve => setTimeout(resolve, 2000));
      task = await querySeedream55Task(task.taskId, req.signal);
    }
    await saveReceipt();
    if (task.outputs.length !== 1) throw new Seedream55RequestError('Expected exactly one completed image.', task.taskId);
    try {
      const bytes = await readProviderImage(task.outputs[0], 50 * 1024 * 1024, { evolinkAsset: true });
      const input = sharp(bytes, { failOn: 'error', limitInputPixels: 16_777_216 });
      const meta = await input.metadata();
      if (meta.format !== body.output_format || (meta.pages ?? 1) !== 1) throw new Error('format mismatch');
      await input.clone().raw().toBuffer();
      if (body.background === 'transparent' && (!meta.hasAlpha || (await input.clone().stats()).channels.at(-1)!.min === 255)) throw new Error('opaque result');
      console.log(`[seedream-5.5] provider=evolink model=${model} task=${task.taskId} totalMs=${Date.now() - started} tariffUsd=${costUsd} size=${meta.width}x${meta.height}`);
      return { image: `data:image/${body.output_format};base64,${bytes.toString('base64')}`, taskId: task.taskId, provider: 'evolink', usage: { modelId: SEEDREAM55_MODEL, inputTokens: 0, outputTokens: 0, provider: 'evolink', providerCostUsd: costUsd } };
    } catch { throw new Seedream55RequestError('Completed output could not be downloaded/decoded or did not satisfy format/alpha. Query the existing result; do not regenerate.', task.taskId); }
  },
};
