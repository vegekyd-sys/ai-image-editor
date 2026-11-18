import type { ActiveImageModelId } from '../image-model-capabilities';
import { getImageModelRegistration } from '../models';
import type { ImagePricingInput } from './image-pricing-policy';
import { PricingUnavailableError } from './media-pricing';
import { getToolPrice } from './pricing';
import { getTokenRate } from './token-rates';

export type ImagePrice = {
  status: 'estimated' | 'preflight_only';
  credits: number;
  priceVersion?: string;
  billableInputImages?: number;
  outputResolutionAffectsCredits?: boolean;
} | {
  status: 'usage_only';
  minimumBalance: number;
  priceVersion?: string;
};

/** Shared by public quotes and generation admission. Inspects only the chosen route's pricing. */
export async function quoteImage(model: ActiveImageModelId, input: ImagePricingInput): Promise<ImagePrice> {
  const { pricing } = getImageModelRegistration(model);
  if (pricing.kind === 'fixed') {
    const price = await getToolPrice(pricing.sku(input));
    if (!price) throw new PricingUnavailableError('Tool pricing is not configured for the selected image model.');
    if (!Number.isSafeInteger(price.credits) || price.credits < 0) throw unavailable();
    return { status: 'estimated', credits: price.isFree ? 0 : price.credits };
  }
  const billingId = pricing.kind === 'usage_only' ? pricing.billingId() : pricing.billingId;
  const rate = await getTokenRate(billingId);
  if (rate?.model_id !== billingId || !Number.isFinite(rate.markup) || rate.markup <= 0) throw unavailable();
  if (pricing.kind === 'usage_only') {
    return { status: 'usage_only', minimumBalance: pricing.minimumBalance, priceVersion: rate.updated_at };
  }
  const credits = pricing.estimate(input, rate.markup);
  if (!Number.isSafeInteger(credits) || credits <= 0) throw unavailable();
  return {
    status: pricing.kind, credits, priceVersion: rate.updated_at,
    ...(pricing.billsInputImages ? { billableInputImages: input.imageInputCount } : {}),
    ...(pricing.outputResolutionAffectsCredits ? { outputResolutionAffectsCredits: true } : {}),
  };
}

function unavailable() {
  return new PricingUnavailableError('Makaron pricing is not configured for the selected image model.');
}

export async function imageAdmissionCredits(model: ActiveImageModelId, input: ImagePricingInput): Promise<number> {
  const { pricing } = getImageModelRegistration(model);
  // Keep the legacy minimum-balance admission for actual-usage models.
  if (pricing.kind === 'usage_only') return pricing.minimumBalance;
  const quote = await quoteImage(model, input);
  if (quote.status === 'usage_only') return quote.minimumBalance;
  return quote.credits;
}

/** Fixed-SKU results may omit usage. All other policies require the actual receipt. */
export function fixedImageBillingSku(model: ActiveImageModelId, input: ImagePricingInput): string {
  const { pricing } = getImageModelRegistration(model);
  if (pricing.kind !== 'fixed') throw new PricingUnavailableError('Image usage receipt is required for settlement.');
  return pricing.sku(input);
}
