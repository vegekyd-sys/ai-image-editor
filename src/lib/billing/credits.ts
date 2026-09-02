import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getToolPrice, resolveToolName } from './pricing'
import { getTokenRate, providerCostToCredits, tokensToCredits, tokensToCreditsBreakdown } from './token-rates'
import { getConfiguredWelcomeCredits } from './welcome-credits'

// Billing kill switch — cached from DB app_settings
let _billingEnabled: boolean | null = null
let _billingCheckedAt = 0
const BILLING_CACHE_TTL = 60_000 // 1 minute

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly balance: number,
    public readonly required: number,
  ) {
    super(`Insufficient credits: balance=${balance}, required=${required}`)
    this.name = 'InsufficientCreditsError'
  }
}

export function isInsufficientCreditsError(error: unknown): error is InsufficientCreditsError {
  return error instanceof InsufficientCreditsError
}

export async function isBillingEnabled(): Promise<boolean> {
  if (_billingEnabled !== null && Date.now() - _billingCheckedAt < BILLING_CACHE_TTL) return _billingEnabled
  try {
    const admin = getSupabaseAdmin()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'billing_enabled').single()
    _billingEnabled = data?.value === 'true'
  } catch {
    _billingEnabled = false
  }
  _billingCheckedAt = Date.now()
  return _billingEnabled
}

export function invalidateBillingCache() { _billingEnabled = null }

export type SubscriptionUsageProvider = 'codex-subscription' | 'grok-subscription'

function subscriptionUsageModelId(modelId: string, provider: SubscriptionUsageProvider): string {
  const normalized = modelId.trim() || 'unknown'
  return normalized.includes(provider) ? normalized : `${normalized}:${provider}`
}

/**
 * Record usage served by a personal subscription without touching Makaron credits.
 * This intentionally ignores the billing kill switch: Usage is telemetry, while
 * credits_charged=0 makes the free subscription route explicit in the ledger.
 */
export async function recordSubscriptionUsage(
  userId: string,
  provider: SubscriptionUsageProvider,
  toolName: string,
  modelId: string,
  options?: {
    inputTokens?: number | null
    outputTokens?: number | null
    cacheReadTokens?: number | null
    cacheWriteTokens?: number | null
    durationMs?: number | null
    apiKeyId?: string | null
  },
): Promise<void> {
  const { error } = await getSupabaseAdmin().from('usage_logs').insert({
    user_id: userId,
    api_key_id: options?.apiKeyId ?? null,
    tool_name: toolName,
    model_used: subscriptionUsageModelId(modelId, provider),
    credits_charged: 0,
    input_tokens: options?.inputTokens ?? null,
    output_tokens: options?.outputTokens ?? null,
    cache_read_tokens: options?.cacheReadTokens ?? null,
    cache_write_tokens: options?.cacheWriteTokens ?? null,
    duration_ms: options?.durationMs ?? null,
    source: options?.apiKeyId ? 'mcp' : 'app',
  })
  if (error) throw new Error(`Subscription usage logging failed: ${error.message}`)
}

/** Record Agent token usage, charging API providers and logging subscription providers at zero cost. */
export async function recordAgentTokenUsage(input: {
  userId: string
  provider: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheWriteTelemetryComplete?: boolean
  providerCostUsd?: number
}): Promise<{ charged: number; remaining: number }> {
  if (input.provider === 'codex-subscription' || input.provider === 'grok-subscription') {
    await recordSubscriptionUsage(
      input.userId,
      input.provider,
      'agent',
      input.modelId,
      {
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheWriteTokens: input.cacheWriteTelemetryComplete === false
          ? null
          : input.cacheWriteTokens ?? 0,
      },
    )
    return { charged: 0, remaining: 0 }
  }

  return deductByTokens(
    input.userId,
    'agent',
    input.modelId,
    input.inputTokens,
    input.outputTokens,
    undefined,
    undefined,
    {
      cacheRead: input.cacheReadTokens ?? 0,
      cacheWrite: input.cacheWriteTokens ?? 0,
      cacheWriteTelemetryComplete: input.cacheWriteTelemetryComplete,
    },
    input.providerCostUsd,
  )
}

async function expireAppleTrialCredits(userId: string): Promise<void> {
  try {
    const result = await getSupabaseAdmin().rpc('expire_apple_trial_credits', {
      p_user_id: userId,
    })
    if (result?.error) {
      console.error('[billing] could not expire Apple trial credits:', result.error)
    }
  } catch (error) {
    console.error('[billing] could not expire Apple trial credits:', error)
  }
}

/**
 * Check if user has enough credits for a tool call.
 */
export async function checkBalance(userId: string, toolName: string): Promise<{ ok: boolean; balance: number; cost: number }> {
  const price = await getToolPrice(toolName)
  if (!price) return { ok: true, balance: 0, cost: 0 } // Unknown tool = free (fail open)
  if (price.isFree) return { ok: true, balance: 0, cost: 0 }

  await expireAppleTrialCredits(userId)

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('credit_balances')
    .select('balance')
    .eq('user_id', userId)
    .single()
  const balance = data?.balance ?? 0
  return { ok: balance >= price.credits, balance, cost: price.credits }
}

