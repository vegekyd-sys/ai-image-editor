import { useAuth } from './useAuth'
import { useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { User } from '@supabase/supabase-js'

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

    const resolved = await new Promise<User | null>((resolve) => {
      const start = Date.now()
      const check = () => {
        if (!loadingRef.current) { resolve(userRef.current); return }
        if (Date.now() - start > 2000) { resolve(null); return }
        requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })

    if (resolved) return resolved
    rememberReturnUrl()
    router.push('/login')
    return null
  }, [rememberReturnUrl, router])

  return requireAuth
}
