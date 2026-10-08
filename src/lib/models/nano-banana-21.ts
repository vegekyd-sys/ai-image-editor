import { validateImageModelRequest } from '../image-model-capabilities';
import sharp from 'sharp';
import type { GenerateImageRequest, ModelBackend } from './types';
import { isImageBase64, parseImageDataUrl } from './image-data-url';

export const NANO_BANANA_21_MODEL = 'google/gemini-nano-banana-2.1';

export class NanoBanana21RequestError extends Error {
  constructor(message: string, public readonly contentBlocked = false) { super(message); }
}

export function buildNanoBanana21Request(req: GenerateImageRequest) {
  validateImageModelRequest(req, 'gemini-2.1');
  const images = [...(req.image ? [{ url: req.image, role: 'Base image to edit' }] : []), ...(req.references ?? [])];
  if (!req.prompt.trim()) throw new NanoBanana21RequestError('Nano Banana 2.1 requires a non-empty prompt.');
  const aspectRatio = req.aspectRatio ?? 'auto';
  const resolution = req.imageResolution ?? '1K';
  const inputReferences = images.map(image => {
    let url = image.url;
    if (!url.startsWith('data:') && !url.startsWith('https://')) {
      if (!isImageBase64(url)) throw new NanoBanana21RequestError('Input images require HTTPS URLs or base64 image data.');
      url = `data:image/jpeg;base64,${url}`;
    }
    if (url.startsWith('https://')) {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) throw new NanoBanana21RequestError('Input image URLs must not contain credentials.');
    } else {
      const parsed = parseImageDataUrl(url);
      if (!parsed || !['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(parsed.mimeType)) throw new NanoBanana21RequestError('Unsupported input image format.');
    }
    return { type: 'image_url', image_url: { url } };
  });
  // Image API discovery advertises the full extended-ratio and reference contract.
  // Chat completions currently rejects new 2.1 panoramic ratios in its legacy validator.
  return {
    model: NANO_BANANA_21_MODEL,
    stream: false,
    n: 1,
    resolution,
    ...(aspectRatio === 'auto' ? {} : { aspect_ratio: aspectRatio }),
    prompt: images.length ? `${images.map((image, i) => `Image ${i + 1}: ${image.role}`).join('\n')}\n\n${req.prompt}` : req.prompt,
    ...(inputReferences.length ? { input_references: inputReferences } : {}),
  };
}

export const nanoBanana21Backend: ModelBackend = {
  id: 'gemini-2.1',
  canHandle: () => Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  async generate(req) {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) throw new NanoBanana21RequestError('Nano Banana 2.1 requires OPENROUTER_API_KEY.');
    const body = buildNanoBanana21Request(req);
    let requestId: string | undefined;
    let stage = 'submission';
    let status: number | undefined;
    let contentType: string | null = null;
    let responseBytes: number | undefined;
    let firstCodePoint: number | undefined;
    const started = Date.now();
    try {
      // One paid submission. Do not repeat an uncertain outcome or discard references.
      const response = await fetch('https://openrouter.ai/api/v1/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240000),
        redirect: 'error',
      });
      status = response.status;
      contentType = response.headers.get('content-type');
      requestId = response.headers.get('x-request-id') ?? undefined;
      stage = 'response body';
      const responseText = await response.text();
      responseBytes = Buffer.byteLength(responseText);
      firstCodePoint = responseText.trimStart().codePointAt(0);
      stage = 'response JSON';
      const data = JSON.parse(responseText);
      requestId = typeof data.id === 'string' ? data.id : requestId;
      if (!response.ok || data.error) {
        const blocked = data.error?.metadata?.block_reason === 'PROHIBITED_CONTENT'
          || data.error?.metadata?.finish_reason === 'PROHIBITED_CONTENT'
          || data.error?.metadata?.error_type === 'content_policy_violation';
        throw new NanoBanana21RequestError(`Nano Banana 2.1 provider rejected the request (HTTP ${response.status}).`, blocked);
      }
      const images = data.data;
      stage = 'image payload';
      if (!Array.isArray(images) || images.length !== 1) throw new NanoBanana21RequestError('Nano Banana 2.1 returned no single completed image.');
      const mediaType = images[0]?.media_type;
      const base64 = images[0]?.b64_json;
      if (typeof base64 !== 'string' || !isImageBase64(base64) || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) throw new NanoBanana21RequestError('Nano Banana 2.1 returned an unsupported image payload.');
      const usage = data.usage;
      stage = 'supplier usage';
      if (!usage || !Number.isFinite(usage.cost) || usage.cost <= 0
        || !Number.isInteger(usage.prompt_tokens) || usage.prompt_tokens < 0
        || !Number.isInteger(usage.completion_tokens) || usage.completion_tokens < 0) {
        throw new NanoBanana21RequestError('Nano Banana 2.1 returned no valid supplier usage/cost. Inspect the provider request before resubmitting.');
      }
      const url = `data:${mediaType};base64,${base64}`;
      const buffer = Buffer.from(base64, 'base64');
      stage = 'image decode';
      if (buffer.length > 50 * 1024 * 1024) throw new NanoBanana21RequestError('Nano Banana 2.1 output exceeds the image size limit.');
      // Decode the entire output before publishing it; keep the generated canvas and format.
      await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).raw().toBuffer();
      console.log(`[gemini-2.1] provider=openrouter request=${requestId ?? 'unknown'} costUsd=${usage.cost}`);
      return { image: url, provider: 'openrouter', usage: {
        modelId: NANO_BANANA_21_MODEL, inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens, providerCostUsd: usage.cost, provider: 'openrouter',
      } };
    } catch (error) {
      // Do not log prompts, input images, response bodies or native error messages
      // (JSON parse errors can include excerpts of a base64 image).
      const code = error instanceof Error && 'cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? String(error.cause.code) : undefined;
      console.error('[gemini-2.1] failed', { stage, status, contentType, responseBytes, firstCodePoint,
        elapsedMs: Date.now() - started, requestId, resolution: body.resolution,
        errorType: error instanceof Error ? error.name : 'unknown', code: error instanceof RangeError && error.message === 'Maximum call stack size exceeded' ? 'stack_overflow' : code && /^[A-Z0-9_]+$/.test(code) ? code : undefined });
      const reason = error instanceof NanoBanana21RequestError ? error.message : `Nano Banana 2.1 request did not complete during ${stage}; provider outcome may be unknown.`;
      throw new NanoBanana21RequestError(`${reason}${requestId ? ` Request: ${requestId}.` : ''} No automatic retry or model fallback.`, error instanceof NanoBanana21RequestError && error.contentBlocked);
    }
  },
};
