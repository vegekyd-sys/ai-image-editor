/** Capability selection plus one explicitly gated character-refusal recovery. */
import type { GenerateImageRequest, GenerateImageResult } from './models/types';
import { getImageModelCapability, getImageRequestConflicts, planImageGeneration, resolveImageModelChain } from './image-model-capabilities';
import { getBackend } from './models';
import { ImageProviderRefusalError } from './models/image-provider-refusal';

export type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';
/** Compatibility entry point for callers quoting the selected model before billing. */
export const resolveModelChain = resolveImageModelChain;

export class SpicyImageRequestError extends Error {
  readonly code = 'SPICY_IMAGE_REQUEST_FAILED';
}

/** Strictly preserve the first attempt's contract; never relax references, alpha or format. */
export function planCharacterImageRecovery(req: GenerateImageRequest): GenerateImageRequest | undefined {
  if (req.benignCharacterContent !== true || req.isNsfw || req.model !== 'gpt-image-2.6-flare'
    || req.imageQuality || req.imageReasoningEffort || (req.outputFormat && req.outputFormat !== 'png')
    || req.background === 'transparent' || req.frameCount !== undefined || req.frameDurationMs !== undefined || req.gifFrameSize !== undefined) return;
  // Nano has no output_format control. Explicit PNG is encoded after decoding;
  // other explicit formats remain excluded rather than silently substituted.
  const next = { ...req, model: 'gemini-2.1', outputFormat: undefined };
  if (getImageRequestConflicts(next, getImageModelCapability('gemini-2.1')).length) return;
  return next;
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
  const { model, request, adjustments } = planImageGeneration(req);
  const mayRecover = request.benignCharacterContent === true && !request.isNsfw;
  const deadline = Math.min(request.deadlineMs ?? Infinity, Date.now() + 270_000);
  if (mayRecover) {
    request.signal = AbortSignal.any([...(request.signal ? [request.signal] : []), AbortSignal.timeout(Math.max(0, deadline - Date.now()))]);
  }
  const backend = getBackend(model);
  if (!backend?.canHandle(request)) throw new Error(`${model} is not configured. No fallback model was called.`);
  // Ranking selects before submission; it is not a general paid-failure retry chain.
  try {
    request.signal?.throwIfAborted();
    const result = await backend.generate(request);
    if (!result?.image) throw new Error(`${model} returned no image. Provider outcome may be unknown; no automatic retry or model fallback.`);
    return { image: result.image, images: result.images, taskId: result.taskId, model, fallbackUsed: false, adjustments: [...adjustments, ...(result.adjustments ?? [])], usage: result.usage, provider: result.provider ?? result.usage?.provider };
  } catch (error) {
    // A caller assessment of harmless character content is independent of the
    // refusal code. No keyword guessing, prompt rewriting, NSFW state mutation,
    // same-model retry, or retry of a missing/unknown/partially delivered result.
    const recovery = error instanceof ImageProviderRefusalError ? planCharacterImageRecovery(request) : undefined;
    if (error instanceof ImageProviderRefusalError && recovery && !request.signal?.aborted && deadline - Date.now() >= 30_000) {
      const alternate = getBackend('gemini-2.1');
      if (alternate?.canHandle(recovery) && (!request.beforeImageRecovery || await request.beforeImageRecovery(recovery))) {
        request.signal?.throwIfAborted();
        if (deadline - Date.now() < 30_000) throw error;
        console.info('[image-recovery]', { fromModel: model, toModel: 'gemini-2.1', provider: error.provider, providerCode: error.providerCode, rejectedRequestId: error.requestId, rejectedCostUsd: 'unknown' });
        // Execute the one alternate directly: its failure cannot recurse or fan out.
        const result = await alternate.generate(recovery);
        if (!result?.image) {
          throw new Error('Image recovery did not deliver the requested image. Do not retry automatically.');
        }
        let image = result.image;
        if (request.outputFormat === 'png' && !image.startsWith('data:image/png;base64,')) {
          const raster = /^data:image\/(?:jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image);
          if (!raster) throw new Error('Image recovery returned an unsupported raster. Do not retry automatically.');
          const { default: sharp } = await import('sharp');
          const png = await sharp(Buffer.from(raster[1], 'base64'), { failOn: 'error', limitInputPixels: 40_000_000 }).png().toBuffer();
          if (png.length > 50 * 1024 * 1024) throw new Error('Image recovery PNG exceeds the image size limit. Do not retry automatically.');
          image = `data:image/png;base64,${png.toString('base64')}`;
        }
        return { ...result, image, model: 'gemini-2.1', fallbackUsed: true, adjustments: [...adjustments, ...(result.adjustments ?? [])],
          provider: result.provider ?? result.usage?.provider,
          recovery: { fromModel: model, provider: error.provider, providerCode: error.providerCode, rejectedRequestId: error.requestId } };
      }
    }
    if (model === 'qwen-spicy') throw error instanceof SpicyImageRequestError ? error
      : new SpicyImageRequestError(error instanceof Error ? error.message : 'Qwen Spicy request outcome unknown.');
    throw error;
  }
}
