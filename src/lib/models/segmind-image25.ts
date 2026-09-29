import sharp from 'sharp';
import type { FalImage25Id, GenerateImageRequest, ModelBackend } from './types';
import { buildFalImage25Request, FalImage25RequestError, readFalImage25 } from './fal-image25';
import { normalizeOpenAIImageOutput } from './openai-image-output';

const API = 'https://api.segmind.com/v2';

export function buildSegmindImage25Request(req: GenerateImageRequest, model: FalImage25Id) {
  const { body } = buildFalImage25Request(req, model);
  const moderation = process.env.SEGMIND_IMAGE25_MODERATION ?? 'auto';
  if (moderation !== 'auto' && moderation !== 'low') throw new FalImage25RequestError('Invalid SEGMIND_IMAGE25_MODERATION; expected auto or low.');
  return {
    prompt: body.prompt,
    image_urls: body.image_urls ?? [],
    size: body.image_size === 'auto' ? 'auto' : `${body.image_size.width}x${body.image_size.height}`,
    quality: 'low', background: body.background, moderation, output_format: 'png',
  };
}

export function checkSegmindImage25Response(response: Response, data?: { status?: string; error?: unknown }): void {
  if (response.ok && data?.status !== 'FAILED') return;
  if (/content.?policy|content.?filter|safety|moderation|responsible.?ai|\brai\b/i.test(JSON.stringify(data?.error ?? ''))) {
    throw new FalImage25RequestError('The provider content checker rejected this request. Do not retry automatically or switch providers to bypass the rejection.');
  }
  if (data?.status === 'FAILED') throw new FalImage25RequestError('Segmind generation failed. Inspect the provider request for details.');
  if (response.status === 429 || response.status >= 500) throw new Error(`Temporary provider response HTTP ${response.status}`);
  throw new FalImage25RequestError(`Segmind rejected the request (HTTP ${response.status}).`);
}

export function segmindImage25Cost(value: unknown): number {
  // Segmind credits are USD-denominated; metrics.cost is the actual charge.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new FalImage25RequestError('Segmind returned no valid supplier cost. Do not regenerate automatically.');
  return value;
}

export function createSegmindImage25Backend(model: FalImage25Id): ModelBackend {
  return {
    id: model,
    canHandle: () => Boolean(process.env.SEGMIND_API_KEY?.trim()),
    async generate(req) {
      const key = process.env.SEGMIND_API_KEY?.trim();
      if (!key) throw new FalImage25RequestError('GPT Image 2.5 requires SEGMIND_API_KEY.');
      const body = buildSegmindImage25Request(req, model);
      const headers = { 'x-api-key': key, 'Content-Type': 'application/json' };
      const started = Date.now();
      let requestId: string | undefined;
      let stage = 'upload';
      try {
        const inline = body.image_urls.filter(url => url.startsWith('data:'));
        if (inline.length) {
          const response = await fetch('https://workflows-api.segmind.com/upload-asset', { method: 'POST', headers, body: JSON.stringify({ data_urls: inline }), signal: AbortSignal.timeout(60000), redirect: 'error' });
          const data = await response.json();
          checkSegmindImage25Response(response, data);
          if (!Array.isArray(data.file_urls) || data.file_urls.length !== inline.length || data.file_urls.some((url: unknown) => typeof url !== 'string' || !url.startsWith('https://images.segmind.com/'))) throw new FalImage25RequestError('Segmind input upload did not return the expected images.');
          let index = 0;
          body.image_urls = body.image_urls.map(url => url.startsWith('data:') ? data.file_urls[index++] : url);
        }
        stage = 'submission';
        // Never retry a paid POST, including transport failures with unknown outcomes.
        const submission = await fetch(`${API}/${model}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
        const task = await submission.json();
        checkSegmindImage25Response(submission, task);
        if (typeof task?.request_id !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(task.request_id)) throw new Error('Submission outcome unknown.');
        requestId = task.request_id;
        const resultUrl = `${API}/requests/${requestId}`;
        const signal = AbortSignal.timeout(240000);
        const read = (url: string) => readFalImage25(async () => {
          const response = await fetch(url, { headers, signal, redirect: 'error' });
          const data = await response.json();
          checkSegmindImage25Response(response, data);
          return data;
        }, signal);
        stage = 'status';
        while (true) {
          const status = await read(`${resultUrl}/status`);
          if (status.status === 'COMPLETED') break;
          if (!['QUEUED', 'PROCESSING'].includes(status.status)) throw new FalImage25RequestError('Segmind returned an unknown request status.');
          await new Promise(resolve => setTimeout(resolve, 1500));
          signal.throwIfAborted();
        }
        stage = 'result';
        const data = await read(resultUrl);
        if (data.status !== 'COMPLETED' || data.images?.length !== 1) throw new FalImage25RequestError('Segmind returned no completed image.');
        const cost = segmindImage25Cost(data.metrics?.cost);
        const outputUrl = new URL(data.images[0].url);
        if (outputUrl.protocol !== 'https:' || outputUrl.hostname !== 'images.segmind.com' || outputUrl.username || outputUrl.password) throw new FalImage25RequestError('Unexpected Segmind output host.');
        stage = 'download';
        const buffer = await readFalImage25(async () => {
          const response = await fetch(outputUrl, { signal, redirect: 'error' });
          checkSegmindImage25Response(response);
          return Buffer.from(await response.arrayBuffer());
        }, signal);
        stage = 'decode';
        if (buffer.length > 50 * 1024 * 1024) throw new FalImage25RequestError('Output exceeds image size limit.');
        await sharp(buffer, { failOn: 'error', limitInputPixels: 8294400 }).raw().toBuffer();
        const image = await normalizeOpenAIImageOutput(`data:image/png;base64,${buffer.toString('base64')}`, req.background);
        if (!image) throw new FalImage25RequestError('Output did not satisfy the transparent background request.');
        console.log(`[${model}] provider=segmind request=${requestId} quality=low moderation=${body.moderation} costUsd=${cost} totalMs=${Date.now() - started}`);
        return { image, provider: 'segmind', usage: { modelId: model, inputTokens: 0, outputTokens: 0, provider: 'segmind', providerCostUsd: cost } };
      } catch (error) {
        console.warn(`[${model}] provider=segmind stage=${stage} request=${requestId ?? 'unknown'} errorType=${error instanceof Error ? error.name : 'unknown'}`);
        const reason = error instanceof FalImage25RequestError ? error.message : `The request did not complete successfully during ${stage}.`;
        throw new FalImage25RequestError(`GPT Image 2.5: ${reason}${requestId ? ` Request: ${requestId}.` : ''} No automatic retry; inspect the provider request before resubmitting.`);
      }
    },
  };
}
