/**
 * WAI model backend — anime text-to-image via ComfyUI SDXL (WAI-Illustrious)
 */
import type { ModelBackend, GenerateImageRequest } from './types';

export const waiBackend: ModelBackend = {
  id: 'wai',

  canHandle(req: GenerateImageRequest): boolean {
    // WAI is text-to-image only (no input image)
    if (req.image) return false;
    return !!process.env.COMFYUI_WAI_URL;
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null }> {
    if (req.image) return { image: null }; // img2img not supported
    const { translateForWai, generateTextToImageWithWai } = await import('../comfyui-sdxl');
    const translated = await translateForWai(req.prompt);
    return { image: await generateTextToImageWithWai(translated) };
  },
};
