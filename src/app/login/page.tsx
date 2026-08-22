'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useLocale, LocaleToggle } from '@/lib/i18n'
import { isMakaronIOSApp, userAgentHasMakaronIOSToken } from '@/lib/native-app'
import { isNativeOAuthAvailable, openNativeOAuthSession } from '@/lib/native-oauth'
import RollingTagline from '@/components/RollingTagline'
import { MakaronSpark, MAKARON_WORDMARK_STYLE } from '@/components/MakaronLogo'
import { useHydrated } from '@/hooks/useHydrated'
import { createMetaEventId, trackMetaEvent } from '@/lib/marketing/meta-pixel'
import {
  resolveAuthReturnPathForRuntime,
  selectAuthReturnPath,
} from '@/lib/auth-return'
import { linkIOSPreAuthTrialContinuation } from '@/lib/ios-preauth-trial'

type View = 'form' | 'verify-otp' | 'forgot-password' | 'reset-password'
type OtpPurpose = 'signup' | 'recovery'
const IOS_PENDING_HOME_SKILL_KEY = 'makaron:ios-pending-home-skill-id'

function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return userAgentHasMakaronIOSToken(ua)
    || /MicroMessenger|WeChat|QQ|DingTalk|Douyin|BytedanceWebview|FBAN|FBAV|Instagram|Line|Twitter/i.test(ua)
}

function isAppleLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN === 'true'
}

