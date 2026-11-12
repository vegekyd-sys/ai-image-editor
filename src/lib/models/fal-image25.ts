import { validateImageModelRequest, getImageModelCapability } from '../image-model-capabilities';
import sharp from 'sharp';
import type { GenerateImageRequest, ModelBackend } from './types';
import { preserveGptImageOutput } from './gpt-image-output';
import { normalizeOpenAIImageOutput } from './openai-image-output';
import { parseImageDataUrl } from './image-data-url';
import { ImageProviderRefusalError } from './image-provider-refusal';
import { fitTransparentResultToAspectRatio, fitTransparentResultToSourceCanvas } from './transparent-source-canvas';

import type { FalGptImageId } from './types';
export class FalImage25RequestError extends Error {}

/** Retry read-only transport operations, never the paid generation submission. */
export async function readFalImage25<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof FalImage25RequestError || error instanceof ImageProviderRefusalError || signal?.aborted || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export function checkFalImage25Response(response: Response, data?: { detail?: { type?: string; loc?: (string | number)[]; msg?: string }[] }): void {
  if (response.ok) return;
  if ([400, 403, 422].includes(response.status) && data?.detail?.some(item => item.type === 'content_policy_violation')) {
    throw new ImageProviderRefusalError('fal', 'content_policy_violation');
  }
  if (response.status === 429 || response.status >= 500) throw new Error(`Temporary provider response HTTP ${response.status}`);
  // Keep actionable parameter validation without echoing source URLs, prompt text or credentials.
  const fields = new Set(['image_size', 'frame_count', 'frame_duration_ms', 'output_format', 'quality', 'reasoning_effort']);
  const detail = data?.detail?.filter(item => item.loc?.some(field => fields.has(String(field))) && item.type === 'value_error')
    .map(item => `${item.loc!.filter(field => field !== 'body').join('.')}: ${String(item.msg ?? '').replace(/https?:\/\/\S+|data:\S+/gi, '[redacted]').slice(0, 400)}`).join('; ');
  throw new FalImage25RequestError(`Provider rejected the request (HTTP ${response.status}).${detail ? ` Parameter validation: ${detail}` : ''}`);
}


export function image25Size(aspectRatio?: string, resolution?: string): 'auto' | { width: number; height: number } {
  if ((!aspectRatio || aspectRatio === 'auto') && !resolution) return 'auto';
  const selectedRatio = !aspectRatio || aspectRatio === 'auto' ? (resolution === '4K' ? '16:9' : '1:1') : aspectRatio;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(selectedRatio);
  const ratio = match ? Number(match[1]) / Number(match[2]) : NaN;
  const contract = getImageModelCapability('gpt-image-2.5-flare').aspectRatio;
  if (!Number.isFinite(ratio) || contract.kind !== 'range' || ratio < contract.min || ratio > contract.max) throw new FalImage25RequestError('GPT Image 2.5 aspect ratio must be between 1:3 and 3:1.');
  validateImageModelRequest({ prompt: 'size', aspectRatio, imageResolution: resolution }, 'gpt-image-2.5-flare');
  if (resolution === '2K' || resolution === '4K') {
    const longSide = resolution === '4K' ? getImageModelCapability('gpt-image-2.5-flare').fourKSize!.longSide : 2048;
    return ratio >= 1 ? { width: longSide, height: Math.round(longSide / ratio / 16) * 16 }
      : { width: Math.round(longSide * ratio / 16) * 16, height: longSide };
  }
  return { width: Math.round(Math.sqrt(1048576 * ratio) / 16) * 16, height: Math.round(Math.sqrt(1048576 / ratio) / 16) * 16 };
}

/**
 * fal renders every native GIF frame on one sprite sheet, then slices it. Live validation errors
 * (2026-11-05) show the candidate grids: <=8 frames 4x2/2x4, 9 frames 3x3, 10-12 frames 4x3/3x4/4x4,
 * 13-16 frames 4x4. The whole sheet must keep each edge <= 3840 and total pixels <= 8294400, so
 * 10-12 frames top out at 816px squares and 13-16 frames at 720px squares (720px x16 verified live).
 */
const GIF_SHEET_GRIDS: [number, number][][] = [[[4, 2], [2, 4]], [[3, 3]], [[4, 3], [3, 4], [4, 4]], [[4, 4]]];
export function gifFrameSize(frames: number, ratio = 1): { width: number; height: number } {
  if (!Number.isInteger(frames) || frames < 2 || frames > 16) throw new FalImage25RequestError('GIF frameCount must be an integer 2–16. No generation submitted.');
  const grids = GIF_SHEET_GRIDS[frames <= 8 ? 0 : frames === 9 ? 1 : frames <= 12 ? 2 : 3];
  let best = { width: 0, height: 0 };
  for (const [cols, rows] of grids) {
    let area = Math.min(1048576, 8294400 / (cols * rows));
    area = Math.min(area, (3840 / cols) ** 2 / ratio, (3840 / rows) ** 2 * ratio);
    const width = Math.floor(Math.sqrt(area * ratio) / 16) * 16;
    const height = Math.floor(Math.sqrt(area / ratio) / 16) * 16;
    if (width * height > best.width * best.height) best = { width, height };
  }
  if (best.width < 256 || best.height < 256) throw new FalImage25RequestError('GIF frame canvas/count exceeds the supported native-sheet pixel budget. Use a square/near-square canvas and fewer frames. No generation submitted.');
  return best;
}

