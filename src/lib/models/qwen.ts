/**
 * Qwen model backend — wraps existing comfyui-qwen.ts
 */
import type { ModelBackend, GenerateImageRequest } from './types';
import { isQwenAvailable } from '../comfyui-qwen';

export const qwenBackend: ModelBackend = {
  id: 'qwen',

  canHandle(): boolean {
    return isQwenAvailable();
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null }> {
    if (!isQwenAvailable()) return { image: null };

    // Multi-reference path
    if (req.references?.length) {
      const { generateWithQwenMulti } = await import('../comfyui-qwen');
      return { image: await generateWithQwenMulti(req.references, req.prompt, req.aspectRatio) };
    }

    // Text-to-image
    if (!req.image) {
      const { generateWithQwenText } = await import('../comfyui-qwen');
      return { image: await generateWithQwenText(req.prompt, req.aspectRatio) };
    }

    // Single image (img2img)
    const { generateWithQwen } = await import('../comfyui-qwen');
    return { image: await generateWithQwen(req.image, req.prompt, req.aspectRatio) };
  },
};
