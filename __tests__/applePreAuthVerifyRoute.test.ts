import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/billing/apple/verify/route'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  prepare: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/billing/apple', () => ({
  applyAppleSignedTransaction: vi.fn(),
}))
vi.mock('@/lib/billing/apple-pending-claim', () => ({
  APPLE_PENDING_CLAIM_COOKIE: 'mkr_apple_trial_claim',
  APPLE_PENDING_CLAIM_MAX_AGE_SECONDS: 86_400,
  preparePendingAppleTrialClaim: mocks.prepare,
}))
vi.mock('@/lib/billing/subscription', () => ({ getActiveSubscription: vi.fn() }))
vi.mock('@/lib/marketing/meta-capi', () => ({ recordFirstPartyMarketingEvent: vi.fn() }))

describe('pre-registration Apple trial verification route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    mocks.prepare.mockResolvedValue({
      claimToken: 'server-secret-claim-token',
      expiresAt: '2026-08-20T00:00:00.000Z',
    })
  })

  it('stores an iOS introductory trial and returns only an HttpOnly claim cookie', async () => {
    const request = new NextRequest('http://localhost:3001/api/billing/apple/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MakaronIOS',
      },
      body: JSON.stringify({
        signedTransactionInfo: 'signed-transaction',
        intent: 'preauth_trial',
        metaEventId: 'checkout-event',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      pendingClaim: true,
      expiresAt: '2026-08-20T00:00:00.000Z',
    })
    expect(body).not.toHaveProperty('claimToken')
    expect(response.cookies.get('mkr_apple_trial_claim')?.value).toBe('server-secret-claim-token')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      signedTransactionInfo: 'signed-transaction',
      metaEventId: 'checkout-event',
    }))
  })

  it('does not expose the pre-auth purchase path to a normal web browser', async () => {
    const response = await POST(new NextRequest('https://www.makaron.app/api/billing/apple/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ signedTransactionInfo: 'signed-transaction', intent: 'preauth_trial' }),
    }))

    expect(response.status).toBe(401)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('does not expose server verification details after Apple completes the purchase', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('private server configuration detail'))
    const response = await POST(new NextRequest('http://localhost:3001/api/billing/apple/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MakaronIOS' },
      body: JSON.stringify({ signedTransactionInfo: 'signed-transaction', intent: 'preauth_trial' }),
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      code: 'APPLE_TRIAL_VERIFICATION_FAILED',
      error: 'Apple trial verification failed',
    })
    expect(JSON.stringify(body)).not.toContain('private server configuration detail')
  })
})
