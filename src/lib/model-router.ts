/** Image capabilities own selection; this module executes one selected provider. */
import type { GenerateImageRequest, GenerateImageResult } from './models/types';
import { resolveImageModelChain } from './image-model-capabilities';
import { getBackend } from './models';

export type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';
/** Compatibility entry point for callers quoting the selected model before billing. */
export const resolveModelChain = resolveImageModelChain;

export class SpicyImageRequestError extends Error {
  readonly code = 'SPICY_IMAGE_REQUEST_FAILED';
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
  const model = resolveImageModelChain(req)[0];
  const backend = getBackend(model);
  if (!backend?.canHandle(req)) throw new Error(`${model} is not configured. No fallback model was called.`);
  // Ranking selects before submission. It is never a paid-failure retry chain.
  try {
    const result = await backend.generate(req);
    if (!result?.image) throw new Error(`${model} returned no image. Provider outcome may be unknown; no automatic retry or model fallback.`);
    return { image: result.image, model, fallbackUsed: false, usage: result.usage, provider: result.provider ?? result.usage?.provider };
  } catch (error) {
    if (model === 'qwen-spicy') throw error instanceof SpicyImageRequestError ? error
      : new SpicyImageRequestError(error instanceof Error ? error.message : 'Qwen Spicy request outcome unknown.');
    throw error;
  }
}
