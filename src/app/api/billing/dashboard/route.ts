import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBalance } from '@/lib/billing/credits'
import { getActiveSubscription } from '@/lib/billing/subscription'
import { getSupabaseAdmin } from '@/lib/supabase/service'

// Single endpoint returning all dashboard data — avoids 3 separate auth calls
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()

  const [balance, subscription, keysResult, usageResult] = await Promise.all([
    getBalance(user.id),
    getActiveSubscription(user.id),
    admin.from('api_keys')
      .select('id, key_prefix, name, is_active, created_at, last_used_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    admin.from('usage_logs')
      .select('tool_name, model_used, credits_charged, input_tokens, output_tokens, source, duration_ms, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(0, 49),
  ])

  return NextResponse.json({
    ...balance,
    subscription: subscription ? {
      planId: subscription.planId,
      status: subscription.status,
      billingInterval: subscription.billingInterval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    } : null,
    keys: keysResult.data ?? [],
    usage: usageResult.data ?? [],
  })
}
