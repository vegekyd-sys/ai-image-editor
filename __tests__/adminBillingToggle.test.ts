import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(), isAdmin: vi.fn(), from: vi.fn(),
  upsert: vi.fn(), invalidateBillingCache: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.isAdmin }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }))
vi.mock('@/lib/billing/credits', () => ({ invalidateBillingCache: mocks.invalidateBillingCache }))
import { GET, PUT } from '@/app/api/admin/billing-toggle/route'
const request = (body: object) => new NextRequest('http://localhost/api/admin/billing-toggle', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticateRequest.mockResolvedValue({ auth: { userId: 'admin-fixture' } })
  mocks.isAdmin.mockResolvedValue(true)
  mocks.from.mockReturnValue({ upsert: mocks.upsert })
  mocks.upsert.mockResolvedValue({ error: null })
})
describe('billing settings authorization and persistence', () => {
  it.each(['anonymous', 'ordinary user'])('rejects %s before any settings access', async kind => {
    if (kind === 'anonymous') mocks.authenticateRequest.mockResolvedValue({ error: 'Unauthorized' })
    else mocks.isAdmin.mockResolvedValue(false)
    expect((await GET(request({}))).status).toBe(403)
    expect((await PUT(request({ enabled: false }))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('returns failure and keeps the billing cache when the database rejects writes', async () => {
    mocks.upsert.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } })
    const response = await PUT(request({ enabled: false }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to save billing settings' })
    expect(mocks.invalidateBillingCache).not.toHaveBeenCalled()
  })
  it('validates every field before writing a multi-setting request', async () => {
    expect((await PUT(request({ enabled: false, iosTrialCredits: -1 }))).status).toBe(400)
    expect((await PUT(request({ enabled: 'false' }))).status).toBe(400)
    expect((await PUT(request({ enabled: true, welcomeCredits: -1 }))).status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('persists all supplied settings atomically before invalidating the cache', async () => {
    const response = await PUT(request({ enabled: true, welcomeCredits: 750, iosTrialCredits: 1600.5 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: true, welcomeCredits: 750, iosTrialCredits: 1600 })
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith([
      { key: 'billing_enabled', value: 'true', updated_at: expect.any(String) },
      { key: 'welcome_credits', value: '750', updated_at: expect.any(String) },
      { key: 'ios_trial_credits', value: '1600', updated_at: expect.any(String) },
    ], { onConflict: 'key' })
    expect(mocks.invalidateBillingCache).toHaveBeenCalledOnce()
  })
  it('preserves omitted settings and does not invalidate billing for a credit-only change', async () => {
    expect((await PUT(request({ welcomeCredits: 0 }))).status).toBe(200)
    expect(mocks.upsert.mock.calls[0][0]).toEqual([{ key: 'welcome_credits', value: '0', updated_at: expect.any(String) }])
    expect(mocks.invalidateBillingCache).not.toHaveBeenCalled()
  })
})
