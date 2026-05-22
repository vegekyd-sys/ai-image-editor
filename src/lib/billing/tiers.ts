export const CREDIT_TIERS = [
  { id: 'starter', name: 'Starter', price: 500, credits: 500, unitPrice: '$0.010' },
  { id: 'pro', name: 'Pro', price: 2000, credits: 2200, unitPrice: '$0.009' },
  { id: 'team', name: 'Team', price: 5000, credits: 6000, unitPrice: '$0.008' },
  { id: 'studio', name: 'Studio', price: 10000, credits: 11500, unitPrice: '$0.0087' },
  { id: 'enterprise', name: 'Enterprise', price: 20000, credits: 24000, unitPrice: '$0.0083' },
] as const

export type TierId = typeof CREDIT_TIERS[number]['id']
