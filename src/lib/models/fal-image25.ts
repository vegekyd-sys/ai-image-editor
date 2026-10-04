import sharp from 'sharp';
import type { GenerateImageRequest, ModelBackend } from './types';
import { normalizeOpenAIImageOutput } from './openai-image-output';
import { fitTransparentResultToAspectRatio, fitTransparentResultToSourceCanvas } from './transparent-source-canvas';

import type { FalImage25Id } from './types';
export class FalImage25RequestError extends Error {}

/** Retry read-only transport operations, never the paid generation submission. */
export async function readFalImage25<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof FalImage25RequestError || signal?.aborted || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export function checkFalImage25Response(response: Response, data?: { detail?: { type?: string }[] }): void {
  if (response.ok) return;
  if (data?.detail?.some(item => item.type === 'content_policy_violation')) {
    throw new FalImage25RequestError('The provider content checker rejected this request. It may concern the input image, prompt or generated result; the provider did not specify which. Do not retry automatically or switch models to bypass the rejection.');
  }
  if (response.status === 429 || response.status >= 500) throw new Error(`Temporary provider response HTTP ${response.status}`);
  throw new FalImage25RequestError(`Provider rejected the request (HTTP ${response.status}).`);
}


export function image25Size(aspectRatio?: string): 'auto' | { width: number; height: number } {
  if (!aspectRatio || aspectRatio === 'auto') return 'auto';
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio);
  const ratio = match ? Number(match[1]) / Number(match[2]) : NaN;
  if (!Number.isFinite(ratio) || ratio < 1 / 3 || ratio > 3) throw new FalImage25RequestError('GPT Image 2.5 aspect ratio must be between 1:3 and 3:1.');
  return { width: Math.round(Math.sqrt(1048576 * ratio) / 16) * 16, height: Math.round(Math.sqrt(1048576 / ratio) / 16) * 16 };
}

export function buildFalImage25Request(req: GenerateImageRequest, model: FalImage25Id) {
  const images = [...(req.image ? [{ url: req.image, role: 'Base image to edit' }] : []), ...(req.references ?? [])];
  if (images.length > 16) throw new FalImage25RequestError('GPT Image 2.5 supports at most 16 input images, including the base image.');
  if (!req.prompt.trim()) throw new FalImage25RequestError('GPT Image 2.5 requires a non-empty prompt.');
  for (const { url } of images) {
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(url)) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new FalImage25RequestError('Input images must be HTTPS URLs or PNG, JPEG or WebP data URLs.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new FalImage25RequestError('Input images require HTTPS URLs without embedded credentials.');
  }
  const variant = model === 'gpt-image-2.5-flare' ? 'flare' : 'sunburst';
  return {
    endpoint: `openai/gpt-image-2.5/${variant}/${images.length ? 'edit' : 'text-to-image'}`,
    body: {
      prompt: images.length > 1 ? `${images.map((ref, i) => `Image ${i + 1}: ${ref.role}`).join('\n')}\n\n${req.prompt}` : req.prompt,
      ...(images.length ? { image_urls: images.map(ref => ref.url) } : {}),
      image_size: image25Size(req.aspectRatio),
      quality: 'low',
      background: req.background ?? 'auto',
      output_format: 'png',
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
    throw new FalImage25RequestError('GPT Image 2.5 returned no valid billing units. Do not regenerate automatically.');
  }
  return cost;
}

export function createFalImage25Backend(model: FalImage25Id): ModelBackend {
  return {
    id: model,
    canHandle: () => Boolean(process.env.FAL_KEY?.trim()),
    async generate(req) {
      const key = process.env.FAL_KEY?.trim();
      if (!key) throw new FalImage25RequestError('GPT Image 2.5 requires FAL_KEY.');
      const { endpoint, body } = buildFalImage25Request(req, model);
      const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
      const pricingResponse = await fetch(`https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      const pricing = await pricingResponse.json().catch(() => null);
      const price = pricing?.prices?.find((item: { endpoint_id: string }) => item.endpoint_id === endpoint);
      if (!pricingResponse.ok || price?.currency !== 'USD' || typeof price.unit_price !== 'number' || !Number.isFinite(price.unit_price) || price.unit_price <= 0) {
        throw new FalImage25RequestError('GPT Image 2.5 supplier pricing unavailable. No generation was submitted.');
      }
      const started = Date.now();
      let requestId: string | undefined;
      let stage = 'submission';
      try {
        // A single paid POST. Only poll the accepted request; never resubmit on timeout.
        const submission = await fetch(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
        const task = await submission.json().catch(() => null);
        checkFalImage25Response(submission, task);
        if (typeof task?.request_id !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(task.request_id)) throw new Error('Submission outcome unknown.');
        requestId = task.request_id;
        const resultUrl = `https://queue.fal.run/openai/gpt-image-2.5/requests/${requestId}`;
        const signal = AbortSignal.timeout(240000);
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
        await sharp(buffer, { failOn: 'error', limitInputPixels: 8294400 }).raw().toBuffer();
        let image = await normalizeOpenAIImageOutput(`data:image/png;base64,${buffer.toString('base64')}`, req.background);
        if (!image) throw new Error('Output did not satisfy the transparent background request.');
        if (req.background === 'transparent') {
          const source = req.image ?? req.references?.[0]?.url;
          stage = 'canvas';
          if (req.aspectRatio && req.aspectRatio !== 'auto') image = await fitTransparentResultToAspectRatio(image, req.aspectRatio);
          else if (source) image = await fitTransparentResultToSourceCanvas(source, image);
        }
        console.log(`[${model}] provider=fal request=${requestId} quality=low costUsd=${cost} totalMs=${Date.now() - started}`);
        // fal supplies cost, not token counts. Do not invent token telemetry.
        return { image, provider: 'fal', usage: { modelId: model, inputTokens: 0, outputTokens: 0, provider: 'fal', providerCostUsd: cost } };
      } catch (error) {
        console.warn(`[${model}] stage=${stage} request=${requestId ?? 'unknown'} errorType=${error instanceof Error ? error.name : 'unknown'}`);
        const reason = error instanceof FalImage25RequestError ? error.message : `The request did not complete successfully during ${stage}.`;
        throw new FalImage25RequestError(`GPT Image 2.5: ${reason}${requestId ? ` Request: ${requestId}.` : ''} No automatic retry; inspect the provider request before resubmitting.`);
      }
    },
  };
}
