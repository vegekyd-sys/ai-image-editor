import sharp from 'sharp';
import { readProviderImage } from './provider-image-preflight';

/** Same Multiple-Angles LoRA family as the former ComfyUI path, now hosted by fal. */
export const FAL_QWEN_ROTATE_ENDPOINT = 'fal-ai/qwen-image-edit-2511-multiple-angles';
const QUEUE_BASE = `https://queue.fal.run/${FAL_QWEN_ROTATE_ENDPOINT}`;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024;

export interface FalRotateInput {
  image: string;
  azimuth: number;
  elevation: number;
  distance: number;
}

export function falRotateSize(width: number, height: number): { width: number; height: number } {
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) {
    throw new Error('Camera rotation requires an image aspect ratio between 1:4 and 4:1. No request was submitted.');
  }
  // Bound output to <=1 MP so the fixed credit quote covers fal's per-MP price.
  return {
    width: Math.floor(Math.sqrt(1_000_000 * ratio) / 16) * 16,
    height: Math.floor(Math.sqrt(1_000_000 / ratio) / 16) * 16,
  };
}

export function buildFalRotateBody(input: FalRotateInput, size: { width: number; height: number }) {
  if (!Number.isFinite(input.azimuth) || input.azimuth < 0 || input.azimuth > 360
    || !Number.isFinite(input.elevation) || input.elevation < -30 || input.elevation > 60
    || !Number.isFinite(input.distance) || input.distance < 0.6 || input.distance > 1.4) {
    throw new Error('Camera angle or distance is out of range. No request was submitted.');
  }
  return {
    image_urls: [input.image],
    horizontal_angle: input.azimuth,
    vertical_angle: input.elevation,
    zoom: Math.round((1.4 - input.distance) / 0.8 * 10_000) / 1_000,
    image_size: size,
    num_images: 1,
    output_format: 'jpeg',
    enable_safety_checker: true,
  };
}

async function falJson(url: string, key: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Key ${key}` }, signal, redirect: 'error',
  });
  if (!response.ok) throw new Error(`fal camera request HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

export async function generateWithFalQwenRotate(input: FalRotateInput): Promise<{ image: string; requestId: string; durationMs: number }> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error('Camera rotation requires FAL_KEY. No request was submitted.');

  // Verify source with DNS-rebinding protection before passing a URL to fal.
  const bytes = await readProviderImage(input.image, MAX_INPUT_BYTES);
  const meta = await sharp(bytes, { failOn: 'error', limitInputPixels: 64_000_000 }).metadata();
  if (!meta.width || !meta.height || meta.width < 256 || meta.height < 256) {
    throw new Error('Camera rotation requires a valid image at least 256×256. No request was submitted.');
  }
  const providerImage = input.image.startsWith('data:')
    ? input.image
    : new URL(input.image).toString();
  const body = buildFalRotateBody({ ...input, image: providerImage }, falRotateSize(meta.width, meta.height));

  const started = Date.now();
  // Exactly one paid POST. Later errors are reported with its request ID.
  const submitted = await fetch(QUEUE_BASE, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!submitted.ok) throw new Error(`fal camera submission HTTP ${submitted.status}. No automatic retry.`);
  const task = await submitted.json() as { request_id?: unknown };
  if (typeof task.request_id !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(task.request_id)) {
    throw new Error('fal camera submission outcome unknown. Do not submit again automatically.');
  }
  const requestId = task.request_id;
  const resultUrl = `${QUEUE_BASE}/requests/${requestId}`;
  const signal = AbortSignal.timeout(240_000);
  try {
    while (true) {
      const status = await falJson(`${resultUrl}/status`, key, signal);
      if (status.status === 'COMPLETED') break;
      if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') {
        throw new Error('fal camera generation did not complete.');
      }
      await new Promise(resolve => setTimeout(resolve, 1_500));
      signal.throwIfAborted();
    }
    const result = await falJson(resultUrl, key, signal);
    const images = result.images;
    const imageUrl = Array.isArray(images) && images.length === 1 ? images[0]?.url : undefined;
    if (typeof imageUrl !== 'string') throw new Error('fal camera returned no image.');
    const outputUrl = new URL(imageUrl);
    if (outputUrl.protocol !== 'https:' || !outputUrl.hostname.endsWith('.fal.media') || outputUrl.username || outputUrl.password) {
      throw new Error('fal camera returned an unexpected output host.');
    }
    const output = await fetch(outputUrl, { signal, redirect: 'error' });
    if (!output.ok || !output.headers.get('content-type')?.startsWith('image/')) {
      throw new Error(`fal camera output unavailable (HTTP ${output.status}).`);
    }
    if (Number(output.headers.get('content-length')) > MAX_OUTPUT_BYTES) {
      throw new Error('fal camera output is too large.');
    }
    const outputBytes = Buffer.from(await output.arrayBuffer());
    if (!outputBytes.length || outputBytes.length > MAX_OUTPUT_BYTES) throw new Error('fal camera output is empty or too large.');
    const jpeg = await sharp(outputBytes, { failOn: 'error', limitInputPixels: 8_294_400 }).jpeg({ quality: 92 }).toBuffer();
    const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    console.log(`[fal-qwen-rotate] request=${requestId} totalMs=${Date.now() - started}`);
    return { image, requestId, durationMs: Date.now() - started };
  } catch (error) {
    throw new Error(`fal camera request ${requestId} did not complete. No automatic retry. ${error instanceof Error ? error.message : ''}`);
  }
}