/** Chat-sticker frames: ~512x512 pixel area (OpenAI's own GIF example size; live 2026-11-05: 0.033 vs 0.062 fal units at 816px, 19s vs 31s). Fits every sheet grid. */
export function gifStickerSize(ratio = 1): { width: number; height: number } {
  return { width: Math.round(Math.sqrt(262144 * ratio) / 16) * 16, height: Math.round(Math.sqrt(262144 / ratio) / 16) * 16 };
}

/** Provider-specific 2.6 tiers and original-format output. Legacy 2.5 remains available to controlled comparisons only. */
export function buildFalImage25Request(req: GenerateImageRequest, model: FalGptImageId) {
  validateImageModelRequest(req, model);
  const images = [...(req.image ? [{ url: req.image, role: 'Base image to edit' }] : []), ...(req.references ?? [])];
  if (!req.prompt.trim()) throw new FalImage25RequestError('GPT Image requires a non-empty prompt.');
  for (const { url } of images) {
    const dataUrl = parseImageDataUrl(url);
    if (dataUrl && ['image/png', 'image/jpeg', 'image/webp'].includes(dataUrl.mimeType)) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new FalImage25RequestError('Input images must be HTTPS URLs or PNG, JPEG or WebP data URLs.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new FalImage25RequestError('Input images require HTTPS URLs without embedded credentials.');
  }
  const variant = model.endsWith('-flare') ? 'flare' : 'sunburst';
  const version = model.startsWith('gpt-image-2.6-') ? '2.6' : '2.5';
  const prompt = images.length > 1 ? `${images.map((ref, i) => `Image ${i + 1}: ${ref.role}`).join('\n')}\n\n${req.prompt}` : req.prompt;
  if (version === '2.6' && prompt.length > 32000) throw new FalImage25RequestError('GPT Image 2.6 prompt exceeds 32000 characters including reference labels. No generation was submitted.');
  const format = req.outputFormat ?? 'png';
  let imageSize = image25Size(req.aspectRatio, req.imageResolution);
  if (format === 'gif') {
    const frames = req.frameCount ?? 9;
    if (req.imageResolution === '2K' || req.imageResolution === '4K') throw new FalImage25RequestError('Native GIF frames currently support at most 960 pixels per edge, not 2K/4K. Use 1K or omit imageResolution. No generation submitted.');
    const ratio = req.aspectRatio && req.aspectRatio !== 'auto' ? req.aspectRatio.split(':').map(Number).reduce((a, b) => a / b) : 1;
    imageSize = req.gifFrameSize === 'sticker' ? gifStickerSize(ratio) : gifFrameSize(frames, ratio);
  }
  return {
    endpoint: `openai/gpt-image-${version}/${variant}/${images.length ? 'edit' : 'text-to-image'}`,
    body: {
      prompt,
      ...(images.length ? { image_urls: images.map(ref => ref.url) } : {}),
      image_size: imageSize,
      quality: req.imageQuality ?? 'low',
      ...(version === '2.6' ? { reasoning_effort: req.imageReasoningEffort ?? 'high' } : {}),
      background: req.background ?? 'auto',
      output_format: format,
      ...(format === 'gif' ? { frame_count: req.frameCount ?? 9, frame_duration_ms: req.frameDurationMs ?? 200 } : {}),
      num_images: 1,
      sync_mode: false,
    },
  };
}

/** Price is fetched before submission; billable units come from that request's result. */
export function falImage25Cost(unitsHeader: string | null, unitPrice: number): number {
  const units = unitsHeader === null || unitsHeader.trim() === '' ? NaN : Number(unitsHeader);
  const cost = units * unitPrice;
  if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(cost)) {
    throw new FalImage25RequestError('GPT Image returned no valid billing units. Do not regenerate automatically.');
  }
  return cost;
}

