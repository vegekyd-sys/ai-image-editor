'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useLocale, LocaleToggle } from '@/lib/i18n'

const ERROR_KEY_MAP: Record<string, string> = {
  'Invalid login credentials': 'auth.err.invalidCredentials',
  'Email not confirmed': 'auth.err.emailNotConfirmed',
  'User already registered': 'auth.err.alreadyRegistered',
  'Password should be at least 6 characters': 'auth.err.passwordTooShort',
  'Unable to validate email address: invalid format': 'auth.err.invalidEmail',
  'Email rate limit exceeded': 'auth.err.rateLimited',
  'For security purposes, you can only request this after 60 seconds.': 'auth.err.wait60s',
}

export default function LoginPage() {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<string>('')
  const [errorRaw, setErrorRaw] = useState<string>('')
  const supabaseRef = useRef<SupabaseClient | null>(null)

  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient()
    }
    return supabaseRef.current
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorKey('')
    setErrorRaw('')
    setLoading(true)

    try {
      if (isRegister) {
        const { error } = await getSupabase().auth.signUp({ email, password })
        if (error) {
          const key = ERROR_KEY_MAP[error.message]
          if (key) setErrorKey(key); else setErrorRaw(error.message)
          return
        }
      } else {
        const { error } = await getSupabase().auth.signInWithPassword({ email, password })
        if (error) {
          const key = ERROR_KEY_MAP[error.message]
          if (key) setErrorKey(key); else setErrorRaw(error.message)
          return
        }
      }
      window.location.href = '/'
    } catch {
      setErrorKey('auth.networkError')
    } finally {
      setLoading(false)
    }
  }

  const errorMsg = errorKey ? t(errorKey as Parameters<typeof t>[0]) : errorRaw

  return (
    <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');
      .mkr-handwrite { font-family: 'Caveat', cursive; }
    `}</style>
    <div className="min-h-dvh bg-black flex items-center justify-center px-6">
      {/* Language toggle — top right */}
      <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 10 }}>
        <LocaleToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Wordmark row: asterisk icon + Makaron */}
        <div className="flex items-center justify-center gap-3 mb-1">
          <svg
            width="18" height="18" viewBox="0 0 24 24"
            fill="none"
            stroke="rgb(217,70,239)"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
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
        {/* Subtitle */}
        <div className="mkr-handwrite text-center mb-8" style={{
          fontSize: '1rem',
          letterSpacing: '0.02em',
          color: 'rgba(217,70,239,0.65)',
          fontWeight: 400,
        }}>
          one man studio
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder={t('auth.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg bg-white/10 text-white placeholder-white/40 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors"
            />
          </div>

          <div>
            <input
              type="password"
              placeholder={t('auth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-lg bg-white/10 text-white placeholder-white/40 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors"
            />
          </div>

          {errorMsg && (
            <p className="text-red-400 text-sm text-center">{errorMsg}</p>
          )}

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
            {isRegister ? t('auth.register') : t('auth.login')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/40">
          {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}
          <button
            onClick={() => { setIsRegister(!isRegister); setErrorKey(''); setErrorRaw('') }}
            className="text-fuchsia-400 hover:text-fuchsia-300 ml-1"
          >
            {isRegister ? t('auth.goLogin') : t('auth.register')}
          </button>
        </p>
      </div>
    </div>
    </>
  )
}
