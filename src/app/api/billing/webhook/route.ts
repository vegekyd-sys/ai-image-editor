import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/billing/stripe'
import { addCredits } from '@/lib/billing/credits'
import { getSupabaseAdmin } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })

  const stripe = getStripe()
  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[Stripe webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const userId = session.metadata?.user_id
    const credits = parseInt(session.metadata?.credits || '0')
    const amountUsd = (session.amount_total || 0) / 100

    if (!userId || !credits) {
      console.error('[Stripe webhook] Missing metadata:', session.metadata)
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 })
    }

    // Add credits to user balance
    await addCredits(userId, credits)

    // Record purchase
    const admin = getSupabaseAdmin()
    await admin.from('credit_purchases').insert({
      user_id: userId,
      stripe_session_id: session.id,
      credits,
      amount_usd: amountUsd,
      status: 'completed',
    })

    console.log(`[Stripe webhook] Added ${credits} credits to user ${userId} ($${amountUsd})`)
  }

  return NextResponse.json({ received: true })
}
