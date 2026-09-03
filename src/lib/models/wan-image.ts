import sharp from 'sharp';
import type { GenerateImageRequest, ModelBackend } from './types';

const MODEL = 'wan2.7-image';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Workspace keys are regional. Restrict the host to the priced Singapore route. */
export function wanImageEndpoint(host = process.env.DASHSCOPE_API_HOST ?? ''): string {
  const url = new URL(host.includes('://') ? host : `https://${host}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || url.search || url.hash || url.pathname !== '/'
    || !/^ws-[a-z0-9-]+\.ap-southeast-1\.maas\.aliyuncs\.com$/.test(url.hostname)) {
    throw new Error('DASHSCOPE_API_HOST must be a Singapore Alibaba workspace API host.');
  }
  return `${url.origin}/api/v1/services/aigc/multimodal-generation/generation`;
}

/** Small, approximately 1 MP output. Omitted ratio lets Wan choose the composition. */
export function wanImageSize(aspectRatio?: string): string {
  if (!aspectRatio) return '1K';
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio);
  const ratio = match ? Number(match[1]) / Number(match[2]) : NaN;
  if (!Number.isFinite(ratio) || ratio < 1 / 8 || ratio > 8) {
    throw new Error('Wan 2.7 aspect ratio must be between 1:8 and 8:1.');
  }
  let width = Math.round(Math.sqrt(921600 * ratio) / 16) * 16;
  let height = Math.round(Math.sqrt(921600 / ratio) / 16) * 16;
  // Alignment must not push an extreme requested ratio outside the API limits.
  if (width > height * 8) height = Math.ceil(width / 8 / 16) * 16;
  if (height > width * 8) width = Math.ceil(height / 8 / 16) * 16;
  return `${width}*${height}`;
}

function validateInputImage(image: string): string {
  if (image.startsWith('data:')) {
    const match = /^data:image\/(?:jpeg|jpg|png|webp|bmp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image);
    if (!match || Buffer.byteLength(match[1], 'base64') > MAX_IMAGE_BYTES) {
      throw new Error('Wan input must be JPEG, PNG, WebP or BMP, at most 20 MB.');
    }
  } else {
    let url: URL;
    try { url = new URL(image); } catch { throw new Error('Wan input must be an HTTPS URL or image data URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Wan input images require HTTPS URLs without embedded credentials.');
    }
  }
  return image;
}

export function buildWanImageRequest(req: GenerateImageRequest) {
  if (req.background === 'transparent') throw new Error('Wan 2.7 does not support transparent output.');
  const images = [
    ...(req.image ? [{ url: req.image, role: 'Image 1: base image to edit' }] : []),
    ...(req.references ?? []),
  ];
  if (images.length > 9) throw new Error('Wan 2.7 supports at most 9 input images, including the base image.');
  // Keep the single-reference prompt unchanged; annotate roles only for multi-image edits.
  const prompt = images.length > 1
    ? `${images.map((ref, i) => `Image ${i + 1}: ${ref.role}`).join('\n')}\n\n${req.prompt}`
    : req.prompt;
  if (!prompt.trim() || [...prompt].length > 5000) throw new Error('Wan 2.7 requires a prompt of 1–5000 characters.');
  return {
    model: MODEL,
    input: { messages: [{ role: 'user', content: [
      ...images.map(ref => ({ image: validateInputImage(ref.url) })),
      { text: prompt },
    ] }] },
    parameters: {
      size: wanImageSize(req.aspectRatio),
      n: 1,
      watermark: false,
      enable_sequential: false,
      // Only affects text-to-image. Do not spend extra time on optional reasoning.
      thinking_mode: false,
    },
  };
}

export const wanImageBackend: ModelBackend = {
  id: MODEL,
  canHandle: () => Boolean(process.env.DASHSCOPE_API_KEY?.trim() && process.env.DASHSCOPE_API_HOST?.trim()),
  async generate(req) {
    const key = process.env.DASHSCOPE_API_KEY?.trim();
    if (!key) throw new Error('Wan 2.7 is not configured: missing DASHSCOPE_API_KEY.');
    const endpoint = wanImageEndpoint();
    const body = buildWanImageRequest(req);
    const start = Date.now();
    // One POST only: a timeout is an unknown paid outcome, never a reason to resubmit.
    const signal = AbortSignal.timeout(120_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Wan 2.7 request did not complete. It was not retried; provider status may be unknown.');
    }
    // Never log raw provider errors: they can echo the request, source URLs or credentials.
    const data = await response.json().catch(() => null);
    const requestId = typeof data?.request_id === 'string' && /^[a-z0-9-]{1,80}$/i.test(data.request_id)
      ? data.request_id : undefined;
    const trace = requestId ? ` (request ${requestId})` : '';
    if (!response.ok || data?.code) throw new Error(`Wan 2.7 rejected the request (HTTP ${response.status})${trace}. No automatic retry.`);
    const outputs = data?.output?.choices?.flatMap((choice: { message?: { content?: { image?: string }[] } }) =>
      choice.message?.content?.flatMap(part => typeof part.image === 'string' ? [part.image] : []) ?? []) ?? [];
    if (outputs.length !== 1 || data?.output?.finished === false || (data?.usage?.image_count != null && data.usage.image_count !== 1)) {
      throw new Error(`Wan 2.7 did not return exactly one completed image${trace}. No automatic retry.`);
    }
    const imageUrl = new URL(outputs[0]);
    if (imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password
      || !/^.+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(imageUrl.hostname)) {
      throw new Error(`Wan 2.7 returned an unexpected output host${trace}.`);
    }
    const urlReadyMs = Date.now() - start;
    const imageResponse = await fetch(imageUrl, { signal, redirect: 'error' });
    if (!imageResponse.ok) throw new Error(`Wan 2.7 image download failed${trace}. No automatic generation retry.`);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Wan 2.7 output exceeds the image size limit.');
    // Decode to reject corrupt/non-image output, and follow the normal Makaron JPEG storage contract.
    const jpeg = await sharp(buffer, { limitInputPixels: Math.ceil(2048 * 2048 * 1.1) }).jpeg({ quality: 95 }).toBuffer();
    console.log(`[wan2.7-image] request=${requestId ?? 'unknown'} size=${body.parameters.size} urlReadyMs=${urlReadyMs} totalMs=${Date.now() - start}`);
    // Wan's input/output token counters are non-billable telemetry. Omitting token
    // usage intentionally selects the shared per-image credit_pricing path.
    return { image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, provider: 'dashscope' };
  },
};
