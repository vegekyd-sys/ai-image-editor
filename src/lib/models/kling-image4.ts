import sharp from 'sharp';
import { providerCostToCredits } from '../billing/token-rates';
import { validateImageModelRequest } from '../image-model-capabilities';
import { readProviderImage } from '../provider-image-preflight';
import type { GenerateImageRequest, ModelBackend } from './types';

export const KLING_IMAGE4_MODEL = 'kling-image-4.0';
const FAMILY = 'https://queue.fal.run/kling/v4';
const UNIT_PRICE = 0.063;
// Measured fal billable units, NOT Kling native Units. See the candidate report.
const OUTPUT_UNITS: Record<string, number> = { '2K': 1, '4K': 1.4921, '8K': 2.4921 };
export interface KlingImage4Receipt {
  taskId: string;
  provider: 'fal';
  providerModel: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  billableUnits?: number;
  providerCostUsd?: number;
  failure?: string;
}
export class KlingImage4RequestError extends Error {
  constructor(message: string, public readonly taskId?: string) {
    super(`Kling Image 4.0: ${message}${taskId ? ` Task: ${taskId}. Query only this task.` : ''} No automatic resubmission or provider/model fallback.`);
  }
}

/** Admission estimate with a rounding margin; final debit uses the fal response header. */
export function estimateKlingImage4Credits(options: { imageResolution?: string; imageInputCount?: number }, markup: number): number {
  const units = OUTPUT_UNITS[options.imageResolution ?? '2K'];
  const inputs = options.imageInputCount ?? 0;
  if (units === undefined || !Number.isInteger(inputs) || inputs < 0 || inputs > 10 || !Number.isFinite(markup) || markup <= 0) throw new Error('Invalid Kling Image 4.0 quote inputs');
  return providerCostToCredits((units + inputs * 0.0477 + 0.0001) * UNIT_PRICE, markup);
}

