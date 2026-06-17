import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBalance } from '@/lib/billing/credits'
import { getActiveSubscription } from '@/lib/billing/subscription'

// GET: get current user's credit balance + subscription info
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [balance, subscription] = await Promise.all([
    getBalance(user.id),
    getActiveSubscription(user.id),
  ])

  return NextResponse.json({
    ...balance,
    subscription: subscription ? {
      provider: subscription.provider,
      planId: subscription.planId,
      status: subscription.status,
      billingInterval: subscription.billingInterval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    } : null,
  })
}
