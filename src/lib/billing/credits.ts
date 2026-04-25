import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getToolPrice, resolveToolName } from './pricing'
import { getTokenRate, tokensToCredits } from './token-rates'

// Billing kill switch — cached from DB app_settings
let _billingEnabled: boolean | null = null
let _billingCheckedAt = 0
const BILLING_CACHE_TTL = 60_000 // 1 minute

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

/**
 * Check if user has enough credits for a tool call.
 */
export async function checkBalance(userId: string, toolName: string): Promise<{ ok: boolean; balance: number; cost: number }> {
  const price = await getToolPrice(toolName)
  if (!price) return { ok: true, balance: 0, cost: 0 } // Unknown tool = free (fail open)
  if (price.isFree) return { ok: true, balance: 0, cost: 0 }

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
  const admin = getSupabaseAdmin()
  let { data } = await admin
    .from('credit_balances')
    .select('balance')
    .eq('user_id', userId)
    .single()

  // Auto-initialize for users without a credit_balances row (e.g. old users)
  if (!data) {
    const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'welcome_credits').single()
    const welcomeCredits = parseInt(setting?.value || '500')
    if (welcomeCredits > 0) {
      await addCredits(userId, welcomeCredits)
      try {
        await admin.from('credit_purchases').insert({
          user_id: userId, stripe_session_id: `welcome_auto_${Date.now()}`,
          credits: welcomeCredits, amount_usd: 0, status: 'completed', source: 'welcome',
        })
      } catch { /* ignore duplicate */ }
    } else {
      await admin.from('credit_balances').upsert({ user_id: userId, balance: 0, lifetime_purchased: 0, lifetime_used: 0 }, { onConflict: 'user_id' })
    }
    const { data: fresh } = await admin.from('credit_balances').select('balance').eq('user_id', userId).single()
    data = fresh
  }

  const balance = Number(data?.balance ?? 0)

  if (balance >= estimatedCredits) {
    return { ok: true, balance }
  }

  return {
    ok: false,
    balance,
    response: new Response(
      JSON.stringify({
        error: 'insufficient_credits',
        balance,
        needed: estimatedCredits,
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
  })
  if (!error) return data ?? 0

  // Fallback if RPC not yet deployed: separate deduct + log (temporary)
  console.warn('[billing] deduct_and_log RPC not available, using fallback:', error.message)
  const { data: bal } = await admin
    .from('credit_balances')
    .select('balance, lifetime_used')
    .eq('user_id', userId)
    .single()
  if (!bal) return 0
  const remaining = Math.max(0, bal.balance - credits)
  await admin
    .from('credit_balances')
    .update({ balance: remaining, lifetime_used: (bal.lifetime_used || 0) + credits, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  await admin.from('usage_logs').insert({
    user_id: userId, api_key_id: apiKeyId || null, tool_name: toolName,
    model_used: model || null, credits_charged: credits,
    input_tokens: inputTokens || null, output_tokens: outputTokens || null,
    duration_ms: durationMs || null, source: source || 'app',
  })
  return remaining
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
 * Deduct credits based on actual token usage (for OpenRouter/Bedrock/Google calls).
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
): Promise<{ charged: number; remaining: number }> {
  if (!(await isBillingEnabled())) return { charged: 0, remaining: 0 }
  let rate = await getTokenRate(modelId)
  let usedFallback = false
  if (!rate) {
    console.warn(`[billing] WARNING: No token rate for "${modelId}". Using fallback $5/$25. Add it via Admin → Billing → Token Rates.`)
    rate = { model_id: `unknown:${modelId}`, display_name: 'Fallback', input_per_1m: 5, output_per_1m: 25, markup: 2, is_active: true }
    usedFallback = true
  }

  const credits = tokensToCredits(rate, inputTokens, outputTokens)
  if (credits <= 0) return { charged: 0, remaining: 0 }

  const remaining = await deductAndLog(userId, credits, toolName, usedFallback ? `unknown:${modelId}` : modelId, inputTokens, outputTokens, durationMs, apiKeyId ? 'mcp' : 'app', apiKeyId)
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

/**
 * Add credits to a user's balance (after Stripe payment).
 */
export async function addCredits(userId: string, credits: number): Promise<number> {
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('credit_balances')
    .select('balance, lifetime_purchased')
    .eq('user_id', userId)
    .single()

  const newBalance = (data?.balance ?? 0) + credits
  const newPurchased = (data?.lifetime_purchased ?? 0) + credits

  await admin
    .from('credit_balances')
    .upsert({
      user_id: userId,
      balance: newBalance,
      lifetime_purchased: newPurchased,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return newBalance
}
