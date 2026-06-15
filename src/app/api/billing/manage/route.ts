import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/billing/stripe'
import { getActiveSubscription, getStripeCustomerId } from '@/lib/billing/subscription'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getActiveSubscription(user.id)
  const customerId = sub?.stripeCustomerId ?? await getStripeCustomerId(user.id)
  if (!customerId) {
    return NextResponse.json({ error: 'No billing customer' }, { status: 400 })
  }

  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: 'https://www.makaron.app/dashboard',
  })

  return NextResponse.json({ url: session.url })
}
