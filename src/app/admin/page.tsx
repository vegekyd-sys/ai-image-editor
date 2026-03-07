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

export default function AdminPage() {
  const [tab, setTab] = useState<'codes' | 'waitlist'>('codes')
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
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

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchCodes(), fetchWaitlist()]).finally(() => setLoading(false))
  }, [fetchCodes, fetchWaitlist])

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
    </div>
  )
}
