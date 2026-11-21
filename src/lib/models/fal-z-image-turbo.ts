import sharp from 'sharp';
import { providerCostToCredits } from '../billing/token-rates';
import { validateImageModelRequest, Z_IMAGE_TURBO_DEFAULT_FORMAT } from '../image-model-capabilities';
import { readProviderImage } from '../provider-image-preflight';
import { parseImageDataUrl } from './image-data-url';
import { ImageProviderRefusalError } from './image-provider-refusal';
import type { GenerateImageRequest, ModelBackend } from './types';

const FAL_Z_IMAGE_TURBO_ENDPOINT = 'fal-ai/z-image/turbo';

export function zImageTurboEndpoint(inputCount: number): string {
  return inputCount ? `${FAL_Z_IMAGE_TURBO_ENDPOINT}/image-to-image` : FAL_Z_IMAGE_TURBO_ENDPOINT;
}

const MODEL = 'z-image-turbo';
const MAX_EDGE = 1024;
const MIN_EDGE = 512;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Confirmed on the published fal price and the paid synchronous receipts.
const USD_PER_MEGAPIXEL = 0.005;

export class ZImageTurboRequestError extends Error {}

export function estimateZImageTurboCredits(_input: unknown, markup: number): number {
  return providerCostToCredits(USD_PER_MEGAPIXEL, markup);
}

async function prepareZImageTurboSource(source: string) {
  try {
    const inputLimit = 20 * 1024 * 1024;
    const inline = source.startsWith('data:') ? parseImageDataUrl(source) : null;
    if (source.startsWith('data:') && (!inline || Buffer.byteLength(inline.base64, 'base64') > inputLimit)) {
      throw new Error('Invalid data URL.');
    }
    const bytes = inline ? Buffer.from(inline.base64, 'base64') : await readProviderImage(source, inputLimit, { falAsset: true });
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) !== 1 || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
      throw new Error('Unsupported input image.');
    }
    const { data, info } = await image.autoOrient().resize({
      width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true,
    }).webp({ quality: 92 }).toBuffer({ resolveWithObject: true });
    return { imageUrl: `data:image/webp;base64,${data.toString('base64')}`, width: info.width, height: info.height };
  } catch {
    throw new ZImageTurboRequestError('Z-Image Turbo needs one static JPEG, PNG or WebP input up to 20 MB and 40 megapixels. No generation was submitted.');
  }
}

async function buildZImageTurboRequest(req: GenerateImageRequest) {
  validateImageModelRequest(req, MODEL);
  if (!req.prompt.trim()) throw new ZImageTurboRequestError('Z-Image Turbo requires a prompt. No generation was submitted.');

  const input = req.image ?? req.references?.[0]?.url;
  const source = input ? await prepareZImageTurboSource(input) : undefined;
  const [width, height] = req.aspectRatio && req.aspectRatio !== 'auto'
    ? req.aspectRatio.split(':').map(Number)
    : [source?.width ?? 1, source?.height ?? 1];
  const scale = MAX_EDGE / Math.max(width, height);
  const imageSize = { width: Math.round(width * scale / 16) * 16, height: Math.round(height * scale / 16) * 16 };
  if (Math.min(imageSize.width, imageSize.height) < MIN_EDGE) {
    throw new ZImageTurboRequestError('Z-Image Turbo requires a 512-pixel short edge on its 1K canvas. Pass a supported aspect ratio such as 16:9 or 9:16. No generation was submitted.');
  }
  return {
    endpoint: zImageTurboEndpoint(source ? 1 : 0),
    body: {
      prompt: req.prompt,
      image_size: imageSize,
      ...(source ? { image_url: source.imageUrl, strength: 0.6 } : {}),
      num_inference_steps: 8,
      num_images: 1,
      enable_safety_checker: true,
      enable_prompt_expansion: false,
      sync_mode: true,
      output_format: req.outputFormat ?? Z_IMAGE_TURBO_DEFAULT_FORMAT,
    },
  };
}

