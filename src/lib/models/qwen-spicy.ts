/**
 * Qwen Image Edit Spicy — independent MuleRouter image model.
 * Existing self-hosted Qwen remains a separate backend for rotation/LoRA and
 * as an independently selectable model.
 */
import type { GenerateImageRequest, ModelBackend } from './types'
import {
  generateWithMuleRouterQwenEdit,
  generateWithMuleRouterZImage,
  isMuleRouterImageAvailable,
  muleRouterQwenInputs,
  supportsMuleRouterQwenRequest,
} from '../mulerouter-image'

export const qwenSpicyBackend: ModelBackend = {
  id: 'qwen-spicy',

  canHandle(req: GenerateImageRequest): boolean {
    return isMuleRouterImageAvailable() && supportsMuleRouterQwenRequest(req)
  },

  async generate(req: GenerateImageRequest): Promise<{ image: string | null; provider?: string }> {
    if (!this.canHandle(req)) return { image: null }
    const images = muleRouterQwenInputs(req)
    return {
      image: images.length
        ? await generateWithMuleRouterQwenEdit(images, req.prompt)
        : await generateWithMuleRouterZImage(req.prompt, req.aspectRatio),
      provider: 'mulerouter',
    }
  },
}
