import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/billing/stripe'
import { SUBSCRIPTION_PLANS, type PlanId } from '@/lib/billing/plans'
import { getOrCreateStripeCustomer } from '@/lib/billing/subscription'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { planId, interval, returnPath } = await req.json() as { planId: PlanId; interval: 'month' | 'year'; returnPath?: string }

  const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId)
  if (!plan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  if (interval !== 'month' && interval !== 'year') {
    return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
  }

  const priceId = interval === 'month' ? plan.monthlyPriceId : plan.annualPriceId
  if (!priceId) {
    return NextResponse.json({ error: 'Stripe price not configured for this plan' }, { status: 500 })
  }

  const stripe = getStripe()
  const origin = req.headers.get('origin') || 'https://www.makaron.app'

  // Get or create Stripe customer (linked to our user)
  const customerId = await getOrCreateStripeCustomer(user.id, user.email!)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    metadata: {
      user_id: user.id,
      plan_id: planId,
      interval,
    },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: returnPath ? `${origin}${returnPath}?topped_up=1` : `${origin}/dashboard?subscription=success`,
    cancel_url: returnPath ? `${origin}${returnPath}` : `${origin}/dashboard?subscription=cancelled`,
  })

  return NextResponse.json({ url: session.url })
}
