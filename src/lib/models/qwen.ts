/**
 * Qwen model backend — wraps existing comfyui-qwen.ts
 */
import type { ModelBackend, GenerateImageRequest } from './types';

export const qwenBackend: ModelBackend = {
  id: 'qwen',

  canHandle(_req: GenerateImageRequest): boolean {
    return !!process.env.COMFYUI_QWEN_URL;
  },

  async generate(req: GenerateImageRequest): Promise<string | null> {
    if (!process.env.COMFYUI_QWEN_URL) return null;

    // Multi-reference path (useOriginalAsReference or referenceImages)
    if (req.references?.length) {
      const { generateWithQwenMulti } = await import('../comfyui-qwen');
      return generateWithQwenMulti(req.references, req.prompt);
    }

    // Single image (img2img)
    if (!req.image) return null;
    const { generateWithQwen } = await import('../comfyui-qwen');
    return generateWithQwen(req.image, req.prompt);
  },
};
