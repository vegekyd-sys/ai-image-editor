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

type View = 'register' | 'login' | 'verify-email'

export default function LoginPage() {
  const { t } = useLocale()
  const [view, setView] = useState<View>('register')

  // Register / Login state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string>('')
  const [errorRaw, setErrorRaw] = useState<string>('')

  // Verify email state
  const [verifyEmail, setVerifyEmail] = useState('')
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)

  const supabaseRef = useRef<SupabaseClient | null>(null)
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  // ── Google OAuth ──
  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    setErrorKey('')
    setErrorRaw('')
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })
    if (error) {
      setErrorKey('auth.networkError')
      setGoogleLoading(false)
    }
  }

  // ── Register ──
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorKey('')
    setErrorRaw('')
    setLoading(true)

    try {
      const { error } = await getSupabase().auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        },
      })
      if (error) {
        const key = ERROR_KEY_MAP[error.message]
        if (key) setErrorKey(key); else setErrorRaw(error.message)
        return
      }
      setVerifyEmail(email)
      setView('verify-email')
    } catch {
      setErrorKey('auth.networkError')
    } finally {
      setLoading(false)
    }
  }

  // ── Login ──
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

  // ── Resend verification email ──
  const handleResend = async () => {
    setResending(true)
    setResent(false)
    try {
      await getSupabase().auth.resend({
        type: 'signup',
        email: verifyEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        },
      })
      setResent(true)
    } catch { /* ignore */ }
    finally { setResending(false) }
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

        {/* ══════ REGISTER VIEW ══════ */}
        {view === 'register' && (
          <>
            {/* Google OAuth */}
            <button
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full py-3 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            >
              {googleLoading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {t('auth.continueWithGoogle')}
                </>
              )}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/25 text-xs">{t('auth.orDivider')}</span>
              <div className="flex-1 h-px bg-white/10" />
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
              {t('auth.hasAccount')}
              <button onClick={() => switchView('login')} className="text-fuchsia-400/70 hover:text-fuchsia-300 ml-1">
                {t('auth.goLogin')}
              </button>
            </p>
          </>
        )}

        {/* ══════ LOGIN VIEW ══════ */}
        {view === 'login' && (
          <>
            {/* Google OAuth */}
            <button
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full py-3 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            >
              {googleLoading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {t('auth.continueWithGoogle')}
                </>
              )}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/25 text-xs">{t('auth.orDivider')}</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

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
              {t('auth.noAccount')}
              <button onClick={() => switchView('register')} className="text-fuchsia-400/70 hover:text-fuchsia-300 ml-1">
                {t('auth.goRegister')}
              </button>
            </p>
          </>
        )}

        {/* ══════ VERIFY EMAIL VIEW ══════ */}
        {view === 'verify-email' && (
          <div className="text-center space-y-4">
            <div className="text-4xl mb-2">📫</div>
            <h2 className="text-white text-xl font-semibold">{t('auth.verifyEmail.title')}</h2>
            <p className="text-white/50 text-sm">
              {t('auth.verifyEmail.sent')}<br />
              <span className="text-white/80 font-medium">{verifyEmail}</span>
            </p>
            <p className="text-white/40 text-xs">{t('auth.verifyEmail.instruction')}</p>

            <button
              onClick={handleResend}
              disabled={resending || resent}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: resent ? '#34d399' : '#fff' }}
            >
              {resending ? '...' : resent ? `✓ ${t('auth.verifyEmail.resent')}` : t('auth.verifyEmail.resend')}
            </button>

            <p className="text-white/30 text-xs mt-4">{t('auth.verifyEmail.checkSpam')}</p>

            <p className="mt-6">
              <button onClick={() => switchView('login')} className="text-white/40 hover:text-white/60 text-sm">
                ← {t('auth.back')}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
