/**
 * Pony model backend — anime text-to-image via ComfyUI SDXL with danbooru tag translation
 */
import type { ModelBackend, GenerateImageRequest } from './types';

export const ponyBackend: ModelBackend = {
  id: 'pony',

  canHandle(req: GenerateImageRequest): boolean {
    // Pony is text-to-image only (no input image)
    if (req.image) return false;
    return !!process.env.COMFYUI_PONY_URL;
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null }> {
    if (req.image) return { image: null }; // img2img not supported
    const { translateForPony, generateTextToImageWithPony } = await import('../comfyui-sdxl');
    const translated = await translateForPony(req.prompt);
    return { image: await generateTextToImageWithPony(translated) };
  },
};
