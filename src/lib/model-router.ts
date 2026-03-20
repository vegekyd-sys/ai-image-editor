/**
 * Model Router — single entry point for all image generation.
 * Resolves model chain based on request, tries each in order with fallback.
 */
import type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';
import { getBackend } from './models';

export type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';

function getFallbacks(model: ModelId): ModelId[] {
  switch (model) {
    case 'gemini': return ['qwen'];
    case 'qwen':   return ['gemini'];
    case 'pony':   return ['wai', 'gemini'];
    case 'wai':    return ['pony', 'gemini'];
    default:       return ['gemini'];
  }
}

function resolveModelChain(req: GenerateImageRequest): ModelId[] {
  // 1. Explicit model → that model + fallbacks
  if (req.model) return [req.model, ...getFallbacks(req.model)];
  // 2. Multi-image references → Gemini only (others don't support it)
  if (req.references?.length) return ['gemini', 'qwen'];
  // 3. Text-to-image (no input image) → gemini, qwen (future: anime detection → pony)
  if (!req.image) return ['gemini', 'qwen'];
  // 4. img2img enhance → qwen primary (better face preservation)
  if (req.category === 'enhance') return ['qwen', 'gemini'];
  // 5. Default → gemini primary, qwen fallback
  return ['gemini', 'qwen'];
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
  const chain = resolveModelChain(req);
  const failedModels: ModelId[] = [];

  for (const modelId of chain) {
    const backend = getBackend(modelId);
    if (!backend?.canHandle(req)) continue;

    try {
      const image = await backend.generate(req);
      if (image) {
        const fallbackUsed = modelId !== chain[0];
        if (fallbackUsed) console.log(`[model-router] Fallback: ${chain[0]} → ${modelId}`);
        return { image, model: modelId, fallbackUsed, failedModels: failedModels.length ? failedModels : undefined };
      }
      console.log(`[model-router] ${modelId} returned null, trying next...`);
      failedModels.push(modelId);
    } catch (e) {
      console.error(`[model-router] ${modelId} error:`, e instanceof Error ? e.message : e);
      failedModels.push(modelId);
    }
  }

  return { image: null, model: chain[0], fallbackUsed: false, failedModels };
}
