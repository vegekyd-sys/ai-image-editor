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
  id: string
  tool_name: string
  model_used: string | null
  credits_charged: number
  duration_ms: number | null
  created_at: string
}

interface Balance {
  balance: number
  lifetimePurchased: number
  lifetimeUsed: number
}

export default function DashboardPage() {
  const [tab, setTab] = useState<'overview' | 'keys' | 'usage'>('overview')
  const [balance, setBalance] = useState<Balance | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsageLog[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [checkingOut, setCheckingOut] = useState<string | null>(null)

  const fetchBalance = useCallback(async () => {
    const res = await fetch('/api/billing/credits')
    if (res.ok) setBalance(await res.json())
  }, [])

  const fetchKeys = useCallback(async () => {
    const res = await fetch('/api/billing/keys')
    if (res.ok) {
      const data = await res.json()
      setKeys(data.keys || [])
    }
  }, [])

  const fetchUsage = useCallback(async () => {
    // Usage logs via admin — for now use credits endpoint
    // TODO: add /api/billing/usage endpoint
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchBalance(), fetchKeys(), fetchUsage()]).finally(() => setLoading(false))
  }, [fetchBalance, fetchKeys, fetchUsage])

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
        fetchKeys()
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
    fetchKeys()
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
        <a href="/projects" className="text-white/40 text-sm hover:text-white/60">← Back to app</a>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-br from-fuchsia-900/30 to-purple-900/20 rounded-2xl p-6 mb-6 border border-fuchsia-500/20">
        <div className="text-white/50 text-sm mb-1">Credit Balance</div>
        <div className="text-4xl font-bold text-fuchsia-400">{balance?.balance ?? 0}</div>
        <div className="flex gap-6 mt-3 text-xs text-white/40">
          <span>Purchased: {balance?.lifetimePurchased ?? 0}</span>
          <span>Used: {balance?.lifetimeUsed ?? 0}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1">
        {(['overview', 'keys', 'usage'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all capitalize ${
              tab === t ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t === 'overview' ? 'Top Up' : t === 'keys' ? 'API Keys' : 'Usage'}
          </button>
        ))}
      </div>

      {/* ══════ TOP UP TAB ══════ */}
      {tab === 'overview' && (
        <div className="grid gap-3">
          {CREDIT_TIERS.map(tier => (
            <div key={tier.id} className="bg-white/[0.03] rounded-xl p-5 border border-white/5 flex items-center justify-between">
              <div>
                <div className="font-medium">{tier.name}</div>
                <div className="text-white/40 text-sm mt-1">
                  {tier.credits.toLocaleString()} credits · {tier.unitPrice}/credit
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
          {/* New key created — show once */}
          {createdKey && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4 mb-4">
              <div className="text-green-400 text-sm font-medium mb-2">API Key Created — copy it now, it won&apos;t be shown again!</div>
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

          {/* Create new key */}
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

          {/* Keys list */}
          <div className="space-y-2">
            {keys.filter(k => k.is_active).map(k => (
              <div key={k.id} className="bg-white/[0.03] rounded-lg px-4 py-3 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-white/70">{k.key_prefix}••••••••</code>
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
        <div className="text-white/30 text-sm text-center py-12">
          Usage history coming soon.
        </div>
      )}
    </div>
  )
}
