import { deductFixedCredits } from './credits'
import { quoteSeedAudio } from './media-pricing'

const MAKARON_CREDIT_USD = 0.01
const DEFAULT_MARKUP = 2

// EvoLink changelog, effective 2026-06-29:
// Doubao Seed Audio 1.0 is 0.17 EvoLink credits/s, approximately $0.0025/s.
export const EVOLINK_SEED_AUDIO_CREDITS_PER_SECOND = 0.17
export const EVOLINK_SEED_AUDIO_USD_PER_SECOND = 0.0025
export const EVOLINK_SEED_AUDIO_USD_PER_CREDIT =
  EVOLINK_SEED_AUDIO_USD_PER_SECOND / EVOLINK_SEED_AUDIO_CREDITS_PER_SECOND

export interface SeedAudioUsageInput {
  durationSeconds?: number | null
  providerCreditsUsed?: number | null
  markup?: number
}

export function seedAudioProviderCredits(input: SeedAudioUsageInput): number {
  const providerCredits = Number(input.providerCreditsUsed)
  if (Number.isFinite(providerCredits) && providerCredits > 0) return providerCredits

  const durationSeconds = Number(input.durationSeconds)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  return durationSeconds * EVOLINK_SEED_AUDIO_CREDITS_PER_SECOND
}

/** Legacy seed calculator. Runtime quotes and settlement use quoteSeedAudio. */
export function seedAudioMakaronCredits(input: SeedAudioUsageInput): number {
  const providerCredits = seedAudioProviderCredits(input)
  if (providerCredits <= 0) return 0

  const markup = Number.isFinite(input.markup) && input.markup! > 0 ? input.markup! : DEFAULT_MARKUP
  const supplierCostUsd = providerCredits * EVOLINK_SEED_AUDIO_USD_PER_CREDIT
  const credits = Math.ceil((supplierCostUsd * markup) / MAKARON_CREDIT_USD)
  return Math.max(1, credits)
}

export async function deductSeedAudioCredits(
  userId: string,
  input: SeedAudioUsageInput & { model?: string | null; generationSeconds?: number | null; apiKeyId?: string | null },
): Promise<{ charged: number; remaining: number }> {
  const { credits } = await quoteSeedAudio(input)

  const durationMs = input.generationSeconds ? Math.round(input.generationSeconds * 1000) : undefined
  return deductFixedCredits(
    userId,
    credits,
    'create_seed_audio',
    input.model || 'doubao-seed-audio-1-0',
    durationMs,
    input.apiKeyId || null,
  )
}
