/**
 * Subscription plan definitions.
 * Stripe Price IDs are stored in env vars (set after running scripts/setup-stripe-plans.ts).
 */

export interface SubscriptionPlan {
  id: PlanId
  name: string
  monthlyCredits: number
  monthlyPrice: number   // cents
  annualPrice: number    // cents (total for year, ~20% discount)
  monthlyPriceId: string // Stripe Price ID (from env)
  annualPriceId: string  // Stripe Price ID (from env)
}

export type PlanId = 'basic' | 'pro' | 'business'

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    monthlyCredits: 1200,
    monthlyPrice: 990,       // $9.90/mo
    annualPrice: 9500,       // $95/yr ≈ $7.92/mo (20% off)
    monthlyPriceId: process.env.STRIPE_PRICE_BASIC_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_BASIC_ANNUAL || '',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyCredits: 3000,
    monthlyPrice: 1990,      // $19.90/mo
    annualPrice: 19100,      // $191/yr ≈ $15.92/mo (20% off)
    monthlyPriceId: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
  },
  {
    id: 'business',
    name: 'Business',
    monthlyCredits: 10000,
    monthlyPrice: 4990,      // $49.90/mo
    annualPrice: 47900,      // $479/yr ≈ $39.92/mo (20% off)
    monthlyPriceId: process.env.STRIPE_PRICE_BUSINESS_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_BUSINESS_ANNUAL || '',
  },
]

export function getPlan(planId: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find(p => p.id === planId)
}

export function getPlanByPriceId(stripePriceId: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find(
    p => p.monthlyPriceId === stripePriceId || p.annualPriceId === stripePriceId
  )
}
