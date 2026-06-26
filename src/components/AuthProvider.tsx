'use client'

import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import { User, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { clearUserCache } from '@/lib/imageCache'
import { readNativeJSONCache, writeNativeJSONCache, removeNativeJSONCache, warmNativeJSONCache } from '@/lib/native-app-cache'
import { isMakaronIOSApp } from '@/lib/native-app'
import { warmProjectsListCache } from '@/lib/projects-list-warm'

const AUTH_USER_CACHE_KEY = '/auth/user'
const IOS_RESET_HOME_SCROLL_KEY = 'makaron:ios-reset-home-scroll'

export interface AuthContextType {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
})

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [useNativeAuthCache] = useState(() => isMakaronIOSApp())
  const [cachedUser] = useState<User | null>(() => (
    useNativeAuthCache ? readNativeJSONCache<User>(AUTH_USER_CACHE_KEY) : null
  ))
  const [user, setUser] = useState<User | null>(cachedUser)
  const [loading, setLoading] = useState(() => !cachedUser)
  const supabaseRef = useRef<SupabaseClient | null>(null)
  const nativeWarmUserIdRef = useRef<string | null>(null)

  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient()
    }
    return supabaseRef.current
  }

  const warmNativeUserCaches = useCallback((userId: string) => {
    if (!useNativeAuthCache || nativeWarmUserIdRef.current === userId) return
    nativeWarmUserIdRef.current = userId
    const warm = () => {
      void warmNativeJSONCache('/api/billing/credits')
      void warmNativeJSONCache('/api/billing/dashboard')
      void warmNativeJSONCache('/api/skills')
      void warmNativeJSONCache('/api/home-skills')
      void warmProjectsListCache(userId)
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(warm, { timeout: 1800 })
    } else {
      window.setTimeout(warm, 600)
    }
  }, [useNativeAuthCache])

  useEffect(() => {
    const supabase = getSupabase()

    // Fast path: read session from cookie (no network)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      if (useNativeAuthCache) {
        if (session?.user) writeNativeJSONCache(AUTH_USER_CACHE_KEY, session.user)
        else removeNativeJSONCache(AUTH_USER_CACHE_KEY)
      }
      if (session?.user) warmNativeUserCaches(session.user.id)

      // Background validation: verify JWT is still valid (non-blocking, never forces logout)
      if (session?.user) {
        supabase.auth.getUser().then(({ data: { user: validatedUser }, error }) => {
          if (error || !validatedUser) {
            console.warn('[Auth] Background validation failed (network issue?):', error?.message)
          }
        })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (useNativeAuthCache) {
        if (session?.user) writeNativeJSONCache(AUTH_USER_CACHE_KEY, session.user)
        else removeNativeJSONCache(AUTH_USER_CACHE_KEY)
      }
      if (session?.user) warmNativeUserCaches(session.user.id)
    })

    return () => subscription.unsubscribe()
  }, [useNativeAuthCache, warmNativeUserCaches])

  const signOut = useCallback(async () => {
    const inIOSApp = isMakaronIOSApp()
    clearUserCache()
    if (useNativeAuthCache) removeNativeJSONCache(AUTH_USER_CACHE_KEY)
    if (inIOSApp) {
      try {
        sessionStorage.setItem(IOS_RESET_HOME_SCROLL_KEY, '1')
        document.body.style.overflow = ''
        document.body.style.position = ''
        document.body.style.width = ''
        document.body.style.top = ''
        document.documentElement.style.overflow = ''
        document.documentElement.classList.remove('makaron-ios-project-overlay-open')
      } catch {
        // Best-effort reset before crossing the hard sign-out boundary.
      }
    }
    document.cookie = 'mkr_activated=; path=/; max-age=0'
    await getSupabase().auth.signOut()
    if (inIOSApp) {
      window.location.replace('/home')
    } else {
      window.location.href = '/login'
    }
  }, [useNativeAuthCache])

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
