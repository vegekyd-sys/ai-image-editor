import { getSupabaseAdmin } from '@/lib/supabase/service'

export interface TokenRate {
  model_id: string
  display_name: string
  input_per_1m: number   // $/1M input tokens
  output_per_1m: number  // $/1M output tokens
  markup: number         // e.g. 2.0
  is_active: boolean
}

// 1 credit = $0.01
const CREDIT_VALUE = 0.01

// In-memory cache with TTL (same pattern as pricing.ts)
let cache: { data: TokenRate[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getAllTokenRates(): Promise<TokenRate[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('token_rates')
    .select('*')
    .eq('is_active', true)
    .order('model_id')
  const rates = (data ?? []) as TokenRate[]
  cache = { data: rates, ts: Date.now() }
  return rates
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
  // Prefix match: find rates where modelId starts with rate.model_id or vice versa
  const prefix = all.find(r => modelId.startsWith(r.model_id) || r.model_id.startsWith(modelId))
  return prefix ?? null
}

/** Invalidate cache (called after admin updates rates) */
export function invalidateTokenRateCache() {
  cache = null
}

/**
 * Convert token usage to credits.
 * Formula: ceil((inputTokens * inputRate/1M + outputTokens * outputRate/1M) * markup / creditValue)
 * Minimum 1 credit for any non-zero usage.
 */
export function tokensToCredits(
  rate: TokenRate,
  inputTokens: number,
  outputTokens: number,
): number {
  const inputCost = (inputTokens / 1_000_000) * rate.input_per_1m
  const outputCost = (outputTokens / 1_000_000) * rate.output_per_1m
  const totalCost = (inputCost + outputCost) * rate.markup
  const credits = Math.ceil(totalCost / CREDIT_VALUE)
  // Minimum 1 credit for any non-zero usage
  if (credits === 0 && (inputTokens > 0 || outputTokens > 0)) return 1
  return credits
}
