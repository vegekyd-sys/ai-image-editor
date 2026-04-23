'use client'

import { useState, useEffect, useCallback } from 'react'

interface InviteCode {
  id: string
  code: string
  max_uses: number
  used_count: number
  expires_at: string | null
  created_at: string
  users: string[]
}

interface WaitlistEntry {
  id: string
  email: string
  created_at: string
}

interface CreditPricing {
  tool_name: string
  supplier_cost: number
  credits: number
  is_free: boolean
  updated_at: string
}

interface TokenRateEntry {
  model_id: string
  display_name: string
  input_per_1m: number
  output_per_1m: number
  markup: number
  is_active: boolean
  updated_at: string
}

export default function AdminPage() {
  const [tab, setTab] = useState<'codes' | 'waitlist' | 'billing'>('codes')
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [pricing, setPricing] = useState<CreditPricing[]>([])
  const [editingPricing, setEditingPricing] = useState<Record<string, { credits?: string; supplier_cost?: string }>>({})
  const [tokenRates, setTokenRates] = useState<TokenRateEntry[]>([])
  const [editingRates, setEditingRates] = useState<Record<string, { input_per_1m?: string; output_per_1m?: string; markup?: string }>>({})
  const [newRate, setNewRate] = useState({ model_id: '', display_name: '', input_per_1m: '', output_per_1m: '', markup: '2.0' })
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [billingToggling, setBillingToggling] = useState(false)
  const [welcomeCredits, setWelcomeCredits] = useState(500)
  const [editingWelcome, setEditingWelcome] = useState(false)
  const [welcomeInput, setWelcomeInput] = useState('500')
  const [addCreditEmail, setAddCreditEmail] = useState('')
  const [addCreditAmount, setAddCreditAmount] = useState('100')
  const [addCreditResult, setAddCreditResult] = useState<string | null>(null)
  const [addingCredits, setAddingCredits] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Create code form
  const [newCode, setNewCode] = useState('')
  const [newMaxUses, setNewMaxUses] = useState('30')
  const [creating, setCreating] = useState(false)

  const fetchCodes = useCallback(async () => {
    const res = await fetch('/api/admin/invite-codes')
    if (res.status === 403) { setError('Not authorized'); return }
    const data = await res.json()
    if (Array.isArray(data)) setCodes(data)
  }, [])

  const fetchWaitlist = useCallback(async () => {
    const res = await fetch('/api/admin/waitlist')
    if (res.status === 403) { setError('Not authorized'); return }
    const data = await res.json()
    if (Array.isArray(data)) setWaitlist(data)
  }, [])

  const fetchPricing = useCallback(async () => {
    const res = await fetch('/api/admin/credit-pricing')
    if (res.status === 403) { setError('Not authorized'); return }
    const data = await res.json()
    if (Array.isArray(data)) setPricing(data)
  }, [])

  const fetchTokenRates = useCallback(async () => {
    const res = await fetch('/api/admin/token-rates')
    if (res.status === 403) return
    const data = await res.json()
    if (Array.isArray(data)) setTokenRates(data)
  }, [])

  const fetchBillingToggle = useCallback(async () => {
    const res = await fetch('/api/admin/billing-toggle')
    if (res.status === 403) return
    const data = await res.json()
    setBillingEnabled(data.enabled ?? false)
    setWelcomeCredits(data.welcomeCredits ?? 500)
    setWelcomeInput(String(data.welcomeCredits ?? 500))
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchCodes(), fetchWaitlist(), fetchPricing(), fetchTokenRates(), fetchBillingToggle()]).finally(() => setLoading(false))
  }, [fetchCodes, fetchWaitlist, fetchPricing, fetchTokenRates, fetchBillingToggle])

  const handleCreate = async () => {
    if (!newCode.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCode.trim(),
          max_uses: parseInt(newMaxUses) || 30,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setCodes(prev => [data, ...prev])
        setNewCode('')
        setNewMaxUses('30')
      } else {
        alert(data.error || 'Failed to create')
      }
    } finally {
      setCreating(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center text-red-400 text-lg">
        {error}
      </div>
    )
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
        <h1 className="text-2xl font-bold">Admin</h1>
        <a href="/projects" className="text-white/40 text-sm hover:text-white/60">← Back to app</a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1">
        <button
          onClick={() => setTab('codes')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'codes' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Invite Codes ({codes.length})
        </button>
        <button
          onClick={() => setTab('waitlist')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'waitlist' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Waitlist ({waitlist.length})
        </button>
        <button
          onClick={() => setTab('billing')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
            tab === 'billing' ? 'bg-fuchsia-600 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Billing ({pricing.length})
        </button>
      </div>

      {/* ══════ INVITE CODES TAB ══════ */}
      {tab === 'codes' && (
        <>
          {/* Create new code */}
          <div className="bg-white/5 rounded-xl p-4 mb-6 border border-white/10">
            <h3 className="text-sm font-medium text-white/60 mb-3">Create new invite code</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                className="flex-1 px-3 py-2 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none uppercase tracking-wider font-mono"
              />
              <input
                type="number"
                value={newMaxUses}
                onChange={(e) => setNewMaxUses(e.target.value)}
                placeholder="Max"
                className="w-20 px-3 py-2 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none text-center"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newCode.trim()}
                className="px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-medium hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {creating ? '...' : 'Create'}
              </button>
            </div>
          </div>

          {/* Codes list */}
          <div className="space-y-2">
            {codes.map((c) => (
              <div key={c.id} className="bg-white/[0.03] rounded-lg px-4 py-3 border border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm tracking-wider">{c.code}</span>
                    {c.expires_at && (
                      <span className="text-white/30 text-xs ml-2">
                        exp {new Date(c.expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm">
                      <span className={c.used_count >= c.max_uses ? 'text-red-400' : 'text-green-400'}>
                        {c.used_count}
                      </span>
                      <span className="text-white/30">/{c.max_uses}</span>
                    </div>
                    <span className="text-white/20 text-xs">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {c.users.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
                    {c.users.map((email) => (
                      <div key={email} className="text-white/40 text-xs pl-2">
                        {email}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {codes.length === 0 && (
              <p className="text-white/30 text-sm text-center py-8">No invite codes yet</p>
            )}
          </div>
        </>
      )}

      {/* ══════ WAITLIST TAB ══════ */}
      {tab === 'waitlist' && (
        <div className="space-y-2">
          {waitlist.map((w) => (
            <div key={w.id} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-4 py-3 border border-white/5">
              <span className="text-sm">{w.email}</span>
              <span className="text-white/20 text-xs">
                {new Date(w.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
          {waitlist.length === 0 && (
            <p className="text-white/30 text-sm text-center py-8">No waitlist entries yet</p>
          )}
        </div>
      )}

      {/* ══════ BILLING TAB ══════ */}
      {tab === 'billing' && (
        <>
          {/* Billing master switch */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Billing</div>
              <div className="text-xs text-white/40 mt-0.5">
                {billingEnabled ? 'Active — users are charged for AI usage' : 'Off — all AI usage is free'}
              </div>
            </div>
            <button
              onClick={async () => {
                setBillingToggling(true)
                const next = !billingEnabled
                await fetch('/api/admin/billing-toggle', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: next }),
                })
                setBillingEnabled(next)
                setBillingToggling(false)
              }}
              disabled={billingToggling}
              className={`relative w-12 h-6 rounded-full transition-all ${billingEnabled ? 'bg-fuchsia-600' : 'bg-white/20'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${billingEnabled ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Welcome credits config */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Welcome Credits</div>
              <div className="text-xs text-white/40 mt-0.5">Granted to new users on activation</div>
            </div>
            <div className="flex items-center gap-2">
              {editingWelcome ? (
                <>
                  <input
                    type="number"
                    value={welcomeInput}
                    onChange={(e) => setWelcomeInput(e.target.value)}
                    className="w-20 px-2 py-1 rounded bg-white/10 text-white text-sm text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      await fetch('/api/admin/billing-toggle', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ welcomeCredits: parseInt(welcomeInput) || 500 }),
                      })
                      setWelcomeCredits(parseInt(welcomeInput) || 500)
                      setEditingWelcome(false)
                    }}
                    className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs"
                  >Save</button>
                  <button onClick={() => { setEditingWelcome(false); setWelcomeInput(String(welcomeCredits)); }} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">✕</button>
                </>
              ) : (
                <>
                  <span className="text-fuchsia-400 font-medium text-sm">{welcomeCredits}</span>
                  <button onClick={() => setEditingWelcome(true)} className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5">Edit</button>
                </>
              )}
            </div>
          </div>

          {/* Add credits to user */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
            <div className="text-sm font-medium mb-3">Add Credits to User</div>
            <div className="flex gap-2">
              <input
                type="email"
                value={addCreditEmail}
                onChange={(e) => setAddCreditEmail(e.target.value)}
                placeholder="user@email.com"
                className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <input
                type="number"
                value={addCreditAmount}
                onChange={(e) => setAddCreditAmount(e.target.value)}
                className="w-20 px-2 py-1.5 rounded-lg bg-white/10 text-white text-xs text-right border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <button
                onClick={async () => {
                  if (!addCreditEmail || !addCreditAmount) return
                  setAddingCredits(true)
                  setAddCreditResult(null)
                  try {
                    const res = await fetch('/api/admin/add-credits', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: addCreditEmail, credits: parseInt(addCreditAmount) }),
                    })
                    const data = await res.json()
                    if (data.success) {
                      setAddCreditResult(`Added ${data.credits} → balance: ${data.newBalance}`)
                      setAddCreditEmail('')
                    } else {
                      setAddCreditResult(`Error: ${data.error}`)
                    }
                  } catch { setAddCreditResult('Failed') }
                  finally { setAddingCredits(false) }
                }}
                disabled={addingCredits || !addCreditEmail}
                className="px-4 py-1.5 rounded-lg bg-fuchsia-600 text-white text-xs font-medium hover:bg-fuchsia-500 disabled:opacity-40 transition-all"
              >
                {addingCredits ? '...' : 'Add'}
              </button>
            </div>
            {addCreditResult && (
              <div className={`text-xs mt-2 ${addCreditResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                {addCreditResult}
              </div>
            )}
          </div>

          <h3 className="text-sm font-medium text-white/60 mb-3">Per-action tools (fixed credits)</h3>
          <p className="text-xs text-white/30 mb-3">Video tools: credits = per second. Music/ComfyUI: per task. Token-based tools (Gemini, Claude) use Token Rates below.</p>

          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Tool</th>
                  <th className="text-right px-4 py-3 font-medium">Supplier $</th>
                  <th className="text-right px-4 py-3 font-medium">Credits</th>
                  <th className="text-center px-4 py-3 font-medium">Unit</th>
                  <th className="text-right px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((p) => {
                  const editing = editingPricing[p.tool_name]
                  const isVideo = p.tool_name.includes('video') && !p.tool_name.includes('status')
                  return (
                    <tr key={p.tool_name} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs">{p.tool_name}</td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.0001"
                            value={editing.supplier_cost ?? String(p.supplier_cost)}
                            onChange={(e) => setEditingPricing(prev => ({
                              ...prev,
                              [p.tool_name]: { ...prev[p.tool_name], supplier_cost: e.target.value }
                            }))}
                            className="w-24 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/60">${Number(p.supplier_cost).toFixed(4)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            value={editing.credits ?? String(p.credits)}
                            onChange={(e) => setEditingPricing(prev => ({
                              ...prev,
                              [p.tool_name]: { ...prev[p.tool_name], credits: e.target.value }
                            }))}
                            className="w-20 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className={p.is_free ? 'text-white/30' : 'text-fuchsia-400 font-medium'}>{p.credits}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs text-white/30">
                          {p.is_free ? 'free' : isVideo ? '/sec' : '/task'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={async () => {
                                await fetch('/api/admin/credit-pricing', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    tool_name: p.tool_name,
                                    ...(editing.supplier_cost !== undefined ? { supplier_cost: parseFloat(editing.supplier_cost) } : {}),
                                    ...(editing.credits !== undefined ? { credits: parseInt(editing.credits) } : {}),
                                  }),
                                })
                                setEditingPricing(prev => { const n = { ...prev }; delete n[p.tool_name]; return n })
                                fetchPricing()
                              }}
                              className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs hover:bg-fuchsia-500"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingPricing(prev => { const n = { ...prev }; delete n[p.tool_name]; return n })}
                              className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs hover:text-white/70"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingPricing(prev => ({ ...prev, [p.tool_name]: {} }))}
                            className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pricing.length === 0 && (
            <p className="text-white/30 text-sm text-center py-8">No pricing entries</p>
          )}

          {/* ── Token Rates ── */}
          <h3 className="text-sm font-medium text-white/60 mt-8 mb-3">Token Rates (per-token billing)</h3>

          {/* Add new rate */}
          <div className="bg-white/5 rounded-xl p-4 mb-4 border border-white/10">
            <div className="grid grid-cols-5 gap-2">
              <input
                type="text"
                value={newRate.model_id}
                onChange={(e) => setNewRate(prev => ({ ...prev, model_id: e.target.value }))}
                placeholder="model_id"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none font-mono"
              />
              <input
                type="text"
                value={newRate.display_name}
                onChange={(e) => setNewRate(prev => ({ ...prev, display_name: e.target.value }))}
                placeholder="Display Name"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none"
              />
              <input
                type="number"
                step="0.01"
                value={newRate.input_per_1m}
                onChange={(e) => setNewRate(prev => ({ ...prev, input_per_1m: e.target.value }))}
                placeholder="In $/1M"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none text-right"
              />
              <input
                type="number"
                step="0.01"
                value={newRate.output_per_1m}
                onChange={(e) => setNewRate(prev => ({ ...prev, output_per_1m: e.target.value }))}
                placeholder="Out $/1M"
                className="px-2 py-1.5 rounded bg-white/10 text-white text-xs placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none text-right"
              />
              <button
                onClick={async () => {
                  if (!newRate.model_id || !newRate.display_name) return
                  await fetch('/api/admin/token-rates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model_id: newRate.model_id,
                      display_name: newRate.display_name,
                      input_per_1m: parseFloat(newRate.input_per_1m) || 0,
                      output_per_1m: parseFloat(newRate.output_per_1m) || 0,
                      markup: parseFloat(newRate.markup) || 2.0,
                    }),
                  })
                  setNewRate({ model_id: '', display_name: '', input_per_1m: '', output_per_1m: '', markup: '2.0' })
                  fetchTokenRates()
                }}
                disabled={!newRate.model_id || !newRate.display_name}
                className="px-3 py-1.5 rounded bg-fuchsia-600 text-white text-xs font-medium hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>

          <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/50 text-xs">
                  <th className="text-left px-4 py-3 font-medium">Model</th>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-right px-4 py-3 font-medium">In $/1M</th>
                  <th className="text-right px-4 py-3 font-medium">Out $/1M</th>
                  <th className="text-right px-4 py-3 font-medium">Markup</th>
                  <th className="text-right px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {tokenRates.map((r) => {
                  const editing = editingRates[r.model_id]
                  return (
                    <tr key={r.model_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate" title={r.model_id}>
                        {r.model_id}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/60">{r.display_name}</td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editing.input_per_1m ?? String(r.input_per_1m)}
                            onChange={(e) => setEditingRates(prev => ({
                              ...prev,
                              [r.model_id]: { ...prev[r.model_id], input_per_1m: e.target.value }
                            }))}
                            className="w-20 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/60">${Number(r.input_per_1m).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editing.output_per_1m ?? String(r.output_per_1m)}
                            onChange={(e) => setEditingRates(prev => ({
                              ...prev,
                              [r.model_id]: { ...prev[r.model_id], output_per_1m: e.target.value }
                            }))}
                            className="w-20 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-fuchsia-400 font-medium">${Number(r.output_per_1m).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <input
                            type="number"
                            step="0.1"
                            value={editing.markup ?? String(r.markup)}
                            onChange={(e) => setEditingRates(prev => ({
                              ...prev,
                              [r.model_id]: { ...prev[r.model_id], markup: e.target.value }
                            }))}
                            className="w-16 px-2 py-1 rounded bg-white/10 text-white text-xs text-right border border-white/20 focus:border-fuchsia-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/40">{Number(r.markup).toFixed(1)}x</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={async () => {
                                await fetch('/api/admin/token-rates', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    model_id: r.model_id,
                                    ...(editing.input_per_1m !== undefined ? { input_per_1m: parseFloat(editing.input_per_1m) } : {}),
                                    ...(editing.output_per_1m !== undefined ? { output_per_1m: parseFloat(editing.output_per_1m) } : {}),
                                    ...(editing.markup !== undefined ? { markup: parseFloat(editing.markup) } : {}),
                                  }),
                                })
                                setEditingRates(prev => { const n = { ...prev }; delete n[r.model_id]; return n })
                                fetchTokenRates()
                              }}
                              className="px-2 py-1 rounded bg-fuchsia-600 text-white text-xs hover:bg-fuchsia-500"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingRates(prev => { const n = { ...prev }; delete n[r.model_id]; return n })}
                              className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs hover:text-white/70"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingRates(prev => ({ ...prev, [r.model_id]: {} }))}
                            className="px-2 py-1 rounded text-white/30 text-xs hover:text-white/60 hover:bg-white/5"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {tokenRates.length === 0 && (
            <p className="text-white/30 text-sm text-center py-4">No token rates configured</p>
          )}
        </>
      )}
    </div>
  )
}