export function createFalImage25Backend(model: FalGptImageId): ModelBackend {
  const image26 = model.startsWith('gpt-image-2.6-');
  const label = image26 ? 'GPT Image 2.6' : 'GPT Image 2.5';
  return {
    id: model,
    canHandle: () => Boolean(process.env.FAL_KEY?.trim()),
    async generate(req) {
      const key = process.env.FAL_KEY?.trim();
      if (!key) throw new FalImage25RequestError(`${label} requires FAL_KEY.`);
      const { endpoint, body } = buildFalImage25Request(req, model);
      const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
      const pricingResponse = await fetch(`https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      const pricing = await pricingResponse.json().catch(() => null);
      const price = pricing?.prices?.find((item: { endpoint_id: string }) => item.endpoint_id === endpoint);
      if (!pricingResponse.ok || price?.currency !== 'USD' || (image26 && price?.unit !== 'units') || typeof price.unit_price !== 'number' || !Number.isFinite(price.unit_price) || price.unit_price <= 0) {
        throw new FalImage25RequestError(`${label} supplier pricing unavailable. No generation was submitted.`);
      }
      const started = Date.now();
      let requestId: string | undefined;
      let stage = 'submission';
      try {
        // A single paid POST. Only poll the accepted request; never resubmit on timeout.
        const submission = await fetch(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: 'error' });
        const task = await submission.json().catch(() => null);
        checkFalImage25Response(submission, task);
        if (typeof task?.request_id !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(task.request_id)) throw new Error('Submission outcome unknown.');
        requestId = task.request_id;
        console.log(`[${model}] provider=fal acceptedRequest=${requestId}; only this accepted task may be polled, never automatically resubmitted.`);
        // Live accepted receipts return the family root, not the full endpoint in the OpenAPI example.
        const acceptedUrl = new URL(task.response_url ?? `https://queue.fal.run/openai/gpt-image-${image26 ? '2.6' : '2.5'}/requests/${requestId}`);
        if (acceptedUrl.protocol !== 'https:' || acceptedUrl.hostname !== 'queue.fal.run' || acceptedUrl.username || acceptedUrl.password || acceptedUrl.search || ![`/openai/gpt-image-${image26 ? '2.6' : '2.5'}/requests/${requestId}`, `/${endpoint}/requests/${requestId}`].includes(acceptedUrl.pathname)) throw new Error('Unexpected accepted result URL.');
        const resultUrl = acceptedUrl.href;
        const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000);
        stage = 'status';
        while (true) {
          const status = await readFalImage25(async () => {
            const response = await fetch(`${resultUrl}/status`, { headers, signal, redirect: 'error' });
            checkFalImage25Response(response);
            return response.json();
          }, signal);
          if (status?.status === 'COMPLETED') break;
          if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status?.status)) throw new Error('Provider request failed.');
          await new Promise(resolve => setTimeout(resolve, 1500));
          signal.throwIfAborted();
        }
        stage = 'result';
        const { response, data } = await readFalImage25(async () => {
          const response = await fetch(resultUrl, { headers, signal, redirect: 'error' });
          const data = await response.json();
          checkFalImage25Response(response, data);
          return { response, data };
        }, signal);
        if (data?.images?.length !== 1) throw new FalImage25RequestError('Provider returned no completed image.');
        const cost = falImage25Cost(response.headers.get('x-fal-billable-units'), price.unit_price);
        const outputUrl = new URL(data.images[0].url);
        if (outputUrl.protocol !== 'https:' || !outputUrl.hostname.endsWith('.fal.media') || outputUrl.username || outputUrl.password) throw new Error('Unexpected output host.');
        stage = 'download';
        const buffer = await readFalImage25(async () => {
          const output = await fetch(outputUrl, { signal, redirect: 'error' });
          checkFalImage25Response(output);
          return Buffer.from(await output.arrayBuffer());
        }, signal);
        stage = 'decode';
        if (buffer.length > 50 * 1024 * 1024) throw new Error('Output exceeds image size limit.');
        let image: string | null;
        if (image26) {
          image = await preserveGptImageOutput(buffer, req.outputFormat ?? 'png', req.background);
        } else {
          await sharp(buffer, { failOn: 'error', limitInputPixels: 8294400 }).raw().toBuffer();
          image = await normalizeOpenAIImageOutput(`data:image/png;base64,${buffer.toString('base64')}`, req.background);
        }
        if (!image) throw new Error('Output did not satisfy the transparent background request.');
        if (req.background === 'transparent' && !['gif', 'svg'].includes(req.outputFormat ?? 'png')) {
          const source = req.image ?? req.references?.[0]?.url;
          stage = 'canvas';
          if (req.aspectRatio && req.aspectRatio !== 'auto') image = await fitTransparentResultToAspectRatio(image, req.aspectRatio);
          else if (source && !req.imageResolution) image = await fitTransparentResultToSourceCanvas(source, image);
        }
        console.log(`[${model}] provider=fal request=${requestId} quality=${body.quality} reasoning=${image26 ? body.reasoning_effort : 'not-exposed'} format=${body.output_format} costUsd=${cost} totalMs=${Date.now() - started}`);
        // fal supplies cost, not token counts. Do not invent token telemetry.
        return { image, taskId: requestId, provider: 'fal', usage: { modelId: model, inputTokens: 0, outputTokens: 0, provider: 'fal', providerCostUsd: cost } };
      } catch (error) {
        if (error instanceof ImageProviderRefusalError) throw new ImageProviderRefusalError('fal', error.providerCode, requestId);
        console.warn(`[${model}] stage=${stage} request=${requestId ?? 'unknown'} errorType=${error instanceof Error ? error.name : 'unknown'}${error instanceof RangeError && error.message === 'Maximum call stack size exceeded' ? ' errorCode=stack_overflow' : ''}`);
        const reason = error instanceof FalImage25RequestError ? error.message : `The request did not complete successfully during ${stage}.`;
        throw new FalImage25RequestError(`${label}: ${reason}${requestId ? ` Request: ${requestId}.` : ''} No automatic retry; inspect the provider request before resubmitting.`);
      }
    },
  };
}
