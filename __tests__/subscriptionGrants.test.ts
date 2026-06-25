import { describe, expect, it } from 'vitest'
import {
  buildSubscriptionPurchaseKey,
  getSubscriptionGrantCredits,
  getSubscriptionPurchaseSource,
} from '@/lib/billing/subscription-grants'
import type { SubscriptionPlan } from '@/lib/billing/plans'

const businessPlan: SubscriptionPlan = {
  id: 'business',
  name: 'Business',
  monthlyCredits: 10000,
  monthlyPrice: 4990,
  annualPrice: 47900,
  monthlyPriceId: 'price_monthly',
  annualPriceId: 'price_annual',
  monthlyAppleProductId: 'app.makaron.ios.subscription.business.monthly',
  annualAppleProductId: 'app.makaron.ios.subscription.business.annual',
}

describe('subscription credit grants', () => {
  it('grants one month of credits for monthly subscriptions', () => {
    expect(getSubscriptionGrantCredits(businessPlan, 'month')).toBe(10000)
    expect(getSubscriptionPurchaseSource('month')).toBe('subscription')
  })

  it('grants twelve months of credits for annual subscriptions', () => {
    expect(getSubscriptionGrantCredits(businessPlan, 'year')).toBe(120000)
    expect(getSubscriptionPurchaseSource('year')).toBe('subscription_annual')
  })

  it('uses invoice-specific purchase keys so renewal ledger rows do not collide', () => {
    expect(buildSubscriptionPurchaseKey('sub_123', 'in_abc')).toBe('sub_123:in_abc')
  })
})
