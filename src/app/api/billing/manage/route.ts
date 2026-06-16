import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/billing/stripe'
import { getOrCreateStripeCustomer } from '@/lib/billing/subscription'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const customerId = await getOrCreateStripeCustomer(user.id, user.email!)
    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://www.makaron.app/dashboard',
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[billing/manage] failed to create portal session:', error)
    return NextResponse.json({ error: 'Unable to open billing portal' }, { status: 500 })
  }
}
