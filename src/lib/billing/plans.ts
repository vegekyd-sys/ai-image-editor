/**
 * Subscription plan definitions.
 * Stripe Price IDs are stored in env vars (set after running scripts/setup-stripe-plans.ts).
 */

import { CREDIT_TIERS, type TierId } from './tiers'

export interface SubscriptionPlan {
  id: PlanId
  name: string
  monthlyCredits: number
  monthlyPrice: number   // cents
  annualPrice: number    // cents (total for year, ~20% discount)
  monthlyPriceId: string // Stripe Price ID (from env)
  annualPriceId: string  // Stripe Price ID (from env)
  monthlyAppleProductId: string // App Store Connect product ID
  annualAppleProductId: string  // App Store Connect product ID
}

export type PlanId = 'basic' | 'pro' | 'business'

const APPLE_SUBSCRIPTION_PRICES: Record<PlanId, { month: number; year: number }> = {
  basic: { month: 999, year: 9499 },
  pro: { month: 1999, year: 18999 },
  business: { month: 4999, year: 47999 },
}

const APPLE_TOPUP_PRICES: Record<TierId, number> = {
  starter: 499,
  pro: 1999,
  team: 4999,
  studio: 9999,
  enterprise: 19999,
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    monthlyCredits: 1200,
    monthlyPrice: 990,       // $9.90/mo
    annualPrice: 9500,       // $95/yr ≈ $7.92/mo (20% off)
    monthlyPriceId: process.env.STRIPE_PRICE_BASIC_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_BASIC_ANNUAL || '',
    monthlyAppleProductId: process.env.APPLE_PRODUCT_BASIC_MONTHLY || 'app.makaron.ios.subscription.basic.monthly',
    annualAppleProductId: process.env.APPLE_PRODUCT_BASIC_ANNUAL || 'app.makaron.ios.subscription.basic.annual',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyCredits: 3000,
    monthlyPrice: 1990,      // $19.90/mo
    annualPrice: 19100,      // $191/yr ≈ $15.92/mo (20% off)
    monthlyPriceId: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
    monthlyAppleProductId: process.env.APPLE_PRODUCT_PRO_MONTHLY || 'app.makaron.ios.subscription.pro.monthly',
    annualAppleProductId: process.env.APPLE_PRODUCT_PRO_ANNUAL || 'app.makaron.ios.subscription.pro.annual',
  },
  {
    id: 'business',
    name: 'Business',
    monthlyCredits: 10000,
    monthlyPrice: 4990,      // $49.90/mo
    annualPrice: 47900,      // $479/yr ≈ $39.92/mo (20% off)
    monthlyPriceId: process.env.STRIPE_PRICE_BUSINESS_MONTHLY || '',
    annualPriceId: process.env.STRIPE_PRICE_BUSINESS_ANNUAL || '',
    monthlyAppleProductId: process.env.APPLE_PRODUCT_BUSINESS_MONTHLY || 'app.makaron.ios.subscription.business.monthly',
    annualAppleProductId: process.env.APPLE_PRODUCT_BUSINESS_ANNUAL || 'app.makaron.ios.subscription.business.annual',
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

export function getPlanByAppleProductId(productId: string): { plan: SubscriptionPlan; interval: 'month' | 'year' } | undefined {
  for (const plan of SUBSCRIPTION_PLANS) {
    if (plan.monthlyAppleProductId === productId) return { plan, interval: 'month' }
    if (plan.annualAppleProductId === productId) return { plan, interval: 'year' }
  }
  return undefined
}

export function getAppleTopUpProducts() {
  return CREDIT_TIERS.map(tier => ({
    tierId: tier.id,
    name: tier.name,
    productId: process.env[`APPLE_TOPUP_${tier.id.toUpperCase()}`] || `app.makaron.ios.topup.${tier.id}`,
    credits: tier.credits,
    price: APPLE_TOPUP_PRICES[tier.id],
  })).filter(product => product.productId)
}

export function getTopUpByAppleProductId(productId: string): ReturnType<typeof getAppleTopUpProducts>[number] | undefined {
  return getAppleTopUpProducts().find(product => product.productId === productId)
}

export function getAppleSubscriptionProducts() {
  return SUBSCRIPTION_PLANS.flatMap(plan => [
    {
      planId: plan.id,
      name: plan.name,
      interval: 'month' as const,
      productId: plan.monthlyAppleProductId,
      credits: plan.monthlyCredits,
      price: APPLE_SUBSCRIPTION_PRICES[plan.id].month,
    },
    {
      planId: plan.id,
      name: plan.name,
      interval: 'year' as const,
      productId: plan.annualAppleProductId,
      credits: plan.monthlyCredits * 12,
      price: APPLE_SUBSCRIPTION_PRICES[plan.id].year,
    },
  ]).filter(product => product.productId)
}
