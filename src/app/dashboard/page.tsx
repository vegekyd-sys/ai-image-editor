'use client'

import { useState, useEffect, useCallback } from 'react'
import { CREDIT_TIERS } from '@/lib/billing/tiers'

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

export default function DashboardPage() {
  const [tab, setTab] = useState<'subscribe' | 'topup' | 'keys' | 'usage' | 'settings'>('subscribe')
  const [autoTips, setAutoTips] = useState<'auto' | 'off'>('auto')
  const [balance, setBalance] = useState<Balance | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageLog[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [checkingOut, setCheckingOut] = useState<string | null>(null)
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month')
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [managingSubscription, setManagingSubscription] = useState(false)

  const fetchDashboard = useCallback(async () => {
    const res = await fetch('/api/billing/dashboard')
    if (res.ok) {
      const data = await res.json()
      setBalance(data)
      setKeys(data.keys || [])
      setUsage(data.usage || [])
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchDashboard().finally(() => setLoading(false))
    const stored = localStorage.getItem('mkr_auto_tips')
    if (stored === 'auto' || stored === 'off') setAutoTips(stored)
  }, [fetchDashboard])

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
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
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
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, interval: billingInterval }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setSubscribing(null)
    }
  }

  const handleManageSubscription = async () => {
    setManagingSubscription(true)
    try {
      const res = await fetch('/api/billing/manage', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
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
        <a href="/projects" className="text-white/40 text-sm hover:text-white/60">&larr; Back to app</a>
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
        {(['subscribe', 'topup', 'keys', 'usage', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
              tab === t ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t === 'subscribe' ? 'Plan' : t === 'topup' ? 'Top Up' : t === 'keys' ? 'API Keys' : t === 'usage' ? 'Usage' : 'Settings'}
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

      {/* ══════ SETTINGS TAB ══════ */}
      {tab === 'settings' && (
        <div className="space-y-3">
          <div className="bg-white/[0.03] rounded-xl p-5 border border-white/5 flex items-center justify-between">
            <div>
              <div className="font-medium">Auto Tips</div>
              <div className="text-white/40 text-sm mt-1">
                Auto-generate edit suggestions when uploading a photo
              </div>
            </div>
            <button
              onClick={() => {
                const next = autoTips === 'auto' ? 'off' : 'auto'
                setAutoTips(next)
                localStorage.setItem('mkr_auto_tips', next)
              }}
              className={`relative w-12 h-6 rounded-full transition-all ${autoTips === 'auto' ? 'bg-fuchsia-600' : 'bg-white/20'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${autoTips === 'auto' ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
