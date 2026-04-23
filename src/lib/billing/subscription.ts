import { getSupabaseAdmin } from '@/lib/supabase/service'
import { getStripe } from './stripe'

export interface Subscription {
  id: string
  userId: string
  stripeSubscriptionId: string
  stripeCustomerId: string
  planId: string
  billingInterval: 'month' | 'year'
  status: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/**
 * Get user's active subscription (if any).
 */
export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!data) return null

  return {
    id: data.id,
    userId: data.user_id,
    stripeSubscriptionId: data.stripe_subscription_id,
    stripeCustomerId: data.stripe_customer_id,
    planId: data.plan_id,
    billingInterval: data.billing_interval,
    status: data.status,
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
  }
}

/**
 * Get user's current plan tier.
 */
export async function getUserPlan(userId: string): Promise<'free' | 'basic' | 'pro' | 'business'> {
  const sub = await getActiveSubscription(userId)
  if (!sub || sub.status === 'canceled') return 'free'
  return sub.planId as 'basic' | 'pro' | 'business'
}

/**
 * Get or create a Stripe Customer for the user.
 * Stores stripe_customer_id in credit_balances table.
 */
export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const admin = getSupabaseAdmin()

  // Check if we already have a Stripe customer ID
  const { data } = await admin
    .from('credit_balances')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single()

  if (data?.stripe_customer_id) {
    // Validate existing customer still exists in Stripe (may be from old company)
    const stripe = getStripe()
    try {
      await stripe.customers.retrieve(data.stripe_customer_id)
      return data.stripe_customer_id
    } catch {
      console.warn(`[billing] Stripe customer ${data.stripe_customer_id} not found, creating new one`)
    }
  }

  // Create new Stripe customer
  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email,
    metadata: { user_id: userId },
  })

  // Store it (upsert in case credit_balances row doesn't exist yet)
  await admin
    .from('credit_balances')
    .upsert({
      user_id: userId,
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id', ignoreDuplicates: false })

  return customer.id
}

/**
 * Upsert subscription record from Stripe data.
 */
export async function upsertSubscription(
  userId: string,
  stripeSubscriptionId: string,
  stripeCustomerId: string,
  planId: string,
  billingInterval: 'month' | 'year',
  status: string,
  currentPeriodStart: Date | null,
  currentPeriodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
): Promise<void> {
  const admin = getSupabaseAdmin()
  await admin
    .from('subscriptions')
    .upsert({
      user_id: userId,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: stripeCustomerId,
      plan_id: planId,
      billing_interval: billingInterval,
      status,
      current_period_start: currentPeriodStart?.toISOString() ?? null,
      current_period_end: currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
}
