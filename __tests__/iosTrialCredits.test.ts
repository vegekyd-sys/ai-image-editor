import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  DEFAULT_IOS_TRIAL_CREDITS,
  getConfiguredIOSTrialCredits,
  resolveIOSTrialCredits,
} from '@/lib/billing/ios-trial'
import { getConfiguredAppleProducts } from '@/lib/billing/apple'

const root = path.resolve(__dirname, '..')

describe('iOS direct trial credits', () => {
  it('defaults to 1,500 and accepts an explicit admin value', () => {
    expect(DEFAULT_IOS_TRIAL_CREDITS).toBe(1500)
    expect(resolveIOSTrialCredits(undefined)).toBe(1500)
    expect(resolveIOSTrialCredits('invalid')).toBe(1500)
    expect(resolveIOSTrialCredits('-1')).toBe(1500)
    expect(resolveIOSTrialCredits('0')).toBe(0)
    expect(resolveIOSTrialCredits('1750')).toBe(1750)
  })

  it('reads ios_trial_credits from app settings', async () => {
    const single = vi.fn(async () => ({ data: { value: '1500' } }))
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))

    await expect(getConfiguredIOSTrialCredits({ from } as never)).resolves.toBe(1500)
    expect(eq).toHaveBeenCalledWith('key', 'ios_trial_credits')
  })

  it('advertises the configured grant only on Basic monthly', () => {
    const products = getConfiguredAppleProducts(1750)
    expect(products.find(product => product.productId.endsWith('basic.monthly')))
      .toMatchObject({ introTrial: { days: 3, credits: 1750 } })
    expect(products.find(product => product.productId.endsWith('basic.annual')))
      .not.toHaveProperty('introTrial')
  })

  it('ships an idempotent migration with separate welcome and Apple trial claims', () => {
    const migration = readFileSync(
      path.join(root, 'supabase/migrations/20260817180000_ios_direct_trial_credits.sql'),
      'utf8',
    )
    expect(migration).toContain("VALUES ('ios_trial_credits', '1500', now())")
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS apple_trial_credit_claims')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION claim_welcome_credits')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION grant_apple_credits_and_record_purchase')
    expect(migration).toContain("p_source = 'trial'")
    expect(migration).toContain('trial_balance = credit_balances.trial_balance + EXCLUDED.trial_balance')
    expect(migration).toContain('ON CONFLICT DO NOTHING')
  })
})
