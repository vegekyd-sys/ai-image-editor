/**
 * Gemini model backend — wraps existing generatePreviewImage functions from gemini.ts
 */
import type { ModelBackend, GenerateImageRequest, TokenUsage } from './types';

// Import internal Gemini functions (kept in gemini.ts for session management, tips, etc.)
import {
  generatePreviewImageOpenRouter,
  generatePreviewImageGoogle,
  generateImageWithReferences,
  PROVIDER,
} from '../gemini';

export const geminiBackend: ModelBackend = {
  id: 'gemini',

  canHandle(_req: GenerateImageRequest): boolean {
    // Gemini can handle anything — img2img, txt2img, multi-ref
    return true;
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null; usage?: TokenUsage }> {
    // Multi-reference path: user photo as edit base (first), then reference images
    if (req.references?.length) {
      const allRefs = [
        ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
        ...req.references,
      ];
      const image = await generateImageWithReferences(
        allRefs,
        req.prompt,
        req.aspectRatio,
        req.thinkingEffort,
      );
      return { image };
    }

    // Standard single-image or text-to-image
    if (PROVIDER === 'openrouter') {
      const result = await generatePreviewImageOpenRouter(
        req.image ?? '',
        req.prompt,
        req.aspectRatio,
        req.thinkingEffort,
      );
      return { image: result.image, usage: result.usage };
    }
    const result = await generatePreviewImageGoogle(
      req.image ?? '',
      req.prompt,
      req.aspectRatio,
    );
    return { image: result.image, usage: result.usage };
  },
};
