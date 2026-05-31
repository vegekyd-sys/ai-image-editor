'use client'

import { createContext, useEffect, useState, useCallback, useRef } from 'react'
import { User, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { clearUserCache } from '@/lib/imageCache'
import { readNativeJSONCache, writeNativeJSONCache, removeNativeJSONCache } from '@/lib/native-app-cache'

const AUTH_USER_CACHE_KEY = '/auth/user'

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
  const [cachedUser] = useState<User | null>(() => readNativeJSONCache<User>(AUTH_USER_CACHE_KEY))
  const [user, setUser] = useState<User | null>(cachedUser)
  const [loading, setLoading] = useState(() => !cachedUser)
  const supabaseRef = useRef<SupabaseClient | null>(null)

  function getSupabase() {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient()
    }
    return supabaseRef.current
  }

  useEffect(() => {
    const supabase = getSupabase()

    // Fast path: read session from cookie (no network)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) writeNativeJSONCache(AUTH_USER_CACHE_KEY, session.user)
      else removeNativeJSONCache(AUTH_USER_CACHE_KEY)

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
      if (session?.user) writeNativeJSONCache(AUTH_USER_CACHE_KEY, session.user)
      else removeNativeJSONCache(AUTH_USER_CACHE_KEY)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    clearUserCache()
    removeNativeJSONCache(AUTH_USER_CACHE_KEY)
    document.cookie = 'mkr_activated=; path=/; max-age=0'
    await getSupabase().auth.signOut()
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
