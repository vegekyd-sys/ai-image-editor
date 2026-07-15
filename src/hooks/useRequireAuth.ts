import { useAuth } from './useAuth'
import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export function useRequireAuth() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const userRef = useRef(user)
  const loadingRef = useRef(loading)
  userRef.current = user
  loadingRef.current = loading

  const rememberReturnUrl = useCallback(() => {
    const current = window.location.pathname + window.location.search
    const existing = sessionStorage.getItem('mkr_return_url') || localStorage.getItem('mkr_return_url')
    const target = existing || current
    localStorage.setItem('mkr_return_url', target)
    sessionStorage.setItem('mkr_return_url', target)
  }, [])

  const requireAuth = useCallback(async (): Promise<User | null> => {
    if (!loadingRef.current) {
      if (userRef.current) return userRef.current
      rememberReturnUrl()
      router.push('/login')
      return null
    }

    // Read the browser session once instead of polling React auth state for up
    // to two seconds. Supabase getSession is local-storage/cookie backed and is
    // the same fast path used by AuthProvider.
    const { data: { session } } = await createClient().auth.getSession()
    const resolved = userRef.current ?? session?.user ?? null

    if (resolved) return resolved
    rememberReturnUrl()
    router.push('/login')
    return null
  }, [rememberReturnUrl, router])

  return requireAuth
}