export default function LoginPage() {
  const { t } = useLocale()
  const router = useRouter()
  const hydrated = useHydrated()
  const [view, setView] = useState<View>('form')
  const inApp = hydrated && isInAppBrowser()
  const iosApp = hydrated && isMakaronIOSApp()
  const [appleLoginEnabled] = useState(isAppleLoginEnabled)
  const showAppleOAuth = inApp && appleLoginEnabled
  const showGoogleOAuth = !inApp || iosApp || showAppleOAuth

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState('')

  // OTP state (8 digits)
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>('signup')
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(8).fill(''))
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const [resendCooldown, setResendCooldown] = useState(0)

  // Reset password state
  const [newPassword, setNewPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  const supabaseRef = useRef<SupabaseClient | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  const keepFocusedFieldVisible = (target: EventTarget | null) => {
    const el = target instanceof HTMLElement ? target : null
    if (!el) return
    const adjust = () => {
      const page = pageRef.current
      const vv = window.visualViewport
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      if (!page || !vv) {
        return
      }

      const rect = el.getBoundingClientRect()
      const visibleTop = vv.offsetTop + 24
      const visibleBottom = vv.offsetTop + vv.height - 24
      if (rect.bottom > visibleBottom) {
        page.scrollBy({ top: rect.bottom - visibleBottom, behavior: 'smooth' })
      } else if (rect.top < visibleTop) {
        page.scrollBy({ top: rect.top - visibleTop, behavior: 'smooth' })
      }
    }
    window.setTimeout(adjust, 80)
    window.setTimeout(adjust, 260)
  }


  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    if (!iosApp || view !== 'form') return
    if (new URLSearchParams(window.location.search).get('focus') !== 'email') return
    const timer = window.setTimeout(() => {
      emailRef.current?.focus({ preventScroll: true })
      if (emailRef.current) keepFocusedFieldVisible(emailRef.current)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [iosApp, view])

  function getReturnUrl(): string {
    const queryReturn = new URLSearchParams(window.location.search).get('next')
    return selectAuthReturnPath(
      queryReturn,
      sessionStorage.getItem('mkr_return_url'),
      localStorage.getItem('mkr_return_url'),
    )
  }

  function resolveReturnUrlForRuntime(returnUrl: string): string {
    const iosAppRuntime = isMakaronIOSApp()
    const resolved = resolveAuthReturnPathForRuntime(returnUrl, iosAppRuntime)
    if (!resolved.skillId) return resolved.returnPath
    if (iosAppRuntime) {
      const skillId = resolved.skillId
      sessionStorage.setItem(IOS_PENDING_HOME_SKILL_KEY, skillId)
      localStorage.setItem(IOS_PENDING_HOME_SKILL_KEY, skillId)
    }
    return resolved.returnPath
  }

  function getOAuthCallbackUrl(nativeOAuth = false): string {
    const callback = new URL('/api/auth/callback', window.location.origin)
    if (nativeOAuth) callback.searchParams.set('native_oauth', '1')
    const returnUrl = getReturnUrl()
    if (returnUrl) callback.searchParams.set('next', returnUrl)
    return callback.toString()
  }

  function withOnboardingParam(url: string, onboarding?: 'welcome' | 'trial'): string {
    if (!onboarding) return url
    try {
      const parsed = new URL(url, window.location.origin)
      parsed.searchParams.set(onboarding, '1')
      return parsed.pathname + parsed.search + parsed.hash
    } catch {
      const sep = url.includes('?') ? '&' : '?'
      return `${url}${sep}${onboarding}=1`
    }
  }

  function redirectAfterAuth(options?: { fallback?: string; onboarding?: 'welcome' | 'trial' }) {
    let returnUrl = getReturnUrl()
    sessionStorage.removeItem('mkr_return_url')
    localStorage.removeItem('mkr_return_url')
    // mkr_return_text and mkr_return_skill are consumed by the home page on mount
    returnUrl = resolveReturnUrlForRuntime(returnUrl)
    const destination = withOnboardingParam(returnUrl || options?.fallback || '/', options?.onboarding)
    if (isMakaronIOSApp()) {
      router.replace(destination)
      return
    }
    window.location.href = destination
  }

  async function completeAuthAndRedirect(options?: { fallback?: string }) {
    const completeRes = await fetch('/api/auth/complete', { method: 'POST' })
    const complete = await completeRes.json().catch(() => ({}))
    if (!completeRes.ok) {
      throw new Error(complete.error || 'Login could not finish')
    }
    if (complete.isNewUser) {
      trackMetaEvent(
        'CompleteRegistration',
        {},
        complete.metaEvents?.CompleteRegistration || createMetaEventId('registration'),
      )
    }
    if (complete.appleTrialClaimed) linkIOSPreAuthTrialContinuation()
    redirectAfterAuth({
      fallback: options?.fallback || complete.redirectUrl || '/projects',
      onboarding: complete.isNewUser && !complete.appleTrialClaimed
        ? (complete.trialRequired ? 'trial' : 'welcome')
        : undefined,
    })
  }

  async function finishNativeOAuth(callbackUrl: string) {
    const parsed = new URL(callbackUrl)
    const oauthError = parsed.searchParams.get('error') || parsed.hash.match(/error=([^&]+)/)?.[1]
    if (oauthError) {
      throw new Error(decodeURIComponent(oauthError))
    }

    const code = parsed.searchParams.get('code')
    if (!code) {
      throw new Error('Google login did not return an authorization code')
    }

    const supabase = getSupabase()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      throw exchangeError
    }

    await completeAuthAndRedirect()
  }

  // ── Google OAuth ──
  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    setError('')
    if (iosApp && isNativeOAuthAvailable()) {
      try {
        const { data, error } = await getSupabase().auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: getOAuthCallbackUrl(true),
            skipBrowserRedirect: true,
          },
        })
        if (error) throw error
        if (!data?.url) throw new Error('Google login URL was not returned')
        const callbackUrl = await openNativeOAuthSession(data.url)
        await finishNativeOAuth(callbackUrl)
      } catch (error) {
        const message = error instanceof Error ? error.message : t('auth.networkError')
        setError(message === 'Google login cancelled' ? '' : message)
        setGoogleLoading(false)
      }
      return
    }

    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getOAuthCallbackUrl(),
      },
    })
    if (error) { setError(t('auth.networkError')); setGoogleLoading(false) }
  }

  // ── Apple OAuth ──
  const handleAppleLogin = async () => {
    setAppleLoading(true)
    setError('')
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: getOAuthCallbackUrl(),
      },
    })
    if (error) { setError(t('auth.networkError')); setAppleLoading(false) }
  }

  // ── Smart Continue ──
  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = getSupabase()

      // Check user existence
      const checkRes = await fetch('/api/auth/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const check = await checkRes.json()

      if (check.action === 'verify-email') {
        // User exists but hasn't verified OTP — resend code
        await supabase.auth.signInWithOtp({ email })
        setOtpPurpose('signup')
        setOtpDigits(Array(8).fill(''))
        setResendCooldown(60)
        setView('verify-otp')
        return
      }

      if (check.action === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (!signInError) { await completeAuthAndRedirect(); return }
        if (signInError.message === 'Email not confirmed') {
          // Edge case: user exists but unconfirmed — send OTP
          await supabase.auth.signInWithOtp({ email })
          setOtpPurpose('signup')
          setOtpDigits(Array(8).fill(''))
          setResendCooldown(60)
          setView('verify-otp')
          return
        }
        setError(mapError(signInError.message))
        return
      }

      if (check.action === 'signup') {
        // Create user with password (no email sent)
        const signupRes = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const signupData = await signupRes.json()
        if (!signupRes.ok) {
          setError(mapError(signupData.error || 'Registration failed'))
          return
        }

        // Send OTP verification code
        const { error: otpErr2 } = await supabase.auth.signInWithOtp({ email })
        const waitMatch2 = otpErr2?.message?.match(/after (\d+) seconds/)
        setOtpPurpose('signup')
        setOtpDigits(Array(8).fill(''))
        setResendCooldown(waitMatch2 ? parseInt(waitMatch2[1]) : 60)
        setView('verify-otp')
        return
      }

      setError(check.message || check.error || t('auth.networkError'))
    } catch {
      setError(t('auth.networkError'))
    } finally {
      setLoading(false)
    }
  }

  // ── Verify OTP ──
  const handleVerifyOtp = async () => {
    const token = otpDigits.join('')
    if (token.length < 6) return
    setOtpError('')
    setOtpLoading(true)

    try {
      const supabase = getSupabase()
      // Try verification: recovery uses 'recovery', signup tries 'email' then 'magiclink'
      let verifyError: string | null = null
      if (otpPurpose === 'recovery') {
        const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })
        if (error) verifyError = error.message
      } else {
        const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
        if (error) {
          const { error: err2 } = await supabase.auth.verifyOtp({ email, token, type: 'magiclink' })
          if (err2) verifyError = err2.message
        }
      }

      if (verifyError) {
        setOtpError(mapError(verifyError))
        setOtpLoading(false)
        return
      }

      if (otpPurpose === 'recovery') {
        setView('reset-password')
        setOtpLoading(false)
        return
      }

      // Signup verified — redirect (new user goes to home with welcome)
      if (otpPurpose === 'signup') {
        await completeAuthAndRedirect({ fallback: '/home' })
      } else {
        await completeAuthAndRedirect()
      }
    } catch {
      setOtpError(t('auth.networkError'))
      setOtpLoading(false)
    }
  }

  // ── Resend OTP ──
  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    const supabase = getSupabase()
    if (otpPurpose === 'recovery') {
      await supabase.auth.resetPasswordForEmail(email)
    } else {
      await supabase.auth.signInWithOtp({ email })
    }
    setResendCooldown(60)
  }

  // ── Forgot Password ──
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const supabase = getSupabase()
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      if (error) {
        // "wait X seconds" means code was already sent — go to OTP view
        const waitMatch = error.message.match(/after (\d+) seconds/)
        if (waitMatch) {
          setOtpPurpose('recovery')
          setOtpDigits(Array(8).fill(''))
          setResendCooldown(parseInt(waitMatch[1]))
          setView('verify-otp')
          return
        }
        setError(mapError(error.message))
        return
      }
      setOtpPurpose('recovery')
      setOtpDigits(Array(8).fill(''))
      setResendCooldown(60)
      setView('verify-otp')
    } catch {
      setError(t('auth.networkError'))
    } finally {
      setLoading(false)
    }
  }

  // ── Reset Password ──
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetLoading(true)
    try {
      const supabase = getSupabase()
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) { setError(mapError(error.message)); setResetLoading(false); return }
      setResetSuccess(true)
      setTimeout(() => {
        void completeAuthAndRedirect().catch(() => {
          setError(t('auth.networkError'))
          setResetLoading(false)
        })
      }, 1500)
    } catch {
      setError(t('auth.networkError'))
      setResetLoading(false)
    }
  }

  // OTP Input Handling (8 digits)
  const handleOtpChange = (idx: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const digit = value.slice(-1)
    const newDigits = [...otpDigits]
    newDigits[idx] = digit
    setOtpDigits(newDigits)
    if (digit && idx < 7) otpRefs.current[idx + 1]?.focus()
  }

  const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 8)
    if (!text) return
    const newDigits = Array(8).fill('')
    for (let i = 0; i < text.length; i++) newDigits[i] = text[i]
    setOtpDigits(newDigits)
    const focusIdx = Math.min(text.length, 7)
    otpRefs.current[focusIdx]?.focus()
  }

  // Auto-submit when all 8 digits filled
  useEffect(() => {
    if (otpDigits.every(d => d) && view === 'verify-otp') handleVerifyOtp()
  }, [otpDigits])

  function mapError(msg: string): string {
    const map: Record<string, string> = {
      'Invalid login credentials': 'auth.err.invalidCredentials',
      'Email not confirmed': 'auth.err.emailNotConfirmed',
      'User already registered': 'auth.err.alreadyRegistered',
      'Password should be at least 6 characters': 'auth.err.passwordTooShort',
      'Unable to validate email address: invalid format': 'auth.err.invalidEmail',
      'Email rate limit exceeded': 'auth.err.rateLimited',
      'For security purposes, you can only request this after 60 seconds.': 'auth.err.wait60s',
      'Token has expired or is invalid': 'auth.err.invalidCredentials',
    }
    const key = map[msg]
    return key ? t(key as Parameters<typeof t>[0]) : msg
  }

  return (
    <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');
      .mkr-handwrite { font-family: 'Caveat', cursive; }
    `}</style>
    <div
      ref={pageRef}
      className="makaron-ios-page makaron-ios-page-x min-h-dvh bg-black flex items-center justify-center px-6 relative overflow-y-auto overscroll-contain"
      style={{
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 'calc(32px + env(safe-area-inset-bottom, 0px) + var(--makaron-native-keyboard-inset, 0px))',
      }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% 60%, rgba(217,70,239,0.06) 0%, transparent 70%)',
      }} />
      <div
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          left: 'max(20px, env(safe-area-inset-left, 0px))',
          zIndex: 10,
        }}
      >
        <LocaleToggle />
      </div>

      <div className="w-full max-w-sm relative z-10 py-10">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-3 mb-1">
          <MakaronSpark size={30} />
          <div style={{ ...MAKARON_WORDMARK_STYLE, fontSize: 'clamp(2.2rem, 10vw, 3.2rem)' }}>
            Makaron
          </div>
        </div>
        <div className="text-center mb-10">
          <RollingTagline className="text-[1.15rem] tracking-wide" />
        </div>

        {/* ══════ FORM VIEW ══════ */}
        {view === 'form' && (
          <>
            {(showAppleOAuth || showGoogleOAuth) && (
              <>
                {showAppleOAuth && (
                  <button
                    onClick={handleAppleLogin}
                    disabled={appleLoading}
                    className="w-full py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                    style={{ background: '#fff', border: '1px solid rgba(255,255,255,0.2)', color: '#050505' }}
                  >
                    {appleLoading ? (
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    ) : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M16.37 1.51c0 1.08-.43 2.1-1.15 2.88-.78.85-2.06 1.5-3.08 1.42-.13-1.04.38-2.16 1.1-2.96.8-.89 2.18-1.52 3.13-1.34Zm3.96 16.02c-.59 1.35-.87 1.96-1.62 3.15-1.05 1.67-2.53 3.75-4.36 3.77-1.63.02-2.05-1.09-4.26-1.08-2.22.01-2.68 1.1-4.31 1.08-1.83-.02-3.22-1.89-4.27-3.56-2.94-4.69-3.25-10.2-1.44-13.13C1.36 5.71 3.4 4.51 5.31 4.51c1.95 0 3.18 1.07 4.79 1.07 1.57 0 2.52-1.07 4.78-1.07 1.71 0 3.52.93 4.8 2.55-4.22 2.31-3.54 8.34.65 10.47Z" />
                        </svg>
                        {t('auth.continueWithApple')}
                      </>
                    )}
                  </button>
                )}

                {showGoogleOAuth && (
                  <button
                    onClick={handleGoogleLogin}
                    disabled={googleLoading}
                    className={`w-full ${showAppleOAuth ? 'mt-3' : ''} py-3 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3`}
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                  >
                    {googleLoading ? (
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
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
                )}

                <div className="flex items-center gap-3 my-6">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-white/25 text-xs">{t('auth.orDivider')}</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
              </>
            )}


            <form onSubmit={handleContinue} className="space-y-4">
              <input ref={emailRef} type="email" inputMode="email" enterKeyHint="next" autoComplete="email" placeholder={t('auth.email')} value={email} onFocus={(e) => keepFocusedFieldVisible(e.currentTarget)} onChange={(e) => { setEmail(e.target.value); setError('') }} required
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors" />
              <input type="password" placeholder={t('auth.password')} value={password} onFocus={(e) => keepFocusedFieldVisible(e.currentTarget)} onChange={(e) => { setPassword(e.target.value); setError('') }} required minLength={6}
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors" />

              {error && <p className="text-red-400 text-sm text-center">{error}</p>}

              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(to right, #c026d3, #9333ea)' }}>
                {loading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                {t('auth.continue')}
              </button>
            </form>

            <p className="mt-4 text-center">
              <button onClick={() => { setError(''); setView('forgot-password') }} className="text-white/30 hover:text-white/50 text-xs transition-colors">
                {t('auth.forgotPassword')}
              </button>
            </p>
            <p className="mt-6 text-center">
              <Link href="/home" className="text-white/25 hover:text-white/50 text-xs transition-colors">
                ← {t('auth.back')}
              </Link>
            </p>
          </>
        )}

        {/* ══════ VERIFY OTP VIEW ══════ */}
        {view === 'verify-otp' && (
          <div className="text-center">
            <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full mb-5" style={{ background: 'rgba(217,70,239,0.08)', border: '1px solid rgba(217,70,239,0.15)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" />
              </svg>
            </div>

            <h2 className="text-white text-xl font-bold mb-2">{t('auth.otp.title')}</h2>
            <p className="text-white/50 text-sm mb-1">{t('auth.otp.subtitle')}</p>
            <p className="text-white font-medium text-sm mb-8">{email}</p>

            {/* 8-digit OTP input */}
            <div className="flex justify-center gap-1.5 mb-6" onPaste={handleOtpPaste}>
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onFocus={(e) => keepFocusedFieldVisible(e.currentTarget)}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  autoFocus={i === 0}
                  className="w-9 h-12 text-center text-lg font-bold rounded-lg bg-white/[0.07] text-white border border-white/15 focus:border-fuchsia-500/60 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/40 transition-colors"
                  style={{ caretColor: 'rgb(217,70,239)' }}
                />
              ))}
            </div>

            {otpError && <p className="text-red-400 text-sm mb-4">{otpError}</p>}

            <button
              onClick={handleVerifyOtp}
              disabled={otpLoading || otpDigits.some(d => !d)}
              className="w-full py-3 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
              style={{ background: 'linear-gradient(to right, #c026d3, #9333ea)' }}
            >
              {otpLoading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
              {t('auth.otp.verify')}
            </button>

            <button
              onClick={handleResendOtp}
              disabled={resendCooldown > 0}
              className="text-sm transition-colors disabled:cursor-not-allowed"
              style={{ color: resendCooldown > 0 ? 'rgba(255,255,255,0.25)' : 'rgba(217,70,239,0.8)' }}
            >
              {resendCooldown > 0 ? `${t('auth.otp.resendIn')} ${resendCooldown}s` : t('auth.otp.resend')}
            </button>

            <p className="mt-6">
              <button onClick={() => { setView('form'); setOtpError('') }} className="text-white/35 hover:text-white/60 text-sm transition-colors">
                ← {t('auth.back')}
              </button>
            </p>
          </div>
        )}

        {/* ══════ FORGOT PASSWORD VIEW ══════ */}
        {view === 'forgot-password' && (
          <div>
            <h2 className="text-white text-xl font-bold text-center mb-6">{t('auth.resetPassword.title')}</h2>
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <input type="email" placeholder={t('auth.email')} value={email} onFocus={(e) => keepFocusedFieldVisible(e.currentTarget)} onChange={(e) => { setEmail(e.target.value); setError('') }} required
                className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors" />

              {error && <p className="text-red-400 text-sm text-center">{error}</p>}

              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(to right, #c026d3, #9333ea)' }}>
                {loading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                {t('auth.resetPassword.send')}
              </button>
            </form>
            <p className="mt-6 text-center">
              <button onClick={() => { setView('form'); setError('') }} className="text-white/35 hover:text-white/60 text-sm transition-colors">
                ← {t('auth.back')}
              </button>
            </p>
          </div>
        )}

        {/* ══════ RESET PASSWORD VIEW ══════ */}
        {view === 'reset-password' && (
          <div>
            <h2 className="text-white text-xl font-bold text-center mb-6">{t('auth.resetPassword.title')}</h2>
            {resetSuccess ? (
              <div className="text-center">
                <div className="text-green-400 text-lg font-medium mb-2">✓</div>
                <p className="text-green-400 text-sm">{t('auth.resetPassword.success')}</p>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <input type="password" placeholder={t('auth.resetPassword.newPassword')} value={newPassword} onFocus={(e) => keepFocusedFieldVisible(e.currentTarget)} onChange={(e) => setNewPassword(e.target.value)} required minLength={6}
                  className="w-full px-4 py-3 rounded-lg bg-white/[0.07] text-white placeholder-white/30 border border-white/10 focus:border-fuchsia-500/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 transition-colors" />

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <button type="submit" disabled={resetLoading}
                  className="w-full py-3 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(to right, #c026d3, #9333ea)' }}>
                  {resetLoading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                  {t('auth.resetPassword.confirm')}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
