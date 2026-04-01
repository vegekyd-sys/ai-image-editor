export const CREDIT_TIERS = [
  { id: 'starter', name: 'Starter', price: 500, credits: 500, unitPrice: '$0.010' },
  { id: 'pro', name: 'Pro', price: 2000, credits: 2200, unitPrice: '$0.009' },
  { id: 'team', name: 'Team', price: 5000, credits: 6000, unitPrice: '$0.008' },
] as const

export type TierId = typeof CREDIT_TIERS[number]['id']
