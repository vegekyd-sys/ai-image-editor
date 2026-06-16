'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CREDIT_TIERS } from '@/lib/billing/tiers'
import CreditPopup from '@/components/CreditPopup'
import { getAttributionForRequest } from '@/lib/marketing/attribution'
import { trackCheckoutStart } from '@/lib/marketing/meta-pixel'

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

const PLANS = [
  { id: 'basic', name: 'Basic', monthlyPrice: 990, annualPrice: 9500, credits: 1200 },
  { id: 'pro', name: 'Pro', monthlyPrice: 1990, annualPrice: 19100, credits: 3000 },
  { id: 'business', name: 'Business', monthlyPrice: 4990, annualPrice: 47900, credits: 10000 },
] as const

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
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabType>(() => {
    const t = searchParams.get('tab')
    return VALID_TABS.includes(t as TabType) ? (t as TabType) : 'subscribe'
  })

  useEffect(() => {
    const t = searchParams.get('tab')
    if (VALID_TABS.includes(t as TabType)) setTab(t as TabType)
  }, [searchParams])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageLog[]>([])
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [checkingOut, setCheckingOut] = useState<string | null>(null)
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month')
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [managingSubscription, setManagingSubscription] = useState(false)
  const [billingActionError, setBillingActionError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async () => {
    const res = await fetch('/api/billing/dashboard')
    if (res.ok) {
      const data = await res.json()
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
    setLoading(true)
    fetchDashboard().finally(() => setLoading(false))
  }, [fetchDashboard])

  useEffect(() => {
    if (tab === 'invoices') fetchInvoices()
  }, [tab, fetchInvoices])

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

  const handleCheckout = async (tier: string) => {
    setCheckingOut(tier)
    try {
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
    } finally {
      setCheckingOut(null)
    }
  }

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId)
    try {
      const plan = PLANS.find(p => p.id === planId)
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
    } finally {
      setSubscribing(null)
    }
  }

  const handleManageSubscription = async () => {
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

  const sub = balance?.subscription

  if (loading) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center">
        <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-black text-white p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/projects" className="text-white/40 text-sm hover:text-white/60">&larr; Back to app</Link>
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1">
        {(['subscribe', 'topup', 'keys', 'usage', 'invoices'] as const).map(t => (
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
                        disabled={!!subscribing}
                        className="px-5 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
                      >
                        {subscribing === plan.id ? '...' : `$${(price / 100).toFixed(2)}${billingInterval === 'year' ? '/yr' : '/mo'}`}
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ══════ TOP UP TAB ══════ */}
      {tab === 'topup' && (
        <div className="grid gap-3">
          {CREDIT_TIERS.map(tier => (
            <div key={tier.id} className="bg-white/[0.03] rounded-xl p-5 border border-white/5 flex items-center justify-between">
              <div>
                <div className="font-medium">{tier.name}</div>
                <div className="text-white/40 text-sm mt-1">
                  {tier.credits.toLocaleString()} credits &middot; {tier.unitPrice}/credit
                </div>
              </div>
              <button
                onClick={() => handleCheckout(tier.id)}
                disabled={!!checkingOut}
                className="px-5 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
              >
                {checkingOut === tier.id ? '...' : `$${(tier.price / 100).toFixed(0)}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ══════ API KEYS TAB ══════ */}
      {tab === 'keys' && (
        <>
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
  )
}
