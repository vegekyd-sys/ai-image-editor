/**
 * Billing unit of a media_pricing row. Most rows are priced per output second.
 * Per-generation models (one flat price per call, independent of duration)
 * reuse `output_usd_per_second` as USD per generation, quoted with quantity =
 * generation count. Shared by server quotes and the Admin panel.
 */
const PER_GENERATION_MODELS = new Set(['suno-v6'])

export function isPerGenerationPrice(price: { model_id: string }): boolean {
  return PER_GENERATION_MODELS.has(price.model_id)
}
