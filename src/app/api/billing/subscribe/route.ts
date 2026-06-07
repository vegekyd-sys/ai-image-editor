import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/billing/stripe'
import { SUBSCRIPTION_PLANS, type PlanId } from '@/lib/billing/plans'
import { getOrCreateStripeCustomer } from '@/lib/billing/subscription'

function buildReturnUrl(origin: string, path: string | undefined, params: Record<string, string>) {
  const url = new URL(path || '/dashboard', origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { planId, interval, returnPath, metaEventId, attribution } = await req.json() as {
    planId: PlanId
    interval: 'month' | 'year'
    returnPath?: string
    metaEventId?: string
    attribution?: Record<string, unknown>
  }

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
      meta_event_id: metaEventId || '',
      attribution: JSON.stringify(attribution || {}).slice(0, 500),
      fbp: req.cookies.get('_fbp')?.value || '',
      fbc: req.cookies.get('_fbc')?.value || '',
    },
    subscription_data: {
      metadata: {
        user_id: user.id,
        plan_id: planId,
        interval,
        meta_event_id: metaEventId || '',
        attribution: JSON.stringify(attribution || {}).slice(0, 500),
        fbp: req.cookies.get('_fbp')?.value || '',
        fbc: req.cookies.get('_fbc')?.value || '',
      },
    },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: buildReturnUrl(origin, returnPath, {
      topped_up: '1',
      checkout_type: 'subscription',
      ...(metaEventId ? { meta_event_id: metaEventId } : {}),
    }),
    cancel_url: buildReturnUrl(origin, returnPath, {}),
  })

  return NextResponse.json({ url: session.url })
}
