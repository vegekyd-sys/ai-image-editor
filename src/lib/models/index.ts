import { z } from 'zod';
import type { GenerateImageRequest, ModelBackend, ModelId } from './types';
import type { ActiveImageModelId } from '../image-model-capabilities';
import type { ImagePricingPolicy } from '../billing/image-pricing-policy';
import { resolveToolName } from '../billing/pricing';
import { getClassicImageBillingId } from '../gemini';
import { geminiBackend } from './gemini';
import { NANO_BANANA_21_MODEL, nanoBanana21Backend } from './nano-banana-21';
import { GEMINI_LITE_IMAGE_MODEL, geminiLiteBackend } from './gemini-lite';
import { qwenSpicyBackend } from './qwen-spicy';
import { createImage26Backend } from './openai-image26';
import { estimateGptImageCredits } from './gpt-image-quote';
import { midjourneyBackend } from './midjourney';
import { estimateKlingImage4Credits, klingImage4Backend } from './kling-image4';
import { estimateSeedream55Credits, seedream55Backend } from './seedream55';
import { wanImageBackend } from './wan-image';

interface ImageModelRegistration {
  backend: ModelBackend;
  pricing: ImagePricingPolicy;
  quoteOptions?: (raw: Record<string, unknown>) => Partial<GenerateImageRequest>;
}

const midjourneyQuoteOptions = z.object({
  speed: z.enum(['fast', 'draft']).optional(),
  quality: z.enum(['standard', 'hd']).optional(),
  style_reference_count: z.number().int().min(0).max(20).optional(),
}).strict();

/** Server-only registry. Every selectable image backend must declare its pricing contract. */
const models: Record<ActiveImageModelId, ImageModelRegistration> = {
  gemini: { backend: geminiBackend, pricing: { kind: 'usage_only', billingId: () => getClassicImageBillingId(), minimumBalance: 5 } },
  'gemini-lite': { backend: geminiLiteBackend, pricing: { kind: 'usage_only', billingId: () => GEMINI_LITE_IMAGE_MODEL, minimumBalance: 5 } },
  'gemini-2.1': {
    backend: nanoBanana21Backend,
    pricing: { kind: 'preflight_only', billingId: NANO_BANANA_21_MODEL, billsInputImages: true, outputResolutionAffectsCredits: true,
      estimate: ({ imageResolution, imageInputCount }, markup) => {
        const output = imageResolution === '4K' ? 0.0756 : imageResolution === '2K' ? 0.0504 : 0.0336;
        return Math.ceil((output + imageInputCount * 1120 * 1.5 / 1_000_000) * markup / 0.01);
      } },
  },
  'qwen-spicy': { backend: qwenSpicyBackend, pricing: { kind: 'fixed', sku: ({ imageInputCount }) => resolveToolName('edit_image', 'qwen-spicy', imageInputCount) } },
  'wan2.7-image': { backend: wanImageBackend, pricing: { kind: 'fixed', sku: () => 'edit_image_wan2.7-image' } },
  'gpt-image-2.6-flare': {
    backend: createImage26Backend('gpt-image-2.6-flare'),
    pricing: { kind: 'preflight_only', billingId: 'gpt-image-2.6-flare', estimate: estimateGptImageCredits, billsInputImages: true, outputResolutionAffectsCredits: true },
  },
  'gpt-image-2.6-sunburst': {
    backend: createImage26Backend('gpt-image-2.6-sunburst'),
    pricing: { kind: 'preflight_only', billingId: 'gpt-image-2.6-sunburst', estimate: estimateGptImageCredits, billsInputImages: true, outputResolutionAffectsCredits: true },
  },
  'mj-v8.2': {
    backend: midjourneyBackend,
    quoteOptions(raw) {
      const { speed, quality, style_reference_count } = midjourneyQuoteOptions.parse(raw);
      return { midjourney: { speed, quality, styleReferences: Array.from({ length: style_reference_count ?? 0 }, () => 'quote-style-reference') } };
    },
    pricing: { kind: 'preflight_only', billingId: 'mj-v8.2', outputResolutionAffectsCredits: true,
      // This is the existing admission estimate for a batch and its prompt preparation.
      estimate: ({ midjourneyQuality, imageResolution }, markup) => Math.ceil(((midjourneyQuality === 'hd' || imageResolution === '2K' ? 0.12 : 0.08) + 0.01) * markup / 0.01) },
  },
  'seedream-5.5': {
    backend: seedream55Backend,
    pricing: { kind: 'estimated', billingId: 'seedream-5.5', estimate: estimateSeedream55Credits, billsInputImages: true, outputResolutionAffectsCredits: true },
  },
  'kling-image-4.0': {
    backend: klingImage4Backend,
    pricing: { kind: 'preflight_only', billingId: 'kling-image-4.0', estimate: estimateKlingImage4Credits, billsInputImages: true, outputResolutionAffectsCredits: true },
  },
};

export function getImageModelRegistration(id: ActiveImageModelId): ImageModelRegistration {
  return models[id];
}

export function getBackend(id: ModelId): ModelBackend | undefined {
  return Object.hasOwn(models, id) ? models[id as ActiveImageModelId].backend : undefined;
}
