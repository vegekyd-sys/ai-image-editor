import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getVideoModelCapability, normalizeVideoModelId, resolveVideoGenerationRoute, type VideoGenerationOperation, type VideoResolutionInput } from '@/lib/video-model-capabilities'

export interface MediaPrice {
  id: string
  kind: 'video' | 'audio'
  model_id: string
  resolution: string
  operation: string
  output_usd_per_second: number
  input_usd_per_second: number
  input_usd_per_image: number
  free_image_references: number
  markup: number
  unfiltered_multiplier: number
  is_active: boolean
  updated_at: string
}

export interface MediaQuote {
  priceId: string
  priceVersion: string
  supplierCostUsd: number
  credits: number
  durationSec: number
  imageCount: number
  referenceVideoDurationSec: number
  markup: number
  multiplier: number
}

export interface VideoQuoteInput {
  model?: string | null
  resolution?: VideoResolutionInput
  operation?: VideoGenerationOperation
  durationSec: number
  imageCount?: number
  referenceVideoDurationSec?: number
  contentFilter?: boolean
}

export class PricingUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PricingUnavailableError'
  }
}

/** No cross-request cache: Admin edits affect the next quote on every instance.
 * A missing migration, disabled row or failed read never falls back to a guessed price.
 */
export async function getMediaPrices(): Promise<MediaPrice[]> {
  const { data, error } = await getSupabaseAdmin().from('media_pricing').select('*').order('id')
  if (error || !data?.length) throw new PricingUnavailableError('Media pricing unavailable. Please retry after pricing is configured.')
  return data as MediaPrice[]
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new PricingUnavailableError(`Invalid pricing quantity: ${name}`)
  return value
}

export function calculateMediaQuote(price: MediaPrice, input: Omit<VideoQuoteInput, 'model' | 'resolution' | 'operation'>): MediaQuote {
  if (!price.is_active) throw new PricingUnavailableError(`Pricing disabled: ${price.id}`)
  const durationSec = nonNegative(input.durationSec, 'duration')
  if (durationSec <= 0) throw new PricingUnavailableError('A known positive duration is required before submission.')
  const imageCount = nonNegative(input.imageCount ?? 0, 'images')
  if (!Number.isInteger(imageCount)) throw new PricingUnavailableError('Image count must be an integer.')
  const referenceVideoDurationSec = nonNegative(input.referenceVideoDurationSec ?? 0, 'reference duration')
  for (const field of ['output_usd_per_second', 'input_usd_per_second', 'input_usd_per_image', 'free_image_references', 'markup', 'unfiltered_multiplier'] as const) {
    nonNegative(price[field], field)
  }
  if (price.output_usd_per_second <= 0 || price.markup <= 0 || price.unfiltered_multiplier < 1) {
    throw new PricingUnavailableError(`Invalid media price: ${price.id}`)
  }
  const multiplier = input.contentFilter === false ? price.unfiltered_multiplier : 1
  const supplierCostUsd = (
    durationSec * price.output_usd_per_second
    + Math.max(0, imageCount - price.free_image_references) * price.input_usd_per_image
    + referenceVideoDurationSec * price.input_usd_per_second
  ) * multiplier
  const credits = Math.ceil(supplierCostUsd * 100 * price.markup - 1e-9)
  if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 2_147_483_647) {
    throw new PricingUnavailableError('Media quote is outside the supported credit range.')
  }
  return {
    priceId: price.id, priceVersion: price.updated_at, supplierCostUsd,
    credits,
    durationSec, imageCount, referenceVideoDurationSec, markup: price.markup, multiplier,
  }
}

export function videoPriceId(input: Pick<VideoQuoteInput, 'model' | 'resolution' | 'operation'>): string {
  const route = resolveVideoGenerationRoute(input)
  return `video:${normalizeVideoModelId(input.model)}:${route.resolution}:${input.operation ?? 'generate'}`
}

export async function quoteVideo(input: VideoQuoteInput): Promise<MediaQuote> {
  const id = videoPriceId(input)
  const prices = await getMediaPrices()
  const price = prices.find(row => row.id === id)
  if (!price) throw new PricingUnavailableError(`Video pricing is not configured: ${id}`)
  const maximum = getVideoModelCapability(input.model).maxImageReferences
  return calculateMediaQuote(price, { ...input, imageCount: maximum == null ? input.imageCount : Math.min(input.imageCount ?? 0, maximum) })
}

export async function quoteSeedAudio(input: { durationSeconds?: number | null; providerCreditsUsed?: number | null }): Promise<MediaQuote> {
  const price = (await getMediaPrices()).find(row => row.id === 'audio:evolink-seed-audio:default:generate')
  if (!price) throw new PricingUnavailableError('Seed Audio pricing is not configured.')
  // EvoLink reports 0.17 provider credits per output second. This is a unit
  // conversion, not a second USD price; the USD/second rate comes only from DB.
  const durationSec = input.providerCreditsUsed != null && input.providerCreditsUsed > 0
    ? input.providerCreditsUsed / 0.17 : input.durationSeconds ?? 0
  return calculateMediaQuote(price, { durationSec })
}
