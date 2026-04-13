import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBalance } from '@/lib/billing/credits'
import { getActiveSubscription } from '@/lib/billing/subscription'

// GET: get current user's credit balance + subscription info
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [balance, subscription] = await Promise.all([
    getBalance(user.id),
    getActiveSubscription(user.id),
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
  })
}
