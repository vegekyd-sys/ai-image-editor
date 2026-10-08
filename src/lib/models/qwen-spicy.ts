import { validateImageModelRequest } from '../image-model-capabilities'
/**
 * Qwen Image Edit Spicy — MuleRouter image backend replacing the Vast Qwen route.
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
    validateImageModelRequest(req, 'qwen-spicy')
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
