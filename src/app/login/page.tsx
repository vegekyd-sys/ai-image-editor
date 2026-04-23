'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useLocale, LocaleToggle } from '@/lib/i18n'
import RollingTagline from '@/components/RollingTagline'

const ERROR_KEY_MAP: Record<string, string> = {
  'Invalid login credentials': 'auth.err.invalidCredentials',
  'Email not confirmed': 'auth.err.emailNotConfirmed',
  'User already registered': 'auth.err.alreadyRegistered',
  'Password should be at least 6 characters': 'auth.err.passwordTooShort',
  'Unable to validate email address: invalid format': 'auth.err.invalidEmail',
  'Email rate limit exceeded': 'auth.err.rateLimited',
  'For security purposes, you can only request this after 60 seconds.': 'auth.err.wait60s',
}

type View = 'landing' | 'register' | 'login'

export default function LoginPage() {
  const { t } = useLocale()
  const [view, setView] = useState<View>('landing')

  // Landing state
  const [inviteCode, setInviteCode] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteShake, setInviteShake] = useState(false)

  // Waitlist state
  const [waitlistEmail, setWaitlistEmail] = useState('')
  const [waitlistLoading, setWaitlistLoading] = useState(false)
  const [waitlistDone, setWaitlistDone] = useState(false)
  const [waitlistError, setWaitlistError] = useState('')

  // Register / Login state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string>('')
  const [errorRaw, setErrorRaw] = useState<string>('')

  // Validated invite code (passed from landing to register)
  const [validatedCode, setValidatedCode] = useState('')

  const supabaseRef = useRef<SupabaseClient | null>(null)
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  // ── Landing: validate invite code ──
  const handleInviteSubmit = async () => {
    const code = inviteCode.trim()
    if (!code) return
    setInviteError('')
    setInviteLoading(true)

    try {
      const res = await fetch('/api/auth/check-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (data.valid) {
        setValidatedCode(code.toUpperCase())
        setView('register')
      } else {
        setInviteError(t('auth.err.invalidInviteCode'))
        setInviteShake(true)
        setTimeout(() => setInviteShake(false), 500)
      }
    } catch {
      setInviteError(t('auth.networkError'))
    } finally {
      setInviteLoading(false)
    }
  }

  // ── Landing: join waitlist ──
  const handleWaitlist = async () => {
    const em = waitlistEmail.trim()
    if (!em) return
    setWaitlistError('')
    setWaitlistLoading(true)

    try {
      const res = await fetch('/api/auth/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em }),
      })
      const data = await res.json()
      if (data.success) {
        setWaitlistDone(true)
      } else {
        setWaitlistError(data.error || t('auth.networkError'))
      }
    } catch {
      setWaitlistError(t('auth.networkError'))
    } finally {
      setWaitlistLoading(false)
    }
  }

  // ── Register: sign up with validated invite code ──
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorKey('')
    setErrorRaw('')
    setLoading(true)

    try {
      const { error } = await getSupabase().auth.signUp({ email, password })
      if (error) {
        const key = ERROR_KEY_MAP[error.message]
        if (key) setErrorKey(key); else setErrorRaw(error.message)
        return
      }
      // Activate immediately with invite code (don't rely on /activate page)
      try {
        const activateRes = await fetch('/api/auth/validate-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: validatedCode }),
        })
        const activateData = await activateRes.json()
        if (activateData.success && activateData.welcome) {
          window.location.href = '/projects?welcome=1'
          return
        }
      } catch { /* fall through */ }
      // Fallback: store code for /activate page
      sessionStorage.setItem('mkr_invite_code', validatedCode)
      window.location.href = '/'
    } catch {
      setErrorKey('auth.networkError')
    } finally {
      setLoading(false)
    }
  }

  // ── Login: sign in ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorKey('')
    setErrorRaw('')
    setLoading(true)

    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password })
      if (error) {
        const key = ERROR_KEY_MAP[error.message]
        if (key) setErrorKey(key); else setErrorRaw(error.message)
        return
      }
      window.location.href = '/'
    } catch {
      setErrorKey('auth.networkError')
    } finally {
      setLoading(false)
    }
  }

  const errorMsg = errorKey ? t(errorKey as Parameters<typeof t>[0]) : errorRaw

  const switchView = (v: View) => {
    setView(v)
    setErrorKey('')
    setErrorRaw('')
    setEmail('')
    setPassword('')
  }

  return (
    <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');
      .mkr-handwrite { font-family: 'Caveat', cursive; }
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-8px); }
        40% { transform: translateX(8px); }
        60% { transform: translateX(-6px); }
        80% { transform: translateX(6px); }
      }
      .shake { animation: shake 0.4s ease-in-out; }
    `}</style>
    <div className="min-h-dvh bg-black flex items-center justify-center px-6 relative overflow-hidden">
      {/* Fuchsia glow */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% 60%, rgba(217,70,239,0.06) 0%, transparent 70%)',
      }} />

      {/* Language toggle */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>
        <LocaleToggle />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-3 mb-1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(217,70,239)" strokeWidth="1.8" strokeLinecap="round">
            <line x1="12" y1="2" x2="12" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
          </svg>
          <div style={{
            fontWeight: 800,
            fontSize: 'clamp(2.2rem, 10vw, 3.2rem)',
            letterSpacing: '-0.04em',
            color: '#fff',
            lineHeight: 1,
          }}>
            Makaron
          </div>
        </div>
        <div className="text-center mb-10">
          <RollingTagline className="text-[1.15rem] tracking-wide" />
        </div>

        {/* ══════ LANDING VIEW ══════ */}
        {view === 'landing' && (
          <>
            {/* Invite code section */}
            <div className="space-y-3 mb-8">
              <div className={inviteShake ? 'shake' : ''}>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => { setInviteCode(e.target.value); setInviteError('') }}
                  placeholder={t('auth.inviteCodePlaceholder')}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(e) => e.key === 'Enter' && handleInviteSubmit()}
                  className="w-full px-4 py-4 rounded-xl bg-white/[0.07] text-white text-center text-lg font-mono placeholder-white/20 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-all uppercase"
                  style={{ letterSpacing: '0.25em' }}
                />
              </div>

              {inviteError && (
                <p className="text-red-400 text-sm text-center">{inviteError}</p>
              )}

              <button
                onClick={handleInviteSubmit}
                disabled={inviteLoading || !inviteCode.trim()}
                className="w-full py-3.5 rounded-xl font-medium text-white transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  background: inviteCode.trim()
                    ? 'linear-gradient(to right, #c026d3, #9333ea)'
                    : 'rgba(255,255,255,0.18)',
                  boxShadow: inviteCode.trim() ? '0 0 20px rgba(192,38,211,0.2)' : 'none',
                }}
              >
                {inviteLoading ? (
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  t('auth.activate')
                )}
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/25 text-xs">{t('auth.noInviteCode')}</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Waitlist section */}
            {waitlistDone ? (
              <div className="text-center py-4">
                <div className="text-green-400 text-sm mb-1">✓ {t('auth.waitlistSuccess')}</div>
                <div className="text-white/30 text-xs">{t('auth.waitlistSuccessDesc')}</div>
              </div>
            ) : (
              <div className="flex gap-2 mb-8">
                <input
                  type="email"
                  value={waitlistEmail}
                  onChange={(e) => { setWaitlistEmail(e.target.value); setWaitlistError('') }}
                  placeholder={t('auth.email')}
                  onKeyDown={(e) => e.key === 'Enter' && handleWaitlist()}
                  className="flex-1 px-4 py-3 rounded-lg bg-white/[0.07] text-white text-sm placeholder-white/25 border border-white/10 focus:border-fuchsia-500/30 focus:outline-none transition-colors"
                />
                <button
                  onClick={handleWaitlist}
                  disabled={waitlistLoading || !waitlistEmail.trim()}
                  className="px-4 py-3 rounded-lg bg-white/10 text-white/70 text-sm font-medium hover:bg-white/15 transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {waitlistLoading ? '...' : t('auth.joinWaitlist')}
                </button>
              </div>
            )}

            {waitlistError && (
              <p className="text-red-400 text-xs text-center mb-4 -mt-4">{waitlistError}</p>
            )}

            {/* Sign in link */}
            <p className="text-center text-sm text-white/30">
              {t('auth.hasAccount')}
              <button onClick={() => switchView('login')} className="text-fuchsia-400/70 hover:text-fuchsia-300 ml-1">
                {t('auth.goLogin')}
              </button>
            </p>
          </>
        )}

        {/* ══════ REGISTER VIEW ══════ */}
        {view === 'register' && (
          <>
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400 text-sm mb-4">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
                {validatedCode}
              </div>
              <h2 className="text-white text-lg font-medium">{t('auth.createAccount')}</h2>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <input
                type="email"
                placeholder={t('auth.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors"
              />
              <input
                type="password"
                placeholder={t('auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors"
              />

              {errorMsg && <p className="text-red-400 text-sm text-center">{errorMsg}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(to right, #c026d3, #9333ea)' }}
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {t('auth.register')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-white/30">
              <button onClick={() => switchView('landing')} className="text-white/40 hover:text-white/60">
                ← {t('auth.back')}
              </button>
            </p>
          </>
        )}

        {/* ══════ LOGIN VIEW ══════ */}
        {view === 'login' && (
          <>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email"
                placeholder={t('auth.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors"
              />
              <input
                type="password"
                placeholder={t('auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors"
              />

              {errorMsg && <p className="text-red-400 text-sm text-center">{errorMsg}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg bg-fuchsia-600 text-white font-medium hover:bg-fuchsia-500 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {t('auth.login')}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-white/30">
              <button onClick={() => switchView('landing')} className="text-white/40 hover:text-white/60">
                ← {t('auth.back')}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
    </>
  )
}
