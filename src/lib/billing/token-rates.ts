import { getSupabaseAdmin } from '@/lib/supabase/service'
import { PricingUnavailableError } from './media-pricing'

export interface TokenRate {
  model_id: string
  display_name: string
  input_per_1m: number   // $/1M input tokens (no-cache)
  output_per_1m: number  // $/1M output tokens
  /** $/1M cache-read tokens. NULL → fallback to input_per_1m. */
  cache_read_per_1m?: number | null
  /** $/1M cache-write tokens. NULL → fallback to input_per_1m. */
  cache_write_per_1m?: number | null
  markup: number         // e.g. 2.0
  is_active: boolean
}

export interface TokenBreakdown {
  noCacheInput: number
  cacheRead: number
  cacheWrite: number
  output: number
}

// 1 credit = $0.01
const CREDIT_VALUE = 0.01

// Authoritative DB prices; no implicit per-model or generic fallback.

export async function getAllTokenRates(): Promise<TokenRate[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('token_rates')
    .select('*')
    .eq('is_active', true)
    .order('model_id')
  if (error) throw new PricingUnavailableError('Token pricing unavailable. Please retry.')
  const dbRates = (data ?? []) as TokenRate[]
  return dbRates
}

/**
 * Look up token rate for a model. Tries exact match first, then prefix match.
 * e.g. "gemini-3.1-flash-image-preview" matches "gemini-3.1-flash-image-preview" exactly,
 * or "gemini-3.1-flash" as a prefix.
 */
export async function getTokenRate(modelId: string): Promise<TokenRate | null> {
  const all = await getAllTokenRates()
  // Exact match
  const exact = all.find(r => r.model_id === modelId)
  if (exact) return exact
  // Strip inference profile prefix (e.g. "us.anthropic.xxx" or "global.anthropic.xxx" -> "anthropic.xxx") and retry
  const stripped = modelId.replace(/^(us|eu|ap|global)\./i, '')
  if (stripped !== modelId) {
    const strippedMatch = all.find(r => r.model_id === stripped)
    if (strippedMatch) return strippedMatch
  }
  // Prefix match: find rates where modelId starts with rate.model_id or vice versa
  const prefix = all.find(r => modelId.startsWith(r.model_id) || r.model_id.startsWith(modelId))
  return prefix ?? null
}

/** Invalidate cache (called after admin updates rates) */
export function invalidateTokenRateCache() {
  // Kept for callers; rates are read fresh across all server instances.
}

/**
 * Convert token usage (with cache breakdown) to credits.
 * Formula applies different rates to no-cache / cache-read / cache-write slices, then markup.
 * cache_read_per_1m / cache_write_per_1m = NULL → fallback to input_per_1m (no regression).
 */
export function tokensToCreditsBreakdown(
  rate: TokenRate,
  t: TokenBreakdown,
): number {
  const cacheReadRate = rate.cache_read_per_1m ?? rate.input_per_1m
  const cacheWriteRate = rate.cache_write_per_1m ?? rate.input_per_1m
  const cost =
    (t.noCacheInput / 1_000_000) * rate.input_per_1m +
    (t.cacheRead / 1_000_000) * cacheReadRate +
    (t.cacheWrite / 1_000_000) * cacheWriteRate +
    (t.output / 1_000_000) * rate.output_per_1m
  const credits = Math.ceil(cost * rate.markup / CREDIT_VALUE)
  const total = t.noCacheInput + t.cacheRead + t.cacheWrite + t.output
  if (credits === 0 && total > 0) return 1
  return credits
}

/**
 * Legacy 2-arg signature kept as shim. Internally routes to tokensToCreditsBreakdown.
 */
export function tokensToCredits(
  rate: TokenRate,
  inputTokens: number,
  outputTokens: number,
): number {
  return tokensToCreditsBreakdown(rate, {
    noCacheInput: inputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    output: outputTokens,
  })
}

export function providerCostToCredits(providerCostUsd: number, markup: number): number {
  if (!Number.isFinite(providerCostUsd) || providerCostUsd <= 0) return 0
  return Math.ceil(providerCostUsd * markup / CREDIT_VALUE)
}
