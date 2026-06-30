import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/billing/stripe'
import { grantCreditsAndRecordPurchase } from '@/lib/billing/credits'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getPlan, getPlanByPriceId } from '@/lib/billing/plans'
import { upsertSubscription } from '@/lib/billing/subscription'
import {
  buildSubscriptionPurchaseKey,
  getSubscriptionGrantCredits,
  getSubscriptionPurchaseSource,
  type BillingInterval,
} from '@/lib/billing/subscription-grants'
import { sendMetaCapiEvent } from '@/lib/marketing/meta-capi'
import type Stripe from 'stripe'

type SubscriptionLookup = {
  user_id: string
  plan_id: string
  billing_interval: BillingInterval
}

function parseMetadataJson(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

// Stripe 2026 puts subscription periods on the subscription item.
// Keep top-level fallback for older payloads and test fixtures.
function getSubscriptionPeriod(sub: any): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0]
  const start = item?.current_period_start ?? sub.current_period_start
  const end = item?.current_period_end ?? sub.current_period_end
  return {
    start: start ? new Date(start * 1000) : null,
    end: end ? new Date(end * 1000) : null,
  }
}

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
        const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any
        const period = getSubscriptionPeriod(sub)
        await upsertSubscription(
          userId,
          stripeSubscriptionId,
          customerId,
          planId,
          interval || 'month',
          sub.status,
          period.start,
          period.end,
          sub.cancel_at_period_end ?? false,
        )
        if (session.metadata?.meta_event_id) {
          const plan = getPlan(planId)
          await sendMetaCapiEvent({
            eventName: 'Subscribe',
            eventId: session.metadata.meta_event_id,
            userId,
            email: session.customer_details?.email,
            value: plan ? (interval === 'year' ? plan.annualPrice : plan.monthlyPrice) / 100 : undefined,
            currency: 'USD',
            fbp: session.metadata.fbp || undefined,
            fbc: session.metadata.fbc || undefined,
            eventSourceUrl: 'https://www.makaron.app/dashboard',
            customData: {
              plan_id: planId,
              billing_interval: interval,
              ...parseMetadataJson(session.metadata.attribution),
            },
          })
        }
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

    // Idempotency: check if we already processed this session
    const { data: existingPurchase } = await admin
      .from('credit_purchases')
      .select('id')
      .eq('stripe_session_id', session.id)
      .single()

    if (existingPurchase) {
      console.log(`[Stripe webhook] checkout.session already processed: ${session.id}`)
      return NextResponse.json({ received: true })
    }

    const stripeInvoiceId = typeof session.invoice === 'string'
      ? session.invoice
      : session.invoice?.id ?? null

    const grant = await grantCreditsAndRecordPurchase({
      userId,
      credits,
      amountUsd,
      stripeSessionId: session.id,
      stripeInvoiceId,
      source: 'topup',
    })
    if (!grant.granted) {
      console.log(`[Stripe webhook] checkout.session already processed: ${session.id}`)
      return NextResponse.json({ received: true })
    }

    if (session.metadata?.meta_event_id) {
      await sendMetaCapiEvent({
        eventName: 'Purchase',
        eventId: session.metadata.meta_event_id,
        userId,
        email: session.customer_details?.email,
        value: amountUsd,
        currency: 'USD',
        fbp: session.metadata.fbp || undefined,
        fbc: session.metadata.fbc || undefined,
        eventSourceUrl: 'https://www.makaron.app/dashboard',
        customData: {
          tier: session.metadata?.tier,
          credits,
          ...parseMetadataJson(session.metadata.attribution),
        },
      })
    }

    console.log(`[Stripe webhook] Added ${credits} credits to user ${userId} ($${amountUsd})`)
  }

  // ── Subscription invoice paid (recurring credit top-up) ───────
  // Use invoice.paid only (Stripe docs recommended). Do NOT also listen for
  // invoice.payment_succeeded or invoice_payment.paid — Stripe fires all three
  // for the same payment, causing triple credit grants.
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as any
    const invoiceId = invoice.id as string
    // Stripe 2026 API: subscription in parent.subscription_details.subscription
    const subscriptionId = (invoice.subscription ?? invoice.parent?.subscription_details?.subscription) as string | null

    if (!subscriptionId) return NextResponse.json({ received: true })

    // Idempotency: check if we already processed this invoice
    const { data: existing } = await admin
      .from('credit_purchases')
      .select('id')
      .eq('stripe_invoice_id', invoiceId)
      .single()

    if (existing) {
      console.log(`[Stripe webhook] invoice already processed: ${invoiceId}`)
      return NextResponse.json({ received: true })
    }

    // Look up subscription in our DB (retry — checkout.session.completed may still be writing)
    let sub: SubscriptionLookup | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await admin
        .from('subscriptions')
        .select('user_id, plan_id, billing_interval')
        .eq('stripe_subscription_id', subscriptionId)
        .single()
      if (data) { sub = data as SubscriptionLookup; break }
      if (attempt < 4) await new Promise(r => setTimeout(r, 2000))
    }

    if (!sub) {
      console.warn(`[Stripe webhook] invoice paid but subscription not in DB after retries: ${subscriptionId}`)
      return NextResponse.json({ received: true })
    }

    const plan = getPlan(sub.plan_id)
    if (!plan) {
      console.error(`[Stripe webhook] Unknown plan_id: ${sub.plan_id}`)
      return NextResponse.json({ received: true })
    }

    const interval = sub.billing_interval === 'year' ? 'year' : 'month'
    const credits = getSubscriptionGrantCredits(plan, interval)
    const grant = await grantCreditsAndRecordPurchase({
      userId: sub.user_id,
      credits,
      amountUsd: (invoice.amount_paid || 0) / 100,
      stripeSessionId: buildSubscriptionPurchaseKey(subscriptionId, invoiceId),
      stripeInvoiceId: invoiceId,
      source: getSubscriptionPurchaseSource(interval),
    })
    if (!grant.granted) {
      console.log(`[Stripe webhook] invoice already processed: ${invoiceId}`)
      return NextResponse.json({ received: true })
    }

    console.log(`[Stripe webhook] Subscription credit: +${credits} credits to user ${sub.user_id} (plan=${sub.plan_id}, interval=${interval}, invoice=${invoice.id})`)
  }

  // ── Subscription updated (plan change, status change) ─────────
  if (event.type === 'customer.subscription.updated') {
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
      const period = getSubscriptionPeriod(sub)

      await admin.from('subscriptions').update({
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_start: period.start?.toISOString() ?? null,
        current_period_end: period.end?.toISOString() ?? null,
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
