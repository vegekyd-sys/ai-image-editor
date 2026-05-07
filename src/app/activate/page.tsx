'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n'

export default function ActivatePage() {
  const { t } = useLocale()
  const [showMessage, setShowMessage] = useState(false)

  useEffect(() => {
    const run = async () => {
      // Try auto-activate via validate-invite (handles existing users)
      try {
        const res = await fetch('/api/auth/validate-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoActivate: true }),
        })
        const data = await res.json()
        if (data.success) {
          window.location.href = data.welcome ? '/projects?welcome=1' : '/projects'
          return
        }
      } catch { /* not auto-activatable */ }

      // If we get here, user needs to verify their email
      setShowMessage(true)
    }
    run()
  }, [])

  const handleResend = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.email) {
      await supabase.auth.resend({
        type: 'signup',
        email: user.email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        },
      })
    }
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    document.cookie = 'mkr_activated=; path=/; max-age=0'
    window.location.href = '/login'
  }

  if (!showMessage) {
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
    <div className="min-h-dvh bg-black flex items-center justify-center px-6">
      <div className="text-center space-y-4 max-w-sm">
        <div className="text-4xl">📫</div>
        <h2 className="text-white text-xl font-semibold">{t('auth.verifyEmail.title')}</h2>
        <p className="text-white/50 text-sm">{t('auth.verifyEmail.instruction')}</p>
        <button
          onClick={handleResend}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
        >
          {t('auth.verifyEmail.resend')}
        </button>
        <p className="text-white/30 text-xs">{t('auth.verifyEmail.checkSpam')}</p>
        <p>
          <button onClick={handleSignOut} className="text-white/40 hover:text-white/60 text-sm">
            ← {t('auth.back')}
          </button>
        </p>
      </div>
    </div>
  )
}
