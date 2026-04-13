import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/billing/stripe'
import { addCredits } from '@/lib/billing/credits'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getPlan, getPlanByPriceId } from '@/lib/billing/plans'
import { upsertSubscription } from '@/lib/billing/subscription'
import type Stripe from 'stripe'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[Stripe webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = getSupabaseAdmin()

  // ── One-time credit purchase ──────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session

    // Only handle one-time payments here (subscriptions handled via invoice.paid)
    if (session.mode === 'subscription') {
      // Subscription checkout — create subscription record
      const userId = session.metadata?.user_id
      const planId = session.metadata?.plan_id
      const interval = session.metadata?.interval as 'month' | 'year'
      const stripeSubscriptionId = session.subscription as string

      if (userId && planId && stripeSubscriptionId) {
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.toString() || ''

        // Fetch subscription details from Stripe
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any
        await upsertSubscription(
          userId,
          stripeSubscriptionId,
          customerId,
          planId,
          interval || 'month',
          sub.status,
          sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
          sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          sub.cancel_at_period_end ?? false,
        )
        console.log(`[Stripe webhook] Subscription created: user=${userId} plan=${planId} interval=${interval}`)
      }

      return NextResponse.json({ received: true })
    }

    // One-time payment
    const userId = session.metadata?.user_id
    const credits = parseInt(session.metadata?.credits || '0')
    const amountUsd = (session.amount_total || 0) / 100

    if (!userId || !credits) {
      console.error('[Stripe webhook] Missing metadata:', session.metadata)
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 })
    }

    await addCredits(userId, credits)

    await admin.from('credit_purchases').insert({
      user_id: userId,
      stripe_session_id: session.id,
      credits,
      amount_usd: amountUsd,
      status: 'completed',
      source: 'topup',
    })

    console.log(`[Stripe webhook] Added ${credits} credits to user ${userId} ($${amountUsd})`)
  }

  // ── Subscription invoice paid (recurring credit top-up) ───────
  if (event.type === 'invoice.paid') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = event.data.object as any
    const subscriptionId = invoice.subscription as string | null
    if (!subscriptionId) return NextResponse.json({ received: true })

    // Idempotency: check if we already processed this invoice
    const { data: existing } = await admin
      .from('credit_purchases')
      .select('id')
      .eq('stripe_invoice_id', invoice.id)
      .single()

    if (existing) {
      console.log(`[Stripe webhook] invoice.paid already processed: ${invoice.id}`)
      return NextResponse.json({ received: true })
    }

    // Look up subscription in our DB
    const { data: sub } = await admin
      .from('subscriptions')
      .select('user_id, plan_id')
      .eq('stripe_subscription_id', subscriptionId)
      .single()

    if (!sub) {
      // Subscription might not be in our DB yet (race with checkout.session.completed)
      // Try to resolve from invoice line items
      const lineItem = invoice.lines?.data?.[0] as { price?: { id?: string } | string } | undefined
      const priceId = typeof lineItem?.price === 'string' ? lineItem.price : (lineItem?.price as { id?: string })?.id
      const plan = priceId ? getPlanByPriceId(priceId) : null
      if (!plan) {
        console.warn(`[Stripe webhook] invoice.paid but no subscription found: ${subscriptionId}`)
        return NextResponse.json({ received: true })
      }
      // We can't credit without a user_id — log and skip
      console.warn(`[Stripe webhook] invoice.paid but subscription not in DB yet, skipping credit: ${subscriptionId}`)
      return NextResponse.json({ received: true })
    }

    const plan = getPlan(sub.plan_id)
    if (!plan) {
      console.error(`[Stripe webhook] Unknown plan_id: ${sub.plan_id}`)
      return NextResponse.json({ received: true })
    }

    // Add monthly credits
    await addCredits(sub.user_id, plan.monthlyCredits)

    // Record purchase (idempotent via unique stripe_invoice_id index)
    await admin.from('credit_purchases').insert({
      user_id: sub.user_id,
      stripe_session_id: subscriptionId,
      stripe_invoice_id: invoice.id,
      credits: plan.monthlyCredits,
      amount_usd: (invoice.amount_paid || 0) / 100,
      status: 'completed',
      source: 'subscription',
    })

    console.log(`[Stripe webhook] Subscription credit: +${plan.monthlyCredits} credits to user ${sub.user_id} (plan=${sub.plan_id}, invoice=${invoice.id})`)
  }

  // ── Subscription updated (plan change, status change) ─────────
  if (event.type === 'customer.subscription.updated') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = event.data.object as any
    const { data: dbSub } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', sub.id)
      .single()

    if (dbSub) {
      // Resolve plan from price
      const priceId = sub.items.data[0]?.price?.id
      const plan = priceId ? getPlanByPriceId(priceId) : null
      const interval = sub.items.data[0]?.price?.recurring?.interval as 'month' | 'year' | undefined

      await admin.from('subscriptions').update({
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        ...(plan ? { plan_id: plan.id } : {}),
        ...(interval ? { billing_interval: interval } : {}),
        updated_at: new Date().toISOString(),
      }).eq('stripe_subscription_id', sub.id)

      console.log(`[Stripe webhook] Subscription updated: ${sub.id} status=${sub.status} cancel_at_period_end=${sub.cancel_at_period_end}`)
    }
  }

  // ── Subscription deleted (canceled/expired) ───────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription

    await admin.from('subscriptions').update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
    }).eq('stripe_subscription_id', sub.id)

    // Credits never expire — user keeps remaining balance
    console.log(`[Stripe webhook] Subscription canceled: ${sub.id}`)
  }

  return NextResponse.json({ received: true })
}
