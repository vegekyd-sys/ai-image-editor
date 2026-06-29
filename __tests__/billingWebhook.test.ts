import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mockGrantCreditsAndRecordPurchase = vi.fn()
const mockFrom = vi.fn()
let mockStripeEvent: unknown

vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: vi.fn(() => mockStripeEvent),
    },
  }),
}))

vi.mock('@/lib/billing/credits', () => ({
  grantCreditsAndRecordPurchase: mockGrantCreditsAndRecordPurchase,
}))

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/lib/marketing/meta-capi', () => ({
  sendMetaCapiEvent: vi.fn(),
}))

function makeReq(): NextRequest {
  return new Request('https://www.makaron.app/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'test-signature' },
    body: '{}',
  }) as NextRequest
}

function chainWithSingle(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

function setupInvoicePaid({
  interval,
  existingPurchase = null,
}: {
  interval: 'month' | 'year'
  existingPurchase?: unknown
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'credit_purchases') return chainWithSingle(existingPurchase)
    if (table === 'subscriptions') {
      return chainWithSingle({
        user_id: 'user-1',
        plan_id: 'business',
        billing_interval: interval,
      })
    }
    return chainWithSingle(null)
  })
}

describe('billing webhook subscription grants', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    mockStripeEvent = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_annual',
          amount_paid: 47900,
          parent: {
            subscription_details: {
              subscription: 'sub_annual',
            },
          },
        },
      },
    }
    mockGrantCreditsAndRecordPurchase.mockResolvedValue({ granted: true, balance: 120000 })
  })

  it('grants twelve months of credits for an annual subscription invoice', async () => {
    setupInvoicePaid({ interval: 'year' })
    const { POST } = await import('@/app/api/billing/webhook/route')

    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mockGrantCreditsAndRecordPurchase).toHaveBeenCalledWith({
      userId: 'user-1',
      credits: 120000,
      amountUsd: 479,
      stripeSessionId: 'sub_annual:in_annual',
      stripeInvoiceId: 'in_annual',
      source: 'subscription_annual',
    })
  })

  it('grants one month of credits for a monthly subscription invoice', async () => {
    mockStripeEvent = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_monthly',
          amount_paid: 4990,
          parent: {
            subscription_details: {
              subscription: 'sub_monthly',
            },
          },
        },
      },
    }
    setupInvoicePaid({ interval: 'month' })
    const { POST } = await import('@/app/api/billing/webhook/route')

    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mockGrantCreditsAndRecordPurchase).toHaveBeenCalledWith({
      userId: 'user-1',
      credits: 10000,
      amountUsd: 49.9,
      stripeSessionId: 'sub_monthly:in_monthly',
      stripeInvoiceId: 'in_monthly',
      source: 'subscription',
    })
  })

  it('does not grant again when the invoice was already processed', async () => {
    setupInvoicePaid({ interval: 'year', existingPurchase: { id: 'purchase-1' } })
    const { POST } = await import('@/app/api/billing/webhook/route')

    const res = await POST(makeReq())

    expect(res.status).toBe(200)
    expect(mockGrantCreditsAndRecordPurchase).not.toHaveBeenCalled()
  })
})
