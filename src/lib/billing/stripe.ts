import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured')
    _stripe = new Stripe(key, { apiVersion: '2026-03-25.dahlia' })
  }
  return _stripe
}

export const CREDIT_TIERS = [
  { id: 'starter', name: 'Starter', price: 500, credits: 500, unitPrice: '$0.010' },
  { id: 'pro', name: 'Pro', price: 2000, credits: 2200, unitPrice: '$0.009' },
  { id: 'team', name: 'Team', price: 5000, credits: 6000, unitPrice: '$0.008' },
] as const

export type TierId = typeof CREDIT_TIERS[number]['id']
