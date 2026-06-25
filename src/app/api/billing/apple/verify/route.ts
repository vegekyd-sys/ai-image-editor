import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyAppleSignedTransaction } from '@/lib/billing/apple'
import { getActiveSubscription } from '@/lib/billing/subscription'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { signedTransactionInfo?: string } | null
  if (!body?.signedTransactionInfo) {
    return NextResponse.json({ error: 'Missing signedTransactionInfo' }, { status: 400 })
  }

  try {
    const result = await applyAppleSignedTransaction({
      userId: user.id,
      signedTransactionInfo: body.signedTransactionInfo,
      grantCredits: true,
    })
    const subscription = await getActiveSubscription(user.id)

    return NextResponse.json({
      ok: true,
      purchaseType: result.purchaseType,
      credited: result.credited,
      credits: result.credits,
      balance: result.balance.balance,
      lifetimePurchased: result.balance.lifetimePurchased,
      lifetimeUsed: result.balance.lifetimeUsed,
      subscription: subscription ? {
        provider: subscription.provider,
        planId: subscription.planId,
        status: subscription.status,
        billingInterval: subscription.billingInterval,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      } : null,
    })
  } catch (error) {
    console.error('[billing/apple/verify] failed:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Apple purchase verification failed',
    }, { status: 400 })
  }
}