/**
 * Pre-flight credit check for App API routes.
 * Returns a 402 Response if insufficient credits, so the route can short-circuit:
 *   const check = await requireCredits(userId, 5);
 *   if (!check.ok) return check.response;
 */
export async function requireCredits(
  userId: string,
  estimatedCredits: number = 1,
): Promise<{ ok: true; balance: number } | { ok: false; balance: number; response: Response }> {
  if (!(await isBillingEnabled())) return { ok: true, balance: 0 }
  await expireAppleTrialCredits(userId)
  const admin = getSupabaseAdmin()
  const balanceResult = await admin
    .from('credit_balances')
    .select('balance')
    .eq('user_id', userId)
    .single()
  let data = balanceResult.data
  const balanceError = balanceResult.error

  // A transient read failure must never be interpreted as a zero balance.
  // PGRST116 is the expected "no row" response from .single().
  if (balanceError && balanceError.code !== 'PGRST116') {
    throw new Error(`Could not read credit balance: ${balanceError.message}`)
  }

  // Auto-initialize for users without a credit_balances row (e.g. old users)
  if (!data) {
    const welcomeCredits = await getConfiguredWelcomeCredits(admin)
    if (welcomeCredits > 0) {
      const { error } = await admin.rpc('claim_welcome_credits', {
        p_user_id: userId,
        p_credits: welcomeCredits,
        p_channel: 'legacy_auto',
      })
      if (error) throw new Error(`Could not initialize welcome credits: ${error.message}`)
    } else {
      const { error } = await admin.from('credit_balances').upsert({
        user_id: userId,
        balance: 0,
        lifetime_purchased: 0,
        lifetime_used: 0,
      }, { onConflict: 'user_id', ignoreDuplicates: true })
      if (error) throw new Error(`Could not initialize credit balance: ${error.message}`)
    }
    const { data: fresh, error: freshError } = await admin
      .from('credit_balances')
      .select('balance')
      .eq('user_id', userId)
      .single()
    if (freshError) throw new Error(`Could not read initialized credit balance: ${freshError.message}`)
    data = fresh
  }

  const balance = Number(data?.balance ?? 0)

  if (balance >= estimatedCredits) {
    return { ok: true, balance }
  }

  // Check if this is an unclaimed agent account
  const { data: profile } = await admin
    .from('user_profiles')
    .select('is_agent')
    .eq('id', userId)
    .single()

  const isAgent = profile?.is_agent === true

  return {
    ok: false,
    balance,
    response: new Response(
      JSON.stringify(isAgent ? {
        error: 'insufficient_credits',
        balance,
        needed: estimatedCredits,
        action: 'claim',
        message: 'Credits exhausted. Let a human claim and top up your account.',
        claim_command: 'npx makaron-cli claim',
      } : {
        error: 'insufficient_credits',
        balance,
        needed: estimatedCredits,
        action: 'topup',
        message: 'Insufficient credits.',
        upgradeUrl: 'https://www.makaron.app/dashboard',
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    ),
  }
}

/**
 * Atomic deduct + log via single RPC (one transaction — no lost logs, no double-charge).
 */
async function deductAndLog(
  userId: string, credits: number,
  toolName: string, model?: string | null,
  inputTokens?: number | null, outputTokens?: number | null,
  durationMs?: number | null, source?: string, apiKeyId?: string | null,
  cacheReadTokens?: number | null, cacheWriteTokens?: number | null,
): Promise<number> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('deduct_and_log', {
    p_user_id: userId,
    p_amount: credits,
    p_tool_name: toolName,
    p_model_used: model || null,
    p_input_tokens: inputTokens || null,
    p_output_tokens: outputTokens || null,
    p_duration_ms: durationMs || null,
    p_source: source || 'app',
    p_api_key_id: apiKeyId || null,
    p_cache_read_tokens: cacheReadTokens ?? null,
    p_cache_write_tokens: cacheWriteTokens ?? null,
  })
  if (!error) return data ?? 0

  if (error.code === 'P0001' || error.message?.includes('insufficient_credits')) {
    const match = error.message?.match(/balance=(\d+), required=(\d+)/)
    throw new InsufficientCreditsError(
      Number(match?.[1] ?? 0),
      Number(match?.[2] ?? credits),
    )
  }

  throw new Error(`Credit deduction failed: ${error.message}`)
}

/**
 * Deduct credits after a successful tool call (per-action pricing from credit_pricing table).
 */
export async function deductCredits(
  userId: string,
  apiKeyId: string | null,
  mcpToolName: string,
  model?: string,
  durationMs?: number,
): Promise<{ charged: number; remaining: number }> {
  if (!(await isBillingEnabled())) return { charged: 0, remaining: 0 }
  const toolName = resolveToolName(mcpToolName, model)
  const price = await getToolPrice(toolName)
  if (!price || price.isFree) return { charged: 0, remaining: 0 }

  const remaining = await deductAndLog(userId, price.credits, toolName, model, null, null, durationMs, apiKeyId ? 'mcp' : 'app', apiKeyId)
  return { charged: price.credits, remaining }
}

/**
 * Deduct credits based on actual token usage for routed model calls.
 * Computes credit cost from token_rates table, then deducts atomically.
 */
export async function deductByTokens(
  userId: string,
  toolName: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  durationMs?: number,
  apiKeyId?: string | null,
  /** Optional cache-aware breakdown. Omit for providers without cache reporting. */
  cacheBreakdown?: {
    cacheRead: number;
    cacheWrite: number;
    /** False means cacheWrite is only the reported lower bound. */
    cacheWriteTelemetryComplete?: boolean;
  },
  /** Provider-reported actual cost. Prefer this for routed providers whose upstream price can vary. */
  providerCostUsd?: number,
): Promise<{ charged: number; remaining: number }> {
  if (!(await isBillingEnabled())) return { charged: 0, remaining: 0 }
  let rate = await getTokenRate(modelId)
  let usedFallback = false
  if (!rate) {
    console.warn(`[billing] WARNING: No token rate for "${modelId}". Using fallback $5/$25. Add it via Admin → Billing → Token Rates.`)
    rate = { model_id: `unknown:${modelId}`, display_name: 'Fallback', input_per_1m: 5, output_per_1m: 25, markup: 2, is_active: true }
    usedFallback = true
  }

  const credits = providerCostUsd != null
    ? providerCostToCredits(providerCostUsd, rate.markup)
    : cacheBreakdown
    ? tokensToCreditsBreakdown(rate, {
        noCacheInput: inputTokens,
        cacheRead: cacheBreakdown.cacheRead,
        cacheWrite: cacheBreakdown.cacheWrite,
        output: outputTokens,
      })
    : tokensToCredits(rate, inputTokens, outputTokens)
  if (credits <= 0) return { charged: 0, remaining: 0 }

  const remaining = await deductAndLog(
    userId, credits, toolName,
    usedFallback ? `unknown:${modelId}` : modelId,
    inputTokens, outputTokens, durationMs,
    apiKeyId ? 'mcp' : 'app', apiKeyId,
    cacheBreakdown?.cacheRead ?? null,
    cacheBreakdown?.cacheWriteTelemetryComplete === false
      ? null
      : cacheBreakdown?.cacheWrite ?? null,
  )
  return { charged: credits, remaining }
}

/**
 * Deduct a fixed number of credits (for dynamic pricing like per-second video billing).
 */
export async function deductFixedCredits(
  userId: string,
  credits: number,
  toolName: string,
  model?: string,
  durationMs?: number,
  apiKeyId?: string | null,
): Promise<{ charged: number; remaining: number }> {
  if (!(await isBillingEnabled())) return { charged: 0, remaining: 0 }
  if (credits <= 0) return { charged: 0, remaining: 0 }

  const remaining = await deductAndLog(userId, credits, toolName, model, null, null, durationMs, apiKeyId ? 'mcp' : 'app', apiKeyId)
  return { charged: credits, remaining }
}

/**
 * Get user's current credit balance.
 */
export async function getBalance(userId: string): Promise<{ balance: number; lifetimePurchased: number; lifetimeUsed: number }> {
  await expireAppleTrialCredits(userId)
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('credit_balances')
    .select('balance, lifetime_purchased, lifetime_used')
    .eq('user_id', userId)
    .single()
  return {
    balance: data?.balance ?? 0,
    lifetimePurchased: data?.lifetime_purchased ?? 0,
    lifetimeUsed: data?.lifetime_used ?? 0,
  }
}

export async function grantCreditsAndRecordPurchase(params: {
  userId: string
  credits: number
  amountUsd: number
  stripeSessionId: string
  stripeInvoiceId?: string | null
  source: string
}): Promise<{ granted: boolean; balance: number }> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('grant_credits_and_record_purchase', {
    p_user_id: params.userId,
    p_credits: params.credits,
    p_amount_usd: params.amountUsd,
    p_stripe_session_id: params.stripeSessionId,
    p_stripe_invoice_id: params.stripeInvoiceId ?? null,
    p_source: params.source,
  })

  if (error) {
    console.error('[billing] grant_credits_and_record_purchase failed:', error)
    throw error
  }

  return {
    granted: data?.granted === true,
    balance: Number(data?.balance ?? 0),
  }
}

export async function refundCredits(userId: string, credits: number, toolName: string): Promise<number> {
  if (credits <= 0) return 0
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('refund_credits_and_log', {
    p_user_id: userId,
    p_amount: credits,
    p_tool_name: toolName,
    p_source: 'app',
  })

  if (error) {
    throw new Error(`Credit refund failed: ${error.message}`)
  }

  return Number(data ?? 0)
}
