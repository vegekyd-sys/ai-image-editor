import { deductFixedCredits } from './credits'
import { deductSeedAudioCredits } from './seed-audio'
import { quoteSeedAudio, quoteSunoMusic, type MediaQuote } from './media-pricing'

/**
 * Provider-neutral audio billing. `createAudio` returns one of these per
 * billed generation; every entry point (Agent, MCP, HTTP) settles it here.
 */
export type AudioBillingUsage =
  | {
      provider: 'evolink'
      model: string
      providerModel?: string
      durationSeconds?: number | null
      providerCreditsUsed?: number | null
      generationSeconds?: number | null
    }
  | {
      provider: 'sunoapi'
      model: string
      providerModel?: string
      /** Billed generations. One Suno generation returns several takes. */
      generations: number
      generationSeconds?: number | null
    }

export interface AudioQuoteInput {
  provider: AudioBillingUsage['provider']
  durationSeconds?: number | null
}

/** Pre-flight estimate for the routed provider. */
export async function quoteAudioGeneration(input: AudioQuoteInput): Promise<MediaQuote> {
  return input.provider === 'sunoapi'
    ? quoteSunoMusic({ generations: 1 })
    : quoteSeedAudio({ durationSeconds: input.durationSeconds ?? 20 })
}

export async function deductAudioCredits(
  userId: string,
  usage: AudioBillingUsage,
  options: { apiKeyId?: string | null } = {},
): Promise<{ charged: number; remaining: number }> {
  if (usage.provider === 'sunoapi') {
    const { credits } = await quoteSunoMusic({ generations: usage.generations })
    return deductFixedCredits(
      userId,
      credits,
      'create_suno_music',
      usage.providerModel || usage.model,
      usage.generationSeconds ? Math.round(usage.generationSeconds * 1000) : undefined,
      options.apiKeyId || null,
    )
  }
  return deductSeedAudioCredits(userId, {
    durationSeconds: usage.durationSeconds,
    providerCreditsUsed: usage.providerCreditsUsed,
    model: usage.providerModel || usage.model,
    generationSeconds: usage.generationSeconds,
    apiKeyId: options.apiKeyId,
  })
}
