import type { SubscriptionPlan } from './plans'

export type BillingInterval = 'month' | 'year'

export function getSubscriptionGrantCredits(plan: SubscriptionPlan, interval: BillingInterval): number {
  return interval === 'year' ? plan.monthlyCredits * 12 : plan.monthlyCredits
}

export function getSubscriptionPurchaseSource(interval: BillingInterval): 'subscription' | 'subscription_annual' {
  return interval === 'year' ? 'subscription_annual' : 'subscription'
}

export function buildSubscriptionPurchaseKey(subscriptionId: string, invoiceId: string): string {
  return `${subscriptionId}:${invoiceId}`
}
