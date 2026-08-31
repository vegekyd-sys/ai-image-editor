import { getSupabaseAdmin } from '@/lib/supabase/service'

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

const DEFAULT_TOKEN_RATES: TokenRate[] = [
  {
    model_id: 'openai/gpt-image-2',
    display_name: 'GPT Image 2 (OpenRouter)',
    input_per_1m: 8.00,
    output_per_1m: 30.00,
    cache_read_per_1m: 2.00,
    cache_write_per_1m: 8.00,
    markup: 2.0,
    is_active: true,
  },
  // OpenRouter reports exact routed cost in provider metadata; these rows keep
  // model attribution and markup stable if that metadata is ever unavailable.
  {
    model_id: 'openai/gpt-5.6-terra',
    display_name: 'GPT-5.6 Terra (OpenRouter)',
    input_per_1m: 1.00,
    output_per_1m: 6.00,
    cache_read_per_1m: 0.10,
    cache_write_per_1m: 1.25,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'openai/gpt-5.6-sol',
    display_name: 'GPT-5.6 Sol (OpenRouter)',
    input_per_1m: 5.00,
    output_per_1m: 30.00,
    cache_read_per_1m: 0.50,
    cache_write_per_1m: 6.25,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'openai/gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna (OpenRouter)',
    input_per_1m: 0.10,
    output_per_1m: 0.60,
    cache_read_per_1m: 0.01,
    cache_write_per_1m: 0.125,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'gpt-5.6-terra',
    display_name: 'GPT-5.6 Terra',
    input_per_1m: 2.50,
    output_per_1m: 15.00,
    cache_read_per_1m: 0.25,
    cache_write_per_1m: 3.125,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'gpt-5.6-sol',
    display_name: 'GPT-5.6 Sol',
    input_per_1m: 5.00,
    output_per_1m: 30.00,
    cache_read_per_1m: 0.50,
    cache_write_per_1m: 6.25,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'gpt-5.6-luna',
    display_name: 'GPT-5.6 Luna',
    input_per_1m: 1.00,
    output_per_1m: 6.00,
    cache_read_per_1m: 0.10,
    cache_write_per_1m: 1.25,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'x-ai/grok-4.6',
    display_name: 'Grok 4.6',
    input_per_1m: 2.00,
    output_per_1m: 6.00,
    cache_read_per_1m: 0.50,
    cache_write_per_1m: 0,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'deepseek/deepseek-v4-pro',
    display_name: 'DeepSeek V4 Pro',
    input_per_1m: 0.435,
    output_per_1m: 0.87,
    cache_read_per_1m: 0.003625,
    cache_write_per_1m: 0,
    markup: 2.0,
    is_active: true,
  },
  {
    model_id: 'gemini-3-flash-preview',
    display_name: 'Gemini 3 Flash Preview',
    input_per_1m: 0.50,
    output_per_1m: 3.00,
    cache_read_per_1m: 0.05,
    cache_write_per_1m: 0.50,
    markup: 2.0,
    is_active: true,
  },
]

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
  const dbRates = (data ?? []) as TokenRate[]
  const dbModelIds = new Set(dbRates.map(rate => rate.model_id))
  const rates = [
    ...dbRates,
    ...DEFAULT_TOKEN_RATES.filter(rate => !dbModelIds.has(rate.model_id)),
  ]
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
  cache = null
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
