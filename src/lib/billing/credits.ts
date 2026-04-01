import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getToolPrice, resolveToolName } from './pricing'

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
 * Deduct credits after a successful tool call.
 */
export async function deductCredits(
  userId: string,
  apiKeyId: string,
  mcpToolName: string,
  model?: string,
  durationMs?: number,
): Promise<{ charged: number; remaining: number }> {
  const toolName = resolveToolName(mcpToolName, model)
  const price = await getToolPrice(toolName)
  if (!price || price.isFree) return { charged: 0, remaining: 0 }

  const credits = price.credits
  const admin = getSupabaseAdmin()

  // Atomic deduction
  const { data, error } = await admin.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: credits,
  })

  // Fallback if RPC doesn't exist: manual update
  let remaining = 0
  if (error) {
    // Manual deduction
    const { data: bal } = await admin
      .from('credit_balances')
      .select('balance, lifetime_used')
      .eq('user_id', userId)
      .single()
    if (bal) {
      remaining = Math.max(0, bal.balance - credits)
      await admin
        .from('credit_balances')
        .update({
          balance: remaining,
          lifetime_used: (bal.lifetime_used || 0) + credits,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
    }
  } else {
    remaining = data ?? 0
  }

  // Log usage
  await admin.from('usage_logs').insert({
    user_id: userId,
    api_key_id: apiKeyId,
    tool_name: toolName,
    model_used: model,
    credits_charged: credits,
    duration_ms: durationMs,
  })

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
