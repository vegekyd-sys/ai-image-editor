import { describe, expect, it } from 'vitest'
import { resolvePendingAppleTrialCreditExpiry } from '@/lib/billing/apple-pending-claim'

describe('pending Apple introductory trial credit expiry', () => {
  const purchasedAt = new Date('2026-08-23T17:19:52.621Z')
  const compressedReceiptExpiry = new Date('2026-08-23T17:21:49.000Z')

  it.each(['Sandbox', 'Xcode', 'LocalTesting', 'LOCAL_TESTING'])(
    'keeps the three-day product window in accelerated %s testing',
    environment => {
      const result = resolvePendingAppleTrialCreditExpiry({
        environment,
        receiptExpiresAt: compressedReceiptExpiry,
        pendingCreatedAt: purchasedAt,
      })

      expect(result.toISOString()).toBe('2026-08-26T17:19:52.621Z')
    },
  )

  it('uses the signed Apple expiry unchanged in Production', () => {
    const productionExpiry = new Date('2026-08-26T17:19:49.000Z')
    const result = resolvePendingAppleTrialCreditExpiry({
      environment: 'Production',
      receiptExpiresAt: productionExpiry,
      pendingCreatedAt: purchasedAt,
    })

    expect(result).toBe(productionExpiry)
  })

  it('never shortens a receipt window that is already longer', () => {
    const longerReceiptExpiry = new Date('2026-08-30T17:19:49.000Z')
    const result = resolvePendingAppleTrialCreditExpiry({
      environment: 'Sandbox',
      receiptExpiresAt: longerReceiptExpiry,
      pendingCreatedAt: purchasedAt,
    })

    expect(result).toBe(longerReceiptExpiry)
  })
})
