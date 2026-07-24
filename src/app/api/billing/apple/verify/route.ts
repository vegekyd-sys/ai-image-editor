import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyAppleSignedTransaction } from '@/lib/billing/apple'
import { getActiveSubscription } from '@/lib/billing/subscription'
import { recordFirstPartyMarketingEvent } from '@/lib/marketing/meta-capi'

interface AppleVerifyBody {
  signedTransactionInfo?: string
  metaEventId?: string
  attribution?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as AppleVerifyBody | null
  if (!body?.signedTransactionInfo) {
    return NextResponse.json({ error: 'Missing signedTransactionInfo' }, { status: 400 })
  }

  try {
    const result = await applyAppleSignedTransaction({
      userId: user.id,
      signedTransactionInfo: body.signedTransactionInfo,
      grantCredits: true,
    })
    if (result.credited) {
      await recordFirstPartyMarketingEvent({
        eventName: result.purchaseType === 'subscription' ? 'Subscribe' : 'Purchase',
        eventId: `apple.${result.purchaseType}.${result.transactionId}`,
        eventSourceUrl: 'https://www.makaron.app/dashboard',
        userId: user.id,
        value: result.amountUsd,
        currency: 'USD',
        request: req,
        customData: {
          provider: 'apple',
          product_id: result.productId,
          transaction_id: result.transactionId,
          original_transaction_id: result.originalTransactionId,
          credits: result.credits,
          checkout_event_id: body.metaEventId,
          plan_id: result.planId,
          billing_interval: result.billingInterval,
          tier: result.tierId,
          ...body.attribution,
        },
      })
    }
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