type FalZImageResponse = {
  images?: { url?: string }[];
  detail?: { type?: string }[] | string;
  has_nsfw_concepts?: boolean[];
  timings?: { inference?: number };
};

export const falZImageTurboBackend: ModelBackend = {
  id: MODEL,
  canHandle: () => Boolean(process.env.FAL_KEY?.trim()),
  async generate(req) {
    const key = process.env.FAL_KEY?.trim();
    if (!key) throw new ZImageTurboRequestError('Z-Image Turbo requires FAL_KEY. No generation was submitted.');
    if (req.signal?.aborted) throw new ZImageTurboRequestError('Z-Image Turbo was cancelled before submission.');
    const { body, endpoint } = await buildZImageTurboRequest(req);
    const remainingMs = Math.min(30_000, (req.deadlineMs ?? Infinity) - Date.now());
    if (req.signal?.aborted || remainingMs <= 0) throw new ZImageTurboRequestError('Z-Image Turbo was cancelled before submission.');
    const timeout = AbortSignal.timeout(remainingMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const started = Date.now();

    let response: Response;
    try {
      response = await fetch(`https://fal.run/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', 'x-app-fal-disable-fallback': 'true' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal,
        redirect: 'error',
      });
    } catch {
      throw new ZImageTurboRequestError('Z-Image Turbo lost the provider response. The paid outcome may be unknown. Do not retry automatically.');
    }
    const rawRequestId = response.headers.get('x-fal-request-id');
    const requestId = rawRequestId && /^[a-z0-9-]{1,100}$/i.test(rawRequestId) ? rawRequestId : undefined;
    const data = await response.json().catch(() => {
      if (response.ok) {
        throw new ZImageTurboRequestError('Z-Image Turbo could not read the provider response body. The paid outcome may be unknown. Do not retry automatically.');
      }
      return null;
    }) as FalZImageResponse | null;
    if ((!response.ok && Array.isArray(data?.detail) && data.detail.some(item => item?.type === 'content_policy_violation'))
      || (Array.isArray(data?.has_nsfw_concepts) && data.has_nsfw_concepts.includes(true))) {
      throw new ImageProviderRefusalError('fal', 'content_policy_violation', requestId);
    }
    if (!response.ok) {
      throw new ZImageTurboRequestError(`Z-Image Turbo returned HTTP ${response.status}. Do not retry automatically.`);
    }

    const url = Array.isArray(data?.images) && data.images.length === 1 ? data.images[0]?.url : undefined;
    const output = typeof url === 'string' && url.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 80 ? parseImageDataUrl(url) : null;
    const units = Number(response.headers.get('x-fal-billable-units'));
    if (!url || !output || output.mimeType !== `image/${body.output_format}` || !Number.isFinite(units) || units <= 0) {
      throw new ZImageTurboRequestError('Z-Image Turbo returned an invalid image or missing billing receipt. Do not retry automatically.');
    }
    const bytes = Buffer.from(output.base64, 'base64');
    try {
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeded byte limit.');
      const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_EDGE * MAX_EDGE });
      const metadata = await image.metadata();
      if (metadata.format !== body.output_format || (metadata.pages ?? 1) !== 1
        || metadata.width !== body.image_size.width || metadata.height !== body.image_size.height) {
        throw new Error('Provider returned a different canvas or format.');
      }
      await image.raw().toBuffer();
    } catch {
      throw new ZImageTurboRequestError('Z-Image Turbo returned an invalid image. Do not retry automatically.');
    }

    const providerCostUsd = units * USD_PER_MEGAPIXEL;
    console.info(`[${MODEL}] provider=fal endpoint=${endpoint} request=${requestId ?? 'unknown'} totalMs=${Date.now() - started} inferenceSeconds=${data?.timings?.inference ?? 'unknown'} billableMP=${units}`);
    return {
      image: url,
      taskId: requestId,
      provider: 'fal',
      usage: { modelId: MODEL, provider: 'fal', providerCostUsd, inputTokens: 0, outputTokens: 0 },
    };
  },
};
