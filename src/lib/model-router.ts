/**
 * Model Router — single entry point for all image generation.
 * Resolves model chain based on request, tries each in order with fallback.
 */
import type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';
import { getBackend } from './models';
import { ContentBlockedError } from './gemini';

export type { ModelId, GenerateImageRequest, GenerateImageResult } from './models/types';

function getFallbacks(model: ModelId): ModelId[] {
  switch (model) {
    case 'gemini': return ['qwen'];
    case 'qwen':   return ['gemini'];
    case 'pony':   return ['wai', 'gemini'];
    case 'wai':    return ['pony', 'gemini'];
    case 'openai': return ['gemini', 'qwen'];
    default:       return ['gemini'];
  }
}

function resolveModelChain(req: GenerateImageRequest): ModelId[] {
  // 0. NSFW project → Qwen only, never touch Gemini
  if (req.isNsfw) return ['qwen'];
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
  let contentBlocked = false;

  for (const modelId of chain) {
    const backend = getBackend(modelId);
    if (!backend?.canHandle(req)) continue;

    // On fallback: swap to fallbackPrompt (clean, no skill template) for models that can't digest .md
    const effectiveReq = (modelId !== chain[0] && req.fallbackPrompt)
      ? { ...req, prompt: req.fallbackPrompt, fallbackPrompt: undefined }
      : req;

    try {
      const image = await backend.generate(effectiveReq);
      if (image) {
        const fallbackUsed = modelId !== chain[0];
        if (fallbackUsed) console.log(`[model-router] Fallback: ${chain[0]} → ${modelId}`);
        return { image, model: modelId, fallbackUsed, failedModels: failedModels.length ? failedModels : undefined, contentBlocked: contentBlocked || undefined };
      }
      console.log(`[model-router] ${modelId} returned null, trying next...`);
      failedModels.push(modelId);
    } catch (e) {
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