export function buildKlingImage4Request(req: GenerateImageRequest) {
  validateImageModelRequest(req, KLING_IMAGE4_MODEL);
  if (!req.prompt.trim() || req.prompt.length > 50_000) throw new KlingImage4RequestError('Prompt must contain 1–50000 characters; nothing was submitted.');
  const images = [req.image, ...(req.references ?? []).map(ref => ref.url)].filter((url): url is string => Boolean(url));
  for (const source of images) {
    let url: URL;
    try { url = new URL(source); } catch { throw new KlingImage4RequestError('Upload inputs as public HTTPS originals first; nothing was submitted.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new KlingImage4RequestError('Inputs require public HTTPS originals; nothing was submitted.');
  }
  return {
    endpoint: `kling/v4/${images.length ? 'image-to-image' : 'text-to-image'}`,
    body: { prompt: req.prompt, resolution: req.imageResolution ?? '2K', aspect_ratio: req.aspectRatio ?? (images.length ? 'auto' : '1:1'), result_type: 'single', num_images: 1, sync_mode: false, ...(images.length ? { image_urls: images } : {}) },
  };
}

function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value); }
function reason(value: unknown): string {
  return (typeof value === 'string' ? value : JSON.stringify(value) ?? '').replace(/https?:\/\/\S+|data:\S+|(?:Bearer|Key)\s+\S+/gi, '[redacted]').slice(0, 700);
}
function headers() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new KlingImage4RequestError('FAL_KEY is not configured; nothing was submitted.');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}
async function getJson(url: string, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { headers: headers(), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 500)); continue; }
      return { response, data: await response.json().catch(() => null) };
    } catch (error) {
      if (signal?.aborted || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

/** Recovery is GET-only, with a fixed origin and validated task ID. */
export async function queryKlingImage4Task(taskId: string, signal?: AbortSignal) {
  if (!validId(taskId)) throw new KlingImage4RequestError('Invalid task ID; nothing was submitted.');
  const status = await getJson(`${FAMILY}/requests/${taskId}/status`, signal);
  if (!status.response.ok || !['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(status.data?.status)) throw new KlingImage4RequestError(`Status query HTTP ${status.response.status}; task outcome remains unknown.`, taskId);
  if (status.data.request_id !== taskId) throw new KlingImage4RequestError('Mismatched status receipt.', taskId);
  if (status.data.status !== 'COMPLETED') return { status: status.data.status as 'IN_QUEUE' | 'IN_PROGRESS' };
  const { response, data } = await getJson(`${FAMILY}/requests/${taskId}`, signal);
  if (!response.ok) return { status: 'FAILED' as const, failure: `HTTP ${response.status}: ${reason(data?.detail ?? data?.error ?? data)}` };
  const rawUnits = response.headers.get('x-fal-billable-units');
  const units = rawUnits === null ? NaN : Number(rawUnits);
  if (!Number.isFinite(units) || units <= 0) throw new KlingImage4RequestError('Completed task has no valid billable-units receipt; retain the task for reconciliation.', taskId);
  if (!Array.isArray(data?.images) || data.images.length !== 1 || typeof data.images[0]?.url !== 'string') throw new KlingImage4RequestError('Expected exactly one image in the completed result.', taskId);
  return { status: 'COMPLETED' as const, outputUrl: data.images[0].url as string, billableUnits: units, providerCostUsd: Number((units * UNIT_PRICE).toFixed(8)) };
}

export const klingImage4Backend: ModelBackend = {
  id: KLING_IMAGE4_MODEL,
  canHandle: () => Boolean(process.env.FAL_KEY?.trim()),
  async generate(req) {
    const { endpoint, body } = buildKlingImage4Request(req);
    const auth = headers();
    for (const source of body.image_urls ?? []) {
      try {
        const bytes = await readProviderImage(source, 30 * 1024 * 1024, { falAsset: true });
        const meta = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
        const width = meta.width ?? 0, height = meta.height ?? 0;
        if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || width < 300 || height < 300 || width / height < 0.4 || width / height > 2.5 || (meta.pages ?? 1) !== 1) throw new Error('invalid input');
      } catch { throw new KlingImage4RequestError('Each input must be a readable still PNG/JPEG/WebP, ≤30MiB, dimensions ≥300px and ratio 0.4–2.5; nothing was submitted.'); }
    }
    const pricing = await getJson(`https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, req.signal);
    const rate = pricing.data?.prices?.find((item: { endpoint_id?: string }) => item.endpoint_id === endpoint);
    if (!pricing.response.ok || rate?.currency !== 'USD' || rate?.unit !== 'units' || rate?.unit_price !== UNIT_PRICE) throw new KlingImage4RequestError('Supplier tariff changed or is unavailable; nothing was submitted. Refresh the candidate quote first.');
    if (req.signal?.aborted || (req.deadlineMs !== undefined && Date.now() >= req.deadlineMs)) throw new KlingImage4RequestError('Cancelled before submission; nothing was submitted.');
    await req.beforeKlingImage4Submit?.({ endpoint, body });
    const started = Date.now();
    let taskId: string | undefined;
    let receipt: KlingImage4Receipt | undefined;
    const save = async () => {
      if (!receipt) return;
      try { await req.onKlingImage4Receipt?.(receipt); }
      catch { throw new KlingImage4RequestError('Receipt persistence failed; retain the accepted task for recovery.', taskId); }
    };
    try {
      // Exactly one paid POST. Transport errors are not evidence of rejection.
      const submission = await fetch(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers: auth, body: JSON.stringify(body), redirect: 'error', signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
      const task = await submission.json().catch(() => null);
      if (validId(task?.request_id)) taskId = task.request_id;
      if (!submission.ok || !taskId) throw new KlingImage4RequestError(`Submission HTTP ${submission.status}: ${reason(task?.detail ?? task?.error ?? 'unknown submission outcome')}`, taskId);
      receipt = { taskId, provider: 'fal', providerModel: endpoint, status: 'IN_QUEUE' };
      await save();
      const deadline = Math.min(req.deadlineMs ?? Infinity, started + 300_000);
      while (Date.now() < deadline && !req.signal?.aborted) {
        const state = await queryKlingImage4Task(taskId, req.signal);
        receipt = { ...receipt, status: state.status, ...('billableUnits' in state ? { billableUnits: state.billableUnits, providerCostUsd: state.providerCostUsd } : {}), ...('failure' in state ? { failure: state.failure } : {}) };
        if (state.status === 'FAILED') { await save(); throw new KlingImage4RequestError(state.failure, taskId); }
        if (state.status === 'COMPLETED') {
          await save();
          const url = new URL(state.outputUrl);
          if (url.protocol !== 'https:' || !url.hostname.endsWith('.fal.media') || url.username || url.password) throw new Error('Unexpected output host');
          const bytes = await readProviderImage(url.href, 200 * 1024 * 1024, { falAsset: true });
          const output = sharp(bytes, { failOn: 'error', limitInputPixels: 70_000_000 });
          const meta = await output.metadata();
          const side = { '2K': 2048, '4K': 4096, '8K': 8192 }[body.resolution];
          if (!side || meta.format !== 'png' || (meta.pages ?? 1) !== 1 || Math.max(meta.width ?? 0, meta.height ?? 0) < side) throw new Error('Unexpected output format or native resolution');
          if (req.background === 'opaque' && meta.hasAlpha && (await output.clone().stats()).channels.at(-1)!.min !== 255) throw new Error('Unexpected transparent pixels');
          // Decode a bounded thumbnail to verify the entire compressed stream without a 268MB raw allocation.
          await output.resize({ width: 32, height: 32, fit: 'inside' }).raw().toBuffer();
          console.log(`[kling-image-4.0] provider=fal endpoint=${endpoint} task=${taskId} units=${state.billableUnits} costUsd=${state.providerCostUsd} totalMs=${Date.now() - started} size=${meta.width}x${meta.height}`);
          return { image: `data:image/png;base64,${bytes.toString('base64')}`, taskId, provider: 'fal', usage: { modelId: KLING_IMAGE4_MODEL, inputTokens: 0, outputTokens: 0, provider: 'fal', providerCostUsd: state.providerCostUsd } };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new KlingImage4RequestError('Polling deadline reached; the paid task may still be running.', taskId);
    } catch (error) {
      if (error instanceof KlingImage4RequestError) throw error;
      throw new KlingImage4RequestError('Submission, query or output retrieval failed; preserve this attempt and query the existing task before any new generation.', taskId);
    }
  },
};
