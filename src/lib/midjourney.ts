import { z } from 'zod';

/** EvoLink V8.2 batch adapter. Submission and recovery are separate.
 * Provider contract: https://evolink.ai/api-reference/mj-v8.2/mj-v8.2-API-Reference.md
 * One request buys a batch. The shared backend preserves and publishes every candidate.
 */
export const MIDJOURNEY_MODEL = 'mj-v8.2' as const;
export interface MidjourneyRequest {
  prompt: string;
  speed?: 'fast' | 'draft';
  quality?: 'standard' | 'hd';
  aspectRatio?: string;
  imageUrls?: string[];
  imageWeight?: number;
  styleReferences?: string[];
  styleWeight?: number;
  stylize?: number;
  chaos?: number;
  seed?: number;
  raw?: boolean;
  detail?: 1 | 2 | 3 | 4;
  negativePrompt?: string;
}
const requestSchema = z.object({
  prompt: z.string(), speed: z.enum(['fast', 'draft']).optional(), quality: z.enum(['standard', 'hd']).optional(),
  aspectRatio: z.string().optional(), imageUrls: z.array(z.string()).optional(), imageWeight: z.number().optional(),
  styleReferences: z.array(z.string()).optional(), styleWeight: z.number().optional(), stylize: z.number().optional(),
  chaos: z.number().optional(), seed: z.number().optional(), raw: z.boolean().optional(), detail: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  negativePrompt: z.string().optional(),
}).strict();
export interface MidjourneyTask {
  taskId: string;
  model: typeof MIDJOURNEY_MODEL;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  images: { index: number; url: string }[];
  providerCostUsd?: number;
  creditsReserved?: number;
  creditsUsed?: number;
  providerDurationSeconds?: number;
  errorCode?: string;
}
export class MidjourneyRequestError extends Error {
  constructor(message: string, public readonly outcome: 'not_submitted' | 'unknown' | 'rejected' | 'query_failed', public readonly taskId?: string) {
    super(message);
    this.name = 'MidjourneyRequestError';
  }
}
function invalid(message: string): never {
  throw new MidjourneyRequestError(message, 'not_submitted');
}
function publicImageUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid('Midjourney references require public HTTPS image URLs.'); }
  const host = url.hostname.toLowerCase();
  if (value.length > 1024 || url.protocol !== 'https:' || url.username || url.password || url.port
    || host === 'localhost' || !host.includes('.') || host.endsWith('.local')
    || /^[\d.]+$/.test(host) || host.includes(':') || /\s/.test(value)) {
    return invalid('Midjourney references require public HTTPS image URLs without embedded credentials.');
  }
  return url.href;
}
function integer(value: number | undefined, min: number, max: number, name: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) invalid(`${name} must be an integer between ${min} and ${max}.`);
}
/** Structured parameters prevent version/speed/HD ambiguity and unsupported Edit claims. */
export function buildMidjourneyRequest(input: MidjourneyRequest) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) invalid('Invalid Midjourney input field or field type. Use the adapter request schema.');
  input = parsed.data;
  const text = input.prompt.trim();
  if (!text || [...text].length > 1024) invalid('Midjourney description must contain 1–1024 characters.');
  // CLI JSON is also an untyped input boundary. Fail before any paid request.
  if (input.speed !== undefined && !['fast', 'draft'].includes(input.speed)) invalid('Midjourney speed must be fast or draft.');
  if (input.quality !== undefined && !['standard', 'hd'].includes(input.quality)) invalid('Midjourney quality must be standard or hd.');
  if (/--[a-z]/i.test(text)) invalid('Use structured Midjourney fields instead of native --parameters in the description.');
  if (input.speed === 'draft' && input.quality === 'hd') invalid('Midjourney Draft cannot be combined with HD.');
  if ((input.imageUrls?.length ?? 0) > 20) invalid('Midjourney accepts at most 20 image prompts.');
  if ((input.styleReferences?.length ?? 0) > 20) invalid('Midjourney accepts at most 20 style references.');
  integer(input.styleWeight, 0, 1000, 'styleWeight');
  integer(input.stylize, 0, 1000, 'stylize');
  integer(input.chaos, 0, 100, 'chaos');
  integer(input.seed, 0, 4294967295, 'seed');
  integer(input.detail, 1, 4, 'detail');
  if (input.styleWeight !== undefined && !input.styleReferences?.length) invalid('styleWeight requires a style reference.');
  if (input.imageWeight !== undefined && (!input.imageUrls?.length || !Number.isFinite(input.imageWeight) || input.imageWeight < 0 || input.imageWeight > 3)) invalid('imageWeight requires an image prompt and a value between 0 and 3.');
  if (input.negativePrompt !== undefined && (!input.negativePrompt.trim() || /--[a-z]/i.test(input.negativePrompt))) invalid('negativePrompt must be text without native --parameters.');
  const images = (input.imageUrls ?? []).map(publicImageUrl);
  const styles = (input.styleReferences ?? []).map(value => /^\d{1,12}$/.test(value) ? value : publicImageUrl(value));
  const parts = [...images, text];
  if (input.aspectRatio) {
    const match = /^(\d+):(\d+)$/.exec(input.aspectRatio);
    const ratio = match ? Number(match[1]) / Number(match[2]) : NaN;
    const max = input.quality === 'hd' ? 4 : 14;
    if (!Number.isFinite(ratio) || ratio < 1 / max || ratio > max) invalid(`Midjourney aspect ratio must be between 1:${max} and ${max}:1.`);
    parts.push(`--ar ${input.aspectRatio}`);
  }
  if (styles.length) parts.push(`--sref ${styles.join(' ')}`);
  if (input.styleWeight !== undefined) parts.push(`--sw ${input.styleWeight}`);
  if (input.imageWeight !== undefined) parts.push(`--iw ${input.imageWeight}`);
  if (input.stylize !== undefined) parts.push(`--s ${input.stylize}`);
  if (input.chaos !== undefined) parts.push(`--chaos ${input.chaos}`);
  if (input.seed !== undefined) parts.push(`--seed ${input.seed}`);
  if (input.detail !== undefined) parts.push(`--q ${input.detail}`);
  if (input.raw) parts.push('--raw');
  if (input.negativePrompt) parts.push(`--no ${input.negativePrompt.trim()}`);
  const prompt = parts.join(' ');
  if ([...prompt].length > 2048) invalid('Midjourney prompt including URLs and parameters exceeds 2048 characters.');
  return { model: MIDJOURNEY_MODEL, prompt, quality: input.quality ?? 'standard', model_params: { speed: input.speed ?? 'fast' } };
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function taskId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid Midjourney task ID.');
  return value;
}
function parseTask(data: any, expectedId?: string): MidjourneyTask {
  const id = taskId(data?.id);
  if (expectedId && id !== expectedId) throw new Error('Provider returned a different task ID.');
  if (data?.model !== MIDJOURNEY_MODEL) throw new Error('Provider did not confirm the requested V8.2 model.');
  if (!['pending', 'processing', 'completed', 'failed'].includes(data?.status)) throw new Error('Unrecognized Midjourney task status.');
  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length > 24) throw new Error('Unexpected Midjourney batch size.');
  const images = results.map((url: string, index: number) => ({ index, url: publicImageUrl(url) }));
  if (data.status === 'completed' && !images.length) throw new Error('Completed Midjourney task has no image results.');
  const errorCode = typeof data.error?.code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(data.error.code) ? data.error.code : undefined;
  return {
    taskId: id, model: MIDJOURNEY_MODEL, status: data.status,
    progress: optionalNumber(data.progress), images,
    providerCostUsd: optionalNumber(data.usage?.cost?.usd),
    creditsReserved: optionalNumber(data.usage?.credits_reserved),
    creditsUsed: optionalNumber(data.usage?.credits_used), errorCode,
    providerDurationSeconds: optionalNumber(data.duration),
  };
}
/** POST is never retried. Persist the returned receipt before polling or publishing. */
export class MidjourneyClient {
  constructor(private readonly apiKey = process.env.EVOLINK_API_KEY?.trim(), private readonly request: typeof fetch = fetch) {}
  private headers() {
    if (!this.apiKey) invalid('Midjourney requires EVOLINK_API_KEY.');
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }
  async submit(input: MidjourneyRequest): Promise<MidjourneyTask> {
    const body = buildMidjourneyRequest(input);
    const headers = this.headers();
    let response: Response;
    try {
      response = await this.request('https://api.evolink.ai/v1/images/generations', {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new MidjourneyRequestError('Midjourney submission outcome is unknown. Do not automatically resubmit or switch models.', 'unknown');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // Provider messages can echo private prompts/URLs. Report only HTTP status.
      throw new MidjourneyRequestError(`Midjourney submission returned HTTP ${response.status}. No automatic retry.`, response.status >= 500 ? 'unknown' : 'rejected');
    }
    let recoverableId: string | undefined;
    try { recoverableId = taskId(data?.id); } catch { /* No recoverable receipt. */ }
    try { return parseTask(data); } catch {
      throw new MidjourneyRequestError('Midjourney submission returned an invalid receipt. Do not resubmit; recover the existing task if its ID is available.', 'unknown', recoverableId);
    }
  }
  async get(id: string): Promise<MidjourneyTask> {
    const safeId = taskId(id);
    try {
      const response = await this.request(`https://api.evolink.ai/v1/tasks/${safeId}`, {
        headers: this.headers(), redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseTask(await response.json(), safeId);
    } catch {
      throw new MidjourneyRequestError('Midjourney status could not be read. Query the same task again; do not create another generation.', 'query_failed', safeId);
    }
  }
}
