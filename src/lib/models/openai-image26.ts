import { buildFalImage25Request, createFalImage25Backend, FalImage25RequestError } from './fal-image25';
import { preserveGptImageOutput } from './gpt-image-output';
import { fitTransparentResultToAspectRatio, fitTransparentResultToSourceCanvas } from './transparent-source-canvas';
import type { FalGptImageId, GenerateImageRequest, ModelBackend } from './types';
import {
  getOpenAIDirectApiKey,
  image26UsageCostUsd,
  isOpenAIDirectAvailable,
  isOpenAIDirectConfigured,
  isOpenAIQuotaExhausted,
  markOpenAIDirectExhausted,
  OPENAI_API_BASE_URL,
  recordOpenAIDirectSpend,
  refreshOpenAIDirectBudget,
  responsesUsageCostUsd,
  type ImagesUsage,
} from '../openai-direct';

type Image26Id = Extract<FalGptImageId, 'gpt-image-2.6-flare' | 'gpt-image-2.6-sunburst'>;

/** OpenAI refused before producing an image for a reason another supplier can serve (quota, auth, outage). */
export class OpenAIImageFallbackError extends Error {}

/**
 * Translate the shared (fal-shaped, already validated) request into the OpenAI
 * Images API body. Differences verified live 2026-11-05:
 * - reasoning effort is `complexity` on OpenAI (`reasoning_effort` is unknown);
 * - references are `images: [{ image_url }]` on /images/edits (HTTPS or data URL; GIF inputs are rejected);
 * - SVG needs `svg.model` (a text model that traces the raster) and is generation-only;
 * - GIF frame_count 2–16 and the sprite-sheet limits are identical to fal.
 */
export function buildOpenAIImage26Request(req: GenerateImageRequest, model: Image26Id) {
  const { endpoint, body } = buildFalImage25Request(req, model);
  const edit = endpoint.endsWith('/edit');
  const size = body.image_size === 'auto' ? 'auto' : `${body.image_size.width}x${body.image_size.height}`;
  const format = body.output_format;
  const svgModel = process.env.OPENAI_IMAGE_SVG_MODEL?.trim() || 'gpt-6-luna';
  return {
    path: edit ? 'images/edits' : 'images/generations',
    svgModel: format === 'svg' ? svgModel : undefined,
    body: {
      model,
      prompt: body.prompt,
      ...(edit ? { images: (body.image_urls ?? []).map(url => ({ image_url: url })) } : {}),
      size,
      quality: body.quality,
      ...('reasoning_effort' in body && body.reasoning_effort ? { complexity: body.reasoning_effort } : {}),
      background: body.background,
      output_format: format,
      ...(format === 'gif' ? { frame_count: body.frame_count, frame_duration_ms: body.frame_duration_ms } : {}),
      ...(format === 'svg' ? { svg: { model: svgModel } } : {}),
      n: 1,
    },
  };
}

interface OpenAIImagesResponse {
  data?: { b64_json?: string }[];
  usage?: ImagesUsage;
  svg_usage?: { input_tokens?: number; output_tokens?: number; model?: string };
  error?: { code?: string; type?: string; message?: string };
}

async function svgTracingCostUsd(svgUsage: OpenAIImagesResponse['svg_usage'], fallbackModel: string): Promise<number> {
  if (!svgUsage) return 0;
  const { getTokenRate } = await import('@/lib/billing/token-rates');
  const rate = await getTokenRate(svgUsage.model || fallbackModel).catch(() => null);
  return rate ? responsesUsageCostUsd(svgUsage, rate) : 0;
}

