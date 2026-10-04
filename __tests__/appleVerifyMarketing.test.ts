import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  applyAppleSignedTransaction: vi.fn(),
  getActiveSubscription: vi.fn(),
  recordFirstPartyMarketingEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
      }),
    },
  }),
}))

vi.mock('@/lib/billing/apple', () => ({
  applyAppleSignedTransaction: mocks.applyAppleSignedTransaction,
}))

vi.mock('@/lib/billing/subscription', () => ({
  getActiveSubscription: mocks.getActiveSubscription,
}))

vi.mock('@/lib/marketing/meta-capi', () => ({
  recordFirstPartyMarketingEvent: mocks.recordFirstPartyMarketingEvent,
}))

function request(body: Record<string, unknown>): NextRequest {
  return new Request('https://www.makaron.app/api/billing/apple/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'MakaronIOS',
    },
    body: JSON.stringify(body),
  }) as NextRequest
}

function appleResult(overrides: Record<string, unknown> = {}) {
  return {
    transaction: {},
    purchaseType: 'subscription',
    credited: true,
    credits: 36000,
    amountUsd: 189.99,
    productId: 'app.makaron.ios.subscription.pro.annual',
    transactionId: '200000000000002',
    originalTransactionId: '200000000000002',
    planId: 'pro',
    billingInterval: 'year',
    balance: { balance: 36000, lifetimePurchased: 36000, lifetimeUsed: 0 },
    ...overrides,
  }
}

describe('Apple verification marketing telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applyAppleSignedTransaction.mockResolvedValue(appleResult())
    mocks.getActiveSubscription.mockResolvedValue(null)
    mocks.recordFirstPartyMarketingEvent.mockResolvedValue(undefined)
  })

  it('records a server-verified subscription once it is credited', async () => {
    const { POST } = await import('@/app/api/billing/apple/verify/route')
    const req = request({
      signedTransactionInfo: 'signed-subscription',
      metaEventId: 'checkout.subscription.123',
      attribution: { utm_campaign: 'paid_subscription_test' },
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(mocks.recordFirstPartyMarketingEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'Subscribe',
      eventId: 'apple.subscription.200000000000002',
      userId: '11111111-1111-4111-8111-111111111111',
      value: 189.99,
      currency: 'USD',
      customData: expect.objectContaining({
        provider: 'apple',
        plan_id: 'pro',
        billing_interval: 'year',
        checkout_event_id: 'checkout.subscription.123',
        utm_campaign: 'paid_subscription_test',
      }),
    }))
  })

  it('does not record a duplicate success when Apple credits were already applied', async () => {
    mocks.applyAppleSignedTransaction.mockResolvedValue(appleResult({ credited: false, credits: 0 }))
    const { POST } = await import('@/app/api/billing/apple/verify/route')

    const response = await POST(request({ signedTransactionInfo: 'signed-subscription' }))

    expect(response.status).toBe(200)
    expect(mocks.recordFirstPartyMarketingEvent).not.toHaveBeenCalled()
  })
})
