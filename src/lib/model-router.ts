/**
 * Model Router — single entry point for all image generation.
 * Resolves model chain based on request, tries each in order with fallback.
 */
import type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';
import { DEFAULT_IMAGE_MODEL, isFalImage25, resolveImageModel } from './models/types';
import { NanoBanana21RequestError } from './models/nano-banana-21';
import { getBackend } from './models';
import { ContentBlockedError } from './gemini';

export type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';

export class SpicyImageRequestError extends Error {
  readonly code = 'SPICY_IMAGE_REQUEST_FAILED';
}

function getFallbacks(model: ModelId): ModelId[] {
  switch (model) {
    case 'gemini': return ['qwen-spicy'];
    case 'gemini-lite': return ['gemini', 'qwen-spicy'];
    case 'qwen-spicy': return [];
    case 'openai': return ['gemini', 'qwen-spicy'];
    default:       return [DEFAULT_IMAGE_MODEL];
  }
}

export function resolveModelChain(req: GenerateImageRequest): ModelId[] {
  if (req.isNsfw) {
    if (req.background === 'transparent') throw new Error('NSFW transparent editing is not supported by Qwen Spicy. No other provider was called.');
    return ['qwen-spicy'];
  }
  const model = resolveImageModel(req.model, req.background);
  // Transparent output is a strict capability contract. Do not silently return
  // an opaque image from a fallback backend that cannot honor the request.
  if (req.background === 'transparent') return [model!];
  if (model === 'gemini-2.1') return [model];
  if (isFalImage25(model)) return [model];
  // Explicit paid Wan calls never fan out to another model, even on timeout.
  if (req.model === 'wan2.7-image') return ['wan2.7-image'];
  // 1. Explicit model → that model + fallbacks
  if (model) return [model, ...getFallbacks(model)];
  // Ordinary auto requests use 2.1. Spicy is only reached after a definite
  // moderation rejection, never an uncertain paid 2.1 outcome.
  if (req.references?.length || !req.image) {
    const imageCount = (req.image ? 1 : 0) + (req.references?.length ?? 0);
    return imageCount <= 3 ? [DEFAULT_IMAGE_MODEL, 'qwen-spicy'] : [DEFAULT_IMAGE_MODEL];
  }
  // 4. Enhance keeps the Qwen-family primary route.
  if (req.category === 'enhance') return ['qwen-spicy', DEFAULT_IMAGE_MODEL];
  return [DEFAULT_IMAGE_MODEL, 'qwen-spicy'];
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
  const chain = resolveModelChain(req);
  const failedModels: ModelId[] = [];
  let contentBlocked = false;

  for (const modelId of chain) {
    const backend = getBackend(modelId);
    if ((modelId === 'gemini-2.1' || modelId === 'wan2.7-image' || (modelId === 'qwen-spicy' && chain[0] === modelId) || isFalImage25(modelId)) && !backend?.canHandle(req)) {
      throw new Error(`${modelId} is not configured. No fallback model was called.`);
    }
    if (!backend?.canHandle(req)) continue;

    // On fallback: swap to fallbackPrompt (clean, no skill template) for models that can't digest .md
    const effectiveReq = (modelId !== chain[0] && req.fallbackPrompt)
      ? { ...req, prompt: req.fallbackPrompt, fallbackPrompt: undefined }
      : req;

    try {
      const genResult = await backend.generate(effectiveReq);
      const image = genResult?.image ?? null;
      const usage = genResult?.usage;
      if (image) {
        const fallbackUsed = modelId !== chain[0];
        if (fallbackUsed) console.log(`[model-router] Fallback: ${chain[0]} → ${modelId}`);
        return { image, model: modelId, fallbackUsed, failedModels: failedModels.length ? failedModels : undefined, contentBlocked: contentBlocked || undefined, usage, provider: genResult.provider ?? usage?.provider };
      }
      if (modelId === 'qwen-spicy') {
        throw new SpicyImageRequestError('Qwen Spicy returned no image. A paid request may have completed; do not submit again automatically.');
      }
      if (modelId === 'gemini-2.1') throw new NanoBanana21RequestError('Nano Banana 2.1 returned no image. Do not retry automatically.');
      console.log(`[model-router] ${modelId} returned null, trying next...`);
      failedModels.push(modelId);
    } catch (e) {
      // A paid Spicy POST may already have been accepted. Never resubmit or
      // silently switch models when its completion outcome is unknown.
      if (modelId === 'qwen-spicy') {
        throw e instanceof SpicyImageRequestError
          ? e
          : new SpicyImageRequestError(e instanceof Error ? e.message : 'Qwen Spicy request outcome unknown.');
      }
      if (modelId === 'gemini-2.1') {
        if (e instanceof NanoBanana21RequestError && e.contentBlocked && !req.model && chain.includes('qwen-spicy')) {
          contentBlocked = true;
          failedModels.push(modelId);
          continue;
        }
        throw e;
      }
      if (modelId === 'wan2.7-image' || isFalImage25(modelId)) throw e;
      if (e instanceof ContentBlockedError) {
        console.warn(`[model-router] ${modelId} content blocked (NSFW), trying fallback...`);
        contentBlocked = true;
      } else {
        console.error(`[model-router] ${modelId} error:`, e instanceof Error ? e.message : e);
      }
      failedModels.push(modelId);
    }
  }

  return { image: null, model: chain[0], fallbackUsed: false, failedModels, contentBlocked: contentBlocked || undefined };
}
