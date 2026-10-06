import sharp from 'sharp';
import type { GenerateImageRequest, ModelBackend } from './types';

export const NANO_BANANA_21_MODEL = 'google/gemini-nano-banana-2.1';
const RATIOS = ['auto', '1:1', '3:2', '2:3', '3:4', '1:4', '4:1', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9'];

export class NanoBanana21RequestError extends Error {
  constructor(message: string, public readonly contentBlocked = false) { super(message); }
}

export function buildNanoBanana21Request(req: GenerateImageRequest) {
  const images = [...(req.image ? [{ url: req.image, role: 'Base image to edit' }] : []), ...(req.references ?? [])];
  if (!req.prompt.trim()) throw new NanoBanana21RequestError('Nano Banana 2.1 requires a non-empty prompt.');
  if (images.length > 14) throw new NanoBanana21RequestError('Nano Banana 2.1 supports at most 14 input images, including the base.');
  const aspectRatio = req.aspectRatio ?? 'auto';
  if (!RATIOS.includes(aspectRatio)) throw new NanoBanana21RequestError('Unsupported Nano Banana 2.1 aspect ratio.');
  const resolution = req.imageResolution ?? '1K';
  if (!['1K', '2K', '4K'].includes(resolution)) throw new NanoBanana21RequestError('Nano Banana 2.1 requires 1K, 2K or 4K resolution.');
  if (req.background === 'transparent') throw new NanoBanana21RequestError('Nano Banana 2.1 does not guarantee transparent output.');
  const inputReferences = images.map(image => {
    let url = image.url;
    if (!url.startsWith('data:') && !url.startsWith('https://')) {
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(url)) throw new NanoBanana21RequestError('Input images require HTTPS URLs or base64 image data.');
      url = `data:image/jpeg;base64,${url}`;
    }
    if (url.startsWith('https://')) {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) throw new NanoBanana21RequestError('Input image URLs must not contain credentials.');
    } else if (!/^data:image\/(png|jpeg|webp|heic|heif);base64,[A-Za-z0-9+/=\r\n]+$/.test(url)) {
      throw new NanoBanana21RequestError('Unsupported input image format.');
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
    try {
      // One paid submission. Do not repeat an uncertain outcome or discard references.
      const response = await fetch('https://openrouter.ai/api/v1/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240000),
        redirect: 'error',
      });
      const data = await response.json();
      requestId = typeof data.id === 'string' ? data.id : undefined;
      if (!response.ok || data.error) {
        const blocked = data.error?.metadata?.block_reason === 'PROHIBITED_CONTENT'
          || data.error?.metadata?.finish_reason === 'PROHIBITED_CONTENT'
          || data.error?.metadata?.error_type === 'content_policy_violation';
        throw new NanoBanana21RequestError(`Nano Banana 2.1 provider rejected the request (HTTP ${response.status}).`, blocked);
      }
      const images = data.data;
      if (!Array.isArray(images) || images.length !== 1) throw new NanoBanana21RequestError('Nano Banana 2.1 returned no single completed image.');
      const mediaType = images[0]?.media_type;
      const base64 = images[0]?.b64_json;
      if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64) || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) throw new NanoBanana21RequestError('Nano Banana 2.1 returned an unsupported image payload.');
      const usage = data.usage;
      if (!usage || !Number.isFinite(usage.cost) || usage.cost <= 0
        || !Number.isInteger(usage.prompt_tokens) || usage.prompt_tokens < 0
        || !Number.isInteger(usage.completion_tokens) || usage.completion_tokens < 0) {
        throw new NanoBanana21RequestError('Nano Banana 2.1 returned no valid supplier usage/cost. Inspect the provider request before resubmitting.');
      }
      const url = `data:${mediaType};base64,${base64}`;
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 50 * 1024 * 1024) throw new NanoBanana21RequestError('Nano Banana 2.1 output exceeds the image size limit.');
      // Decode the entire output before publishing it; keep the generated canvas and format.
      await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).raw().toBuffer();
      console.log(`[gemini-2.1] provider=openrouter request=${requestId ?? 'unknown'} costUsd=${usage.cost}`);
      return { image: url, provider: 'openrouter', usage: {
        modelId: NANO_BANANA_21_MODEL, inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens, providerCostUsd: usage.cost, provider: 'openrouter',
      } };
    } catch (error) {
      const reason = error instanceof NanoBanana21RequestError ? error.message : 'Nano Banana 2.1 request did not complete; provider outcome may be unknown.';
      throw new NanoBanana21RequestError(`${reason}${requestId ? ` Request: ${requestId}.` : ''} No automatic retry or model fallback.`, error instanceof NanoBanana21RequestError && error.contentBlocked);
    }
  },
};
