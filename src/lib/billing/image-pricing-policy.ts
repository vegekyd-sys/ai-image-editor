import type { GenerateImageRequest, ImageGenerationOptions } from '../models/types';

export type ImagePricingInput = ImageGenerationOptions & {
  imageInputCount: number;
  imageResolution?: string;
  midjourneyQuality?: 'standard' | 'hd';
};

export type ImagePricingPolicy =
  | { kind: 'fixed'; sku: (input: ImagePricingInput) => string }
  | { kind: 'estimated' | 'preflight_only'; billingId: string; estimate: (input: ImagePricingInput, markup: number) => number;
      billsInputImages?: boolean; outputResolutionAffectsCredits?: boolean }
  | { kind: 'usage_only'; billingId: () => string; minimumBalance: number };

/** All inputs count for pricing, including a distinct base and style inputs. */
export function imagePricingInput(request: GenerateImageRequest): ImagePricingInput {
  return {
    imageInputCount: Number(Boolean(request.image)) + (request.references?.length ?? 0) + (request.midjourney?.styleReferences?.length ?? 0),
    imageResolution: request.imageResolution,
    imageQuality: request.imageQuality,
    imageReasoningEffort: request.imageReasoningEffort,
    outputFormat: request.outputFormat,
    frameCount: request.frameCount,
    frameDurationMs: request.frameDurationMs,
    gifFrameSize: request.gifFrameSize,
    midjourneyQuality: request.midjourney?.quality,
  };
}
