'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CREDIT_TIERS } from '@/lib/billing/tiers'
import CreditPopup from '@/components/CreditPopup'
import { readNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache'
import { navigateBackInIOSApp } from '@/lib/native-navigation'
import { getAttributionForRequest } from '@/lib/marketing/attribution'
import { trackCheckoutStart } from '@/lib/marketing/meta-pixel'
import { useAppleBillingProducts } from '@/lib/billing/use-apple-billing'
import {
  finishNativeAppleTransaction,
  getNativeApplePurchaseErrorMessage,
  isNativeApplePurchaseCancellation,
  purchaseNativeAppleProduct,
  purchaseNativeAppleSubscription,
  restoreNativeApplePurchases,
} from '@/lib/native-purchases'

interface ApiKey {
  id: string
  key_prefix: string
  name: string
  is_active: boolean
  created_at: string
  last_used_at: string | null
}

interface UsageLog {
  tool_name: string
  model_used: string | null
  credits_charged: number
  input_tokens: number | null
  output_tokens: number | null
  source: string | null
  duration_ms: number | null
  created_at: string
}

interface SubscriptionInfo {
  provider?: 'stripe' | 'apple'
  planId: string
  status: string
  billingInterval: 'month' | 'year'
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

interface InvoiceRecord {
  id: string
  number: string | null
  type: 'subscription' | 'topup' | 'invoice'
  status: string | null
  currency: string
  amountPaid: number
  amountDue: number
  credits: number | null
  created: number
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}

interface Balance {
  balance: number
  lifetimePurchased: number
  lifetimeUsed: number
  subscription: SubscriptionInfo | null
}

interface DashboardPayload extends Balance {
  keys?: ApiKey[]
  usage?: UsageLog[]
}

const PLANS = [
  { id: 'basic', name: 'Basic', monthlyPrice: 990, annualPrice: 9500, credits: 1200 },
  { id: 'pro', name: 'Pro', monthlyPrice: 1990, annualPrice: 19100, credits: 3000 },
  { id: 'business', name: 'Business', monthlyPrice: 4990, annualPrice: 47900, credits: 10000 },
] as const

const AGENT_SETUP_COMMAND = 'npx makaron-cli setup'

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatInvoiceType(type: InvoiceRecord['type']) {
  if (type === 'subscription') return 'Subscription'
  if (type === 'topup') return 'Top Up'
  return 'Invoice'
}

export default function DashboardPage() {
  return <Suspense><DashboardInner /></Suspense>
}

type TabType = 'subscribe' | 'topup' | 'keys' | 'usage' | 'invoices'
const VALID_TABS: TabType[] = ['subscribe', 'topup', 'keys', 'usage', 'invoices']

function DashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [cachedDashboard] = useState<DashboardPayload | null>(() => readNativeJSONCache<DashboardPayload>('/api/billing/dashboard'))
  const [tab, setTab] = useState<TabType>(() => {
    const t = searchParams.get('tab')
    return VALID_TABS.includes(t as TabType) ? (t as TabType) : 'subscribe'
  })

  useEffect(() => {
    const t = searchParams.get('tab')
    if (VALID_TABS.includes(t as TabType)) setTab(t as TabType)
  }, [searchParams])
  const [balance, setBalance] = useState<Balance | null>(() => cachedDashboard)
  const [keys, setKeys] = useState<ApiKey[]>(() => cachedDashboard?.keys || [])
  const [usage, setUsage] = useState<UsageLog[]>(() => cachedDashboard?.usage || [])
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [loading, setLoading] = useState(() => !cachedDashboard)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [checkingOut, setCheckingOut] = useState<string | null>(null)
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month')
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [managingSubscription, setManagingSubscription] = useState(false)
  const [billingActionError, setBillingActionError] = useState<string | null>(null)
  const [setupCopied, setSetupCopied] = useState(false)
  const appleBilling = useAppleBillingProducts({ enabled: true })
  const appleBillingAvailable = appleBilling.available

  const fetchDashboard = useCallback(async () => {
    const res = await fetch('/api/billing/dashboard')
    if (res.ok) {
      const data = await res.json() as DashboardPayload
      writeNativeJSONCache('/api/billing/dashboard', data)
      setBalance(data)
      setKeys(data.keys || [])
      setUsage(data.usage || [])
    }
  }, [])

  const fetchInvoices = useCallback(async () => {
    setInvoicesLoading(true)
    try {
      const res = await fetch('/api/billing/invoices')
      if (res.ok) {
        const data = await res.json()
        setInvoices(data.invoices || [])
      }
    } finally {
      setInvoicesLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!cachedDashboard) setLoading(true)
    fetchDashboard().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchDashboard, cachedDashboard])

  useEffect(() => {
    if (tab === 'invoices') fetchInvoices()
  }, [tab, fetchInvoices])

  useEffect(() => {
    if (!setupCopied) return
    const timeout = window.setTimeout(() => setSetupCopied(false), 1400)
    return () => window.clearTimeout(timeout)
  }, [setupCopied])

  const handleCreateKey = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/billing/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName || 'Default' }),
      })
      const data = await res.json()
      if (data.key) {
        setCreatedKey(data.key)
        setNewKeyName('')
        fetchDashboard()
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteKey = async (id: string) => {
    await fetch('/api/billing/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchDashboard()
  }

  const handleCopySetup = async () => {
    setSetupCopied(true)
    try {
      await navigator.clipboard?.writeText(AGENT_SETUP_COMMAND)
    } catch (error) {
      console.warn('[dashboard] setup command copy failed:', error)
    }
  }

  const finishAppleTransaction = async (transactionId: string) => {
    try {
      await finishNativeAppleTransaction(transactionId)
    } catch (error) {
      console.warn('[dashboard/apple] could not finish native transaction:', error)
    }
  }

  const handleCheckout = async (tier: string) => {
    setCheckingOut(tier)
    setBillingActionError(null)
    try {
      if (appleBillingAvailable) {
        const appleProduct = appleBilling.findTopup(tier)
        if (!appleProduct) throw new Error('Apple top-up product is not configured.')
        if (!appleBilling.nativeProductFor(appleProduct)) throw new Error('Apple top-up product is still loading.')
        const metaEventId = trackCheckoutStart('topup', {
          content_name: tier,
          content_id: appleProduct.productId,
          value: appleProduct.price / 100,
          currency: 'USD',
        })
        const transaction = await purchaseNativeAppleProduct(appleProduct.productId, appleBilling.appAccountToken)
        const res = await fetch('/api/billing/apple/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransactionInfo: transaction.signedTransactionInfo,
            metaEventId,
            attribution: getAttributionForRequest(),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Apple top-up verification failed.')
        await finishAppleTransaction(transaction.transactionId)
        writeNativeJSONCache('/api/billing/dashboard', { ...(balance ?? {}), ...data })
        await fetchDashboard()
        return
      }

      const tierConfig = CREDIT_TIERS.find(t => t.id === tier)
      const metaEventId = trackCheckoutStart('topup', {
        content_name: tier,
        value: tierConfig ? tierConfig.price / 100 : undefined,
        currency: 'USD',
      })
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, returnPath: '/dashboard', metaEventId, attribution: getAttributionForRequest() }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (error) {
      if (!isNativeApplePurchaseCancellation(error)) {
        console.error('[dashboard] top-up failed:', error)
      }
      setBillingActionError(getNativeApplePurchaseErrorMessage(error, 'Unable to start top-up.'))
    } finally {
      setCheckingOut(null)
    }
  }

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId)
    setBillingActionError(null)
    try {
      const plan = PLANS.find(p => p.id === planId)
      if (appleBillingAvailable) {
        const appleProduct = appleBilling.findSubscription(planId, billingInterval)
        if (!appleProduct) throw new Error('Apple subscription product is not configured.')
        if (!appleBilling.nativeProductFor(appleProduct)) throw new Error('Apple subscription product is still loading.')
        const metaEventId = trackCheckoutStart('subscription', {
          content_name: planId,
          content_id: appleProduct.productId,
          billing_interval: billingInterval,
          value: appleProduct.price / 100,
          currency: 'USD',
        })
        const transaction = await purchaseNativeAppleSubscription(appleProduct.productId, appleBilling.appAccountToken)
        const res = await fetch('/api/billing/apple/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransactionInfo: transaction.signedTransactionInfo,
            metaEventId,
            attribution: getAttributionForRequest(),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Apple purchase verification failed.')
        await finishAppleTransaction(transaction.transactionId)
        await fetchDashboard()
        return
      }

      const metaEventId = trackCheckoutStart('subscription', {
        content_name: planId,
        value: plan ? (billingInterval === 'month' ? plan.monthlyPrice : plan.annualPrice) / 100 : undefined,
        currency: 'USD',
      })
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, interval: billingInterval, returnPath: '/dashboard', metaEventId, attribution: getAttributionForRequest() }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (error) {
      if (!isNativeApplePurchaseCancellation(error)) {
        console.error('[dashboard] subscribe failed:', error)
      }
      setBillingActionError(getNativeApplePurchaseErrorMessage(error, 'Unable to start subscription.'))
    } finally {
      setSubscribing(null)
    }
  }

  const handleManageSubscription = async () => {
    if (appleBillingAvailable || sub?.provider === 'apple') {
      window.location.href = 'https://apps.apple.com/account/subscriptions'
      return
    }
    setManagingSubscription(true)
    setBillingActionError(null)
    try {
      const res = await fetch('/api/billing/manage', { method: 'POST' })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      if (data.url) window.location.href = data.url
      else setBillingActionError(data.error || 'Unable to open billing portal.')
    } catch (error) {
      console.error('[dashboard] billing portal failed:', error)
      setBillingActionError('Unable to open billing portal.')
    } finally {
      setManagingSubscription(false)
    }
  }

  const handleBackToApp = () => {
    if (navigateBackInIOSApp('/projects')) return
    router.push('/projects')
  }

  const sub = balance?.subscription
  const visibleTabs: TabType[] = ['subscribe', 'topup', 'keys', 'usage', 'invoices']

  if (loading) {
    return (
      <div className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black text-white p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <button
              type="button"
              onClick={handleBackToApp}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/60"
            >
              <span className="text-lg leading-none">‹</span>
              <span>Back</span>
            </button>
            <div className="h-5 w-16 rounded-md bg-white/5" />
          </div>
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.16em] text-white/25 mb-3">Loading</div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
          </div>
          <div className="space-y-4">
            <div className="h-28 rounded-2xl border border-white/8 bg-white/[0.04]" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-24 rounded-xl border border-white/8 bg-white/[0.035]" />
              <div className="h-24 rounded-xl border border-white/8 bg-white/[0.035]" />
            </div>
            <div className="h-40 rounded-2xl border border-white/8 bg-white/[0.025]" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black text-white p-6">
      <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button onClick={handleBackToApp} className="text-white/40 text-sm hover:text-white/60">
          &larr; Back to app
        </button>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-br from-fuchsia-900/30 to-purple-900/20 rounded-2xl p-6 mb-6 border border-fuchsia-500/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white/50 text-sm mb-1">Credit Balance</div>
            <div className="text-4xl font-bold text-fuchsia-400">{balance?.balance ?? 0}</div>
          </div>
          {sub && sub.status !== 'canceled' && (
            <div className="text-right">
              <div className="text-xs text-fuchsia-400 font-medium uppercase tracking-wider">{sub.planId} Plan</div>
              <div className="text-white/30 text-xs mt-1">
                {sub.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} {sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : ''}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-6 mt-3 text-xs text-white/40">
          <span>Purchased: {balance?.lifetimePurchased ?? 0}</span>
          <span>Used: {balance?.lifetimeUsed ?? 0}</span>
        </div>
      </div>

      {appleBillingAvailable && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-sm font-semibold text-white/75">Apple In-App Purchase</div>
          <div className={`mt-1 text-xs ${appleBilling.error ? 'text-red-400/75' : 'text-white/40'}`}>
            {appleBilling.error || (appleBilling.loading ? 'Loading Apple prices...' : 'Plan changes and top-ups are billed through Apple on iOS.')}
          </div>
        </div>
      )}

      {billingActionError && (
        <div className="mb-6 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {billingActionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1">
        {visibleTabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
              tab === t ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t === 'subscribe' ? 'Plan' : t === 'topup' ? 'Top Up' : t === 'keys' ? 'API Keys' : t === 'usage' ? 'Usage' : 'Invoices'}
          </button>
        ))}
      </div>

      {/* ══════ SUBSCRIBE TAB ══════ */}
      {tab === 'subscribe' && (
        <>
          {/* Current subscription */}
          {sub && sub.status !== 'canceled' ? (
            <div className="bg-white/[0.03] rounded-xl p-5 border border-fuchsia-500/20 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium capitalize">{sub.planId} Plan</div>
                  <div className="text-white/40 text-sm mt-1">
                    {sub.billingInterval === 'year' ? 'Annual' : 'Monthly'} billing
                    {sub.cancelAtPeriodEnd && <span className="text-amber-400 ml-2">Canceling at period end</span>}
                  </div>
                  <div className="text-white/30 text-xs mt-1">
                    Next billing: {sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'}
                  </div>
                </div>
                <button
                  onClick={handleManageSubscription}
                  disabled={managingSubscription}
                  className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 disabled:opacity-40 transition-all"
                >
                  {managingSubscription ? '...' : 'Manage'}
                </button>
              </div>
              {billingActionError && (
                <div className="text-red-400/70 text-xs mt-3">{billingActionError}</div>
              )}
            </div>
          ) : (
            <>
              {/* Billing interval toggle */}
              <div className="flex items-center justify-center gap-3 mb-5">
                <span className={`text-sm ${billingInterval === 'month' ? 'text-white' : 'text-white/40'}`}>Monthly</span>
                <button
                  onClick={() => setBillingInterval(v => v === 'month' ? 'year' : 'month')}
                  className={`relative w-12 h-6 rounded-full transition-all ${billingInterval === 'year' ? 'bg-fuchsia-600' : 'bg-white/20'}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${billingInterval === 'year' ? 'left-6' : 'left-0.5'}`} />
                </button>
                <span className={`text-sm ${billingInterval === 'year' ? 'text-white' : 'text-white/40'}`}>
                  Annual <span className="text-green-400 text-xs font-medium ml-1">Save 20%</span>
                </span>
              </div>

              {/* Plan cards */}
              <div className="grid gap-3">
                {PLANS.map(plan => {
                  const price = billingInterval === 'month' ? plan.monthlyPrice : plan.annualPrice
                  const perMonth = billingInterval === 'year' ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice
                  const appleProduct = appleBilling.findSubscription(plan.id, billingInterval)
                  const nativeProduct = appleBilling.nativeProductFor(appleProduct)
                  const displayPrice = nativeProduct?.displayPrice
                  const appleReady = !appleBillingAvailable || !!nativeProduct
                  const disabled = !!subscribing || (appleBillingAvailable && (appleBilling.loading || !!appleBilling.error || !appleReady))
                  const buttonLabel = subscribing === plan.id
                    ? '...'
                    : appleBillingAvailable
                      ? appleBilling.loading
                        ? 'Loading...'
                        : appleReady
                          ? displayPrice || 'Unavailable'
                          : 'Unavailable'
                      : `$${(price / 100).toFixed(2)}${billingInterval === 'year' ? '/yr' : '/mo'}`
                  return (
                    <div key={plan.id} className="bg-white/[0.03] rounded-xl p-5 border border-white/5 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-white/40 text-sm mt-1">
                          {plan.credits.toLocaleString()} credits/month
                        </div>
                        {billingInterval === 'year' && (
                          <div className="text-green-400/60 text-xs mt-0.5">
                            ${(perMonth / 100).toFixed(2)}/mo billed annually
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={disabled}
                        className="px-5 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
                      >
                        {buttonLabel}
                      </button>
                    </div>
                  )
                })}
              </div>
              {appleBillingAvailable && (
                <button
                  onClick={async () => {
                    setSubscribing('restore')
                    setBillingActionError(null)
                    try {
                      const transactions = await restoreNativeApplePurchases()
                      const transaction = transactions[0]
                      if (!transaction) throw new Error('No active Apple subscription was found.')
                      const res = await fetch('/api/billing/apple/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ signedTransactionInfo: transaction.signedTransactionInfo }),
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error || 'Could not restore Apple subscription.')
                      await finishAppleTransaction(transaction.transactionId)
                      await fetchDashboard()
                    } catch (error) {
                      setBillingActionError(error instanceof Error ? error.message : 'Could not restore Apple subscription.')
                    } finally {
                      setSubscribing(null)
                    }
                  }}
                  disabled={!!subscribing}
                  className="mt-4 w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/60 disabled:opacity-40"
                >
                  {subscribing === 'restore' ? '...' : 'Restore Apple Purchase'}
                </button>
              )}
            </>
          )}
        </>
      )}

      {/* ══════ TOP UP TAB ══════ */}
      {tab === 'topup' && (
        <div className="grid gap-3">
          {CREDIT_TIERS.map(tier => {
            const appleProduct = appleBilling.findTopup(tier.id)
            const nativeProduct = appleBilling.nativeProductFor(appleProduct)
            const displayPrice = nativeProduct?.displayPrice
            const appleReady = !appleBillingAvailable || !!nativeProduct
            const disabled = !!checkingOut || (appleBillingAvailable && (appleBilling.loading || !!appleBilling.error || !appleReady))
            const buttonLabel = checkingOut === tier.id
              ? '...'
              : appleBillingAvailable
                ? appleBilling.loading
                  ? 'Loading...'
                  : appleReady
                    ? displayPrice || 'Unavailable'
                    : 'Unavailable'
                : `$${(tier.price / 100).toFixed(0)}`
            return (
              <div key={tier.id} className="bg-white/[0.03] rounded-xl p-5 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="font-medium">{tier.name}</div>
                  <div className="text-white/40 text-sm mt-1">
                    {tier.credits.toLocaleString()} credits &middot; {tier.unitPrice}/credit
                  </div>
                </div>
                <button
                  onClick={() => handleCheckout(tier.id)}
                  disabled={disabled}
                  className="px-5 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
                >
                  {buttonLabel}
                </button>
              </div>
            )
          })}
          {appleBillingAvailable && (
            <p className="text-white/30 text-xs">Top-ups are billed through Apple.</p>
          )}
        </div>
      )}

      {/* ══════ API KEYS TAB ══════ */}
      {tab === 'keys' && (
        <>
          <div className="mb-4 rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.12),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300/80">Agent API</div>
              <div className="mt-1 text-base font-medium text-white">Set up Makaron for your coding agent</div>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-white/45">
                Run this setup command first, then generate or reuse an API key below.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-fuchsia-300/18 bg-black/45 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.20)]">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-2 py-1 font-mono text-sm text-white/78">
                {AGENT_SETUP_COMMAND}
              </code>
              <button
                type="button"
                onClick={handleCopySetup}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  setupCopied
                    ? 'border-emerald-300/25 bg-emerald-400/12 text-emerald-200'
                    : 'border-white/10 bg-white/[0.08] text-white/65 hover:border-white/20 hover:bg-white/[0.13] hover:text-white'
                }`}
              >
                {setupCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="mt-3 text-xs text-white/32">
              Need full CLI docs?{' '}
              <a href="/agent" className="text-white/45 underline decoration-white/15 underline-offset-4 transition-colors hover:text-white/70">
                View /agent
              </a>
            </div>
          </div>

          {createdKey && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4 mb-4">
              <div className="text-green-400 text-sm font-medium mb-2">API Key Created &mdash; copy it now, it won&apos;t be shown again!</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-black/50 rounded-lg px-3 py-2 font-mono text-green-300 break-all select-all">
                  {createdKey}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(createdKey); setCreatedKey(null) }}
                  className="px-3 py-2 rounded-lg bg-green-600 text-white text-xs hover:bg-green-500 shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (optional)"
                className="flex-1 px-3 py-2 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <button
                onClick={handleCreateKey}
                disabled={creating}
                className="px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
              >
                {creating ? '...' : 'Generate Key'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {keys.filter(k => k.is_active).map(k => (
              <div key={k.id} className="bg-white/[0.03] rounded-lg px-4 py-3 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-white/70">{k.key_prefix}&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</code>
                    <span className="text-white/30 text-xs">{k.name}</span>
                  </div>
                  <div className="text-white/20 text-xs mt-1">
                    Created {new Date(k.created_at).toLocaleDateString()}
                    {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteKey(k.id)}
                  className="text-red-400/50 text-xs hover:text-red-400 transition-all"
                >
                  Revoke
                </button>
              </div>
            ))}
            {keys.filter(k => k.is_active).length === 0 && (
              <p className="text-white/30 text-sm text-center py-8">No API keys yet. Generate one above.</p>
            )}
          </div>
        </>
      )}

      {/* ══════ USAGE TAB ══════ */}
      {tab === 'usage' && (
        <>
          {usage.length > 0 ? (
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/50 text-xs">
                    <th className="text-left px-4 py-3 font-medium">Tool</th>
                    <th className="text-right px-4 py-3 font-medium">Credits</th>
                    <th className="text-right px-4 py-3 font-medium">Tokens</th>
                    <th className="text-right px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs">{u.tool_name}</div>
                        {u.model_used && <div className="text-white/30 text-xs mt-0.5">{u.model_used}</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-fuchsia-400 font-medium">{u.credits_charged}</td>
                      <td className="px-4 py-3 text-right text-white/40 text-xs">
                        {u.input_tokens != null ? `${u.input_tokens}/${u.output_tokens ?? 0}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-white/30 text-xs">
                        {new Date(u.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-white/30 text-sm text-center py-12">No usage yet.</p>
          )}
        </>
      )}

      {/* ══════ INVOICES TAB ══════ */}
      {tab === 'invoices' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-medium">Billing History</div>
              <div className="text-white/35 text-sm mt-1">Paid invoices and receipts from Stripe.</div>
            </div>
            <button
              onClick={handleManageSubscription}
              disabled={managingSubscription}
              className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 disabled:opacity-40 transition-all"
            >
              {managingSubscription ? '...' : 'Billing Portal'}
            </button>
          </div>
          {billingActionError && (
            <div className="text-red-400/70 text-xs mb-4">{billingActionError}</div>
          )}

          {invoicesLoading ? (
            <div className="flex justify-center py-12">
              <svg className="animate-spin h-5 w-5 text-fuchsia-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : invoices.length > 0 ? (
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-white/50 text-xs">
                    <th className="text-left px-4 py-3 font-medium">Invoice</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-right px-4 py-3 font-medium">Amount</th>
                    <th className="text-right px-4 py-3 font-medium">Date</th>
                    <th className="text-right px-4 py-3 font-medium">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(invoice => {
                    const amount = invoice.amountPaid || invoice.amountDue
                    return (
                      <tr key={invoice.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{invoice.number || invoice.id}</div>
                          <div className="text-white/30 text-xs mt-0.5 capitalize">
                            {invoice.status || 'unknown'}{invoice.credits != null ? ` · ${invoice.credits.toLocaleString()} credits` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-white/60">{formatInvoiceType(invoice.type)}</td>
                        <td className="px-4 py-3 text-right text-fuchsia-400 font-medium">
                          {formatMoney(amount, invoice.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-white/30 text-xs">
                          {new Date(invoice.created * 1000).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {invoice.hostedInvoiceUrl && (
                              <a
                                href={invoice.hostedInvoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs hover:bg-white/15 hover:text-white transition-all"
                              >
                                View
                              </a>
                            )}
                            {invoice.invoicePdf && (
                              <a
                                href={invoice.invoicePdf}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 rounded bg-fuchsia-600/80 text-white text-xs hover:bg-fuchsia-500 transition-all"
                              >
                                PDF
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white/[0.03] rounded-xl border border-white/10 p-8 text-center">
              <p className="text-white/35 text-sm">No invoices yet.</p>
              <p className="text-white/20 text-xs mt-2">Your paid subscription and top-up invoices will appear here.</p>
            </div>
          )}
        </>
      )}

      <CreditPopup
        open={false}
        onClose={() => {}}
        balance={balance?.balance ?? 0}
        subscription={balance?.subscription ?? null}
        autoDetectPayment
        onBalanceUpdate={() => fetchDashboard()}
      />
      </div>
    </div>
  )
}
