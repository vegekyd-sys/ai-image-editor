/**
 * Nano Banana 2 Lite backend — OpenRouter image model for fast draft edits.
 */
import type { ModelBackend, GenerateImageRequest, TokenUsage } from './types';
import {
  generateImageWithReferences,
  generatePreviewImageOpenRouter,
} from '../gemini';

const GEMINI_LITE_IMAGE_MODEL = 'google/gemini-3.1-flash-lite-image';

export const geminiLiteBackend: ModelBackend = {
  id: 'gemini-lite',

  canHandle(_req: GenerateImageRequest): boolean {
    return true;
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null; usage?: TokenUsage }> {
    if (req.references?.length) {
      const allRefs = [
        ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
        ...req.references,
      ];
      const thinkingEffort = req.thinkingEffort === 'high' ? 'high' : 'minimal';
      const image = await generateImageWithReferences(
        allRefs,
        req.prompt,
        req.aspectRatio,
        thinkingEffort,
        GEMINI_LITE_IMAGE_MODEL,
      );
      return { image };
    }

    const result = await generatePreviewImageOpenRouter(
      req.image ?? '',
      req.prompt,
      req.aspectRatio,
      req.thinkingEffort === 'high' ? 'high' : 'minimal',
      GEMINI_LITE_IMAGE_MODEL,
    );
    return { image: result.image, usage: result.usage };
  },
};
