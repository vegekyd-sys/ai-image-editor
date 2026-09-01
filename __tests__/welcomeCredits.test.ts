import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  DEFAULT_WELCOME_CREDITS,
  getConfiguredWelcomeCredits,
  resolveWelcomeCredits,
} from '@/lib/billing/welcome-credits'

const root = path.resolve(__dirname, '..')

describe('welcome credits source of truth', () => {
  it('defaults new-account grants to 500 while preserving an explicit admin value', () => {
    expect(DEFAULT_WELCOME_CREDITS).toBe(500)
    expect(resolveWelcomeCredits(undefined)).toBe(500)
    expect(resolveWelcomeCredits('not-a-number')).toBe(500)
    expect(resolveWelcomeCredits('')).toBe(500)
    expect(resolveWelcomeCredits('-1')).toBe(500)
    expect(resolveWelcomeCredits('0')).toBe(0)
    expect(resolveWelcomeCredits('750')).toBe(750)
  })

  it('reads the configured app setting through the shared resolver', async () => {
    const single = vi.fn(async () => ({ data: { value: '500' } }))
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))

    await expect(getConfiguredWelcomeCredits({ from } as never)).resolves.toBe(500)
    expect(from).toHaveBeenCalledWith('app_settings')
    expect(eq).toHaveBeenCalledWith('key', 'welcome_credits')
  })

  it('ships a config migration that never rewrites existing balances', () => {
    const migration = readFileSync(
      path.join(root, 'supabase/migrations/20260719064316_set_welcome_credits_500.sql'),
      'utf8',
    )
    expect(migration).toContain("VALUES ('welcome_credits', '500', NOW())")
    expect(migration).not.toMatch(/(?:UPDATE|INSERT INTO)\s+(?:public\.)?credit_balances/i)
  })

  it('routes browser registration through the shared signup credit initializer', () => {
    const grantPaths = [
      'src/app/api/auth/callback/route.ts',
      'src/app/api/auth/activate/route.ts',
      'src/app/api/auth/complete/route.ts',
      'src/app/api/auth/validate-invite/route.ts',
    ]
    for (const grantPath of grantPaths) {
      const source = readFileSync(path.join(root, grantPath), 'utf8')
      expect(source, grantPath).toContain('initializeSignupCredits')
      expect(source, grantPath).not.toMatch(/welcome_credits'[\s\S]{0,200}(?:parseInt|\|\|\s*'500')/)
    }
    expect(readFileSync(path.join(root, 'src/lib/billing/signup-credits.ts'), 'utf8'))
      .toContain('getConfiguredWelcomeCredits')
  })

  it('uses the shared fallback in the admin configuration UI', () => {
    const adminPage = readFileSync(path.join(root, 'src/app/admin/page.tsx'), 'utf8')
    expect(adminPage).toContain('DEFAULT_WELCOME_CREDITS')
    expect(adminPage).not.toMatch(/welcomeCredits\s*\?\?\s*500|parseInt\(welcomeInput\)\s*\|\|\s*500/)
  })

  it('never uses a read-modify-upsert helper to grant credits', () => {
    const credits = readFileSync(path.join(root, 'src/lib/billing/credits.ts'), 'utf8')
    const adminGrant = readFileSync(path.join(root, 'src/app/api/admin/add-credits/route.ts'), 'utf8')
    const agentGrant = readFileSync(path.join(root, 'src/app/api/agent/register/verify/route.ts'), 'utf8')
    const guard = readFileSync(
      path.join(root, 'supabase/migrations/20260830034219_protect_credit_balance_counters.sql'),
      'utf8',
    )

    expect(credits).not.toContain('function addCredits')
    expect(adminGrant).toContain('grantCreditsAndRecordPurchase')
    expect(agentGrant).toContain("p_channel: 'agent_registration'")
    expect(guard).toContain('NEW.lifetime_purchased < OLD.lifetime_purchased')
    expect(guard).toContain('BEFORE UPDATE ON public.credit_balances')
  })
})