export function createOpenAIImage26Backend(model: Image26Id): ModelBackend {
  const label = model === 'gpt-image-2.6-flare' ? 'GPT Image 2.6 Flare' : 'GPT Image 2.6 Sunburst';
  return {
    id: model,
    canHandle: () => isOpenAIDirectConfigured(),
    async generate(req) {
      const apiKey = getOpenAIDirectApiKey();
      if (!apiKey) throw new OpenAIImageFallbackError('OPENAI_API_KEY is not configured.');
      const { path, body, svgModel } = buildOpenAIImage26Request(req, model);
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(`${OPENAI_API_BASE_URL}/${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000),
          redirect: 'error',
        });
      } catch (error) {
        // Network failure before a response: OpenAI never accepted the job, safe to use fal.
        throw new OpenAIImageFallbackError(`OpenAI request did not reach the API: ${error instanceof Error ? error.message : String(error)}`);
      }
      const requestId = response.headers.get('x-request-id') ?? undefined;
      const data = await response.json().catch(() => ({})) as OpenAIImagesResponse;
      if (!response.ok || data.error) {
        const code = data.error?.code ?? '';
        const detail = `${response.status} ${code} ${data.error?.message ?? ''}`.trim();
        if (isOpenAIQuotaExhausted(detail)) await markOpenAIDirectExhausted(detail);
        if (/moderation|content_policy|safety/i.test(`${code} ${data.error?.type ?? ''}`)) {
          throw new FalImage25RequestError('The provider content checker rejected this request. It may concern the input image, prompt or generated result; the provider did not specify which. Do not retry automatically or switch models to bypass the rejection.');
        }
        if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500 || isOpenAIQuotaExhausted(detail)) {
          throw new OpenAIImageFallbackError(`OpenAI unavailable (${detail.slice(0, 200)})`);
        }
        // Parameter validation: the same request would fail on fal too. Surface it.
        throw new FalImage25RequestError(`${label}: provider rejected the request (HTTP ${response.status}). ${String(data.error?.message ?? '').replace(/https?:\/\/\S+|data:\S+/gi, '[redacted]').slice(0, 400)}${requestId ? ` Request: ${requestId}.` : ''}`);
      }
      const b64 = data.data?.[0]?.b64_json;
      if (!b64 || data.data?.length !== 1) throw new FalImage25RequestError(`${label}: provider returned no completed image.${requestId ? ` Request: ${requestId}.` : ''}`);
      const costUsd = image26UsageCostUsd(data.usage) + await svgTracingCostUsd(data.svg_usage, svgModel ?? 'gpt-6-luna');
      await recordOpenAIDirectSpend({
        kind: 'image',
        model,
        usd: costUsd,
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
        requestId,
        detail: `${body.output_format} ${body.size} q=${body.quality}${body.output_format === 'gif' ? ` frames=${body.frame_count}` : ''}`,
      });
      const buffer = Buffer.from(b64, 'base64');
      let image = await preserveGptImageOutput(buffer, req.outputFormat ?? 'png', req.background);
      if (!image) throw new FalImage25RequestError('Output did not satisfy the transparent background request.');
      if (req.background === 'transparent' && !['gif', 'svg'].includes(req.outputFormat ?? 'png')) {
        const source = req.image ?? req.references?.[0]?.url;
        if (req.aspectRatio && req.aspectRatio !== 'auto') image = await fitTransparentResultToAspectRatio(image, req.aspectRatio);
        else if (source && !req.imageResolution) image = await fitTransparentResultToSourceCanvas(source, image);
      }
      console.log(`[${model}] provider=openai request=${requestId ?? 'unknown'} format=${body.output_format} size=${body.size} quality=${body.quality} complexity=${'complexity' in body ? body.complexity : 'default'} costUsd=${costUsd.toFixed(5)} totalMs=${Date.now() - started}`);
      return {
        image,
        taskId: requestId,
        provider: 'openai',
        usage: { modelId: model, inputTokens: 0, outputTokens: 0, provider: 'openai', providerCostUsd: costUsd },
      };
    },
  };
}

/**
 * GPT Image 2.6: the owner's direct OpenAI key first while its monthly budget
 * lasts, fal otherwise. Only refusals that never produced an image (quota,
 * auth, rate limit, outage) move to fal; validation and content-policy
 * rejections are returned as-is so a model or supplier switch never bypasses them.
 */
export function createImage26Backend(model: Image26Id): ModelBackend {
  const openai = createOpenAIImage26Backend(model);
  const fal = createFalImage25Backend(model);
  return {
    id: model,
    canHandle: req => openai.canHandle(req) || fal.canHandle(req),
    async generate(req) {
      if (isOpenAIDirectConfigured()) {
        await refreshOpenAIDirectBudget();
        if (isOpenAIDirectAvailable()) {
          try {
            return await openai.generate(req);
          } catch (error) {
            if (!(error instanceof OpenAIImageFallbackError) || !fal.canHandle(req)) throw error;
            console.warn(`[${model}] direct OpenAI unavailable before generation; using fal: ${error.message}`);
          }
        }
      }
      return fal.generate(req);
    },
  };
}
