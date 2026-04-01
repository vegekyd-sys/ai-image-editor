/**
 * Gemini model backend — wraps existing generatePreviewImage functions from gemini.ts
 */
import type { ModelBackend, GenerateImageRequest } from './types';

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

  async generate(req: GenerateImageRequest): Promise<string | null> {
    // Multi-reference path: user photo as edit base (first), then reference images
    if (req.references?.length) {
      const allRefs = [
        ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
        ...req.references,
      ];
      return generateImageWithReferences(
        allRefs,
        req.prompt,
        req.aspectRatio,
        req.thinkingEffort,
      );
    }

    // Standard single-image or text-to-image
    if (PROVIDER === 'openrouter') {
      return generatePreviewImageOpenRouter(
        req.image ?? '',
        req.prompt,
        req.aspectRatio,
        req.thinkingEffort,
      );
    }
    return generatePreviewImageGoogle(
      req.image ?? '',
      req.prompt,
      req.aspectRatio,
    );
  },
};
