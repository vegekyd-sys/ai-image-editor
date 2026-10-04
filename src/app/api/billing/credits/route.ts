import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getBalance } from '@/lib/billing/credits'
import { getActiveSubscription } from '@/lib/billing/subscription'

// GET: get current user's credit balance + subscription info.
// Supports both browser sessions and Makaron API keys.
export async function GET(req: Request) {
  const authResult = await authenticateRequest(req)
  if ('error' in authResult) return authResult.error
  const { userId } = authResult.auth

  const balance = await getBalance(userId)
  const subscription = await getActiveSubscription(userId).catch((error) => {
    console.error('[billing/credits] subscription lookup failed:', error)
    return null
  })

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
