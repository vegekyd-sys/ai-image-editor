import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DashboardPage from '@/app/dashboard/page'

const mocks = vi.hoisted(() => ({ native: true, restore: vi.fn(), finish: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/CreditPopup', () => ({ default: () => null }))
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: () => 'Restore Apple purchase' }) }))
vi.mock('@/lib/native-app-cache', () => ({ readNativeJSONCache: () => null, writeNativeJSONCache: vi.fn() }))
vi.mock('@/lib/billing/use-apple-billing', () => ({ useAppleBillingProducts: () => ({ available: mocks.native, loading: false, error: null }) }))
vi.mock('@/lib/native-purchases', () => ({
  restoreNativeApplePurchases: mocks.restore,
  finishNativeAppleTransaction: mocks.finish,
  getNativeApplePurchaseErrorMessage: vi.fn(),
  isNativeApplePurchaseCancellation: vi.fn(),
  purchaseNativeAppleProduct: vi.fn(),
  purchaseNativeAppleSubscription: vi.fn(),
}))

const dashboard = {
  balance: 4000, lifetimePurchased: 4000, lifetimeUsed: 0,
  subscription: { provider: 'apple', planId: 'pro', status: 'active', billingInterval: 'month', currentPeriodEnd: null, cancelAtPeriodEnd: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.native = true
  mocks.restore.mockResolvedValue([{ transactionId: 'native-transaction', signedTransactionInfo: 'native-jws' }])
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/billing/apple/verify' ? { ok: true, credited: false, balance: 4000 } : dashboard,
  ), { status: 200 })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Dashboard Apple restore', () => {
  it('keeps restore available after a subscription becomes active and verifies the native receipt', async () => {
    render(<DashboardPage />)
    const restore = await screen.findByRole('button', { name: 'Restore Apple purchase' })
    expect(screen.getAllByText('pro Plan')).toHaveLength(2)
    fireEvent.click(restore)
    await waitFor(() => expect(mocks.finish).toHaveBeenCalledWith('native-transaction'))
    expect(fetch).toHaveBeenCalledWith('/api/billing/apple/verify', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ signedTransactionInfo: 'native-jws' }),
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore Apple purchase' })).toBeTruthy())
    expect(screen.getByText('4000')).toBeTruthy()
  })

  it('does not expose Apple restore in the web billing flow', async () => {
    mocks.native = false
    render(<DashboardPage />)
    await screen.findAllByText('pro Plan')
    expect(screen.queryByRole('button', { name: 'Restore Apple purchase' })).toBeNull()
  })
})
