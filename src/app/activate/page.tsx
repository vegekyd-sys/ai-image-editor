'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Minimal activate page — handles two auto-activation cases:
// 1. Existing user (has projects) → auto-activate without invite code
// 2. New user with invite code in sessionStorage → auto-submit
// If neither applies, redirect to /login
export default function ActivatePage() {
  useEffect(() => {
    const run = async () => {
      // Try auto-activate (existing user with projects)
      try {
        const res = await fetch('/api/auth/validate-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoActivate: true }),
        })
        const data = await res.json()
        if (data.success && data.autoActivated) {
          window.location.href = '/projects'
          return
        }
      } catch { /* not an existing user */ }

      // Check sessionStorage for invite code from registration
      const stored = sessionStorage.getItem('mkr_invite_code')
      if (stored) {
        sessionStorage.removeItem('mkr_invite_code')
        try {
          const res = await fetch('/api/auth/validate-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: stored }),
          })
          const data = await res.json()
          if (data.success) {
            window.location.href = '/projects'
            return
          }
        } catch { /* fall through */ }
      }

      // No auto-activation possible — sign out and go to login
      const supabase = createClient()
      await supabase.auth.signOut()
      document.cookie = 'mkr_activated=; path=/; max-age=0'
      window.location.href = '/login'
    }
    run()
  }, [])

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center">
      <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}
