'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/lib/i18n'
import Changelog from '@/components/Changelog'
import { getThumbnailUrl } from '@/lib/supabase/storage'
import { readNativeJSONCache, warmNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache'
import { isMakaronIOSApp } from '@/lib/native-app'
import { warmProjectsListCache } from '@/lib/projects-list-warm'

interface TopBarProps {
  page: 'home' | 'projects'
}

interface CreditsPayload {
  balance?: number
}

const TOPBAR_ROUTE_WARM_APIS: Record<string, string[]> = {
  '/home': ['/api/home-skills', '/api/skills'],
  '/projects': ['/api/skills', '/api/billing/credits'],
  '/dashboard': ['/api/billing/dashboard', '/api/billing/credits'],
  '/profile': ['/api/billing/credits'],
  '/skills': ['/api/skills'],
}

export default function TopBar({ page }: TopBarProps) {
  const { user, signOut } = useAuth()
  const { locale, setLocale } = useLocale()
  const router = useRouter()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [creditBalance, setCreditBalance] = useState<number | null>(() => {
    const cached = readNativeJSONCache<CreditsPayload>('/api/billing/credits')
    return cached?.balance ?? null
  })
  const [showChangelog, setShowChangelog] = useState(false)

  const warmTopBarRoute = useCallback((path: string) => {
    const route = path.split('?')[0] || path
    try {
      router.prefetch(route)
    } catch {
      // Prefetch is opportunistic; tap should still navigate normally.
    }
    if (!isMakaronIOSApp()) return
    TOPBAR_ROUTE_WARM_APIS[route]?.forEach((apiPath) => {
      void warmNativeJSONCache(apiPath)
    })
    if (route === '/projects' && user?.id) {
      void warmProjectsListCache(user.id)
    }
  }, [router, user?.id])

  const navigateTopBar = useCallback((path: string) => {
    setUserMenuOpen(false)
    warmTopBarRoute(path)
    router.push(path)
  }, [router, warmTopBarRoute])

  const warmTopBarMenuRoutes = useCallback(() => {
    ['/profile', '/dashboard', '/dashboard?tab=keys', '/skills'].forEach(warmTopBarRoute)
  }, [warmTopBarRoute])

  useEffect(() => {
    if (!isMakaronIOSApp()) return
    const warm = () => {
      ['/home', '/projects', '/dashboard', '/profile', '/skills'].forEach(warmTopBarRoute)
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm, { timeout: 1200 })
      return () => cancelIdleCallback(id)
    }
    const timer = window.setTimeout(warm, 400)
    return () => window.clearTimeout(timer)
  }, [warmTopBarRoute])

  useEffect(() => {
    if (!user) return
    const refresh = () => fetch('/api/billing/credits').then(r => r.json()).then(d => {
      writeNativeJSONCache('/api/billing/credits', d)
      setCreditBalance(d.balance ?? 0)
    }).catch(() => {})
    refresh()
    window.addEventListener('credits-updated', refresh)
    return () => window.removeEventListener('credits-updated', refresh)
  }, [user])

  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  return (
    <>
      <div className="makaron-topbar" style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 50 }}>
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {page === 'home' && user && (
            <button
              onPointerDown={() => warmTopBarRoute('/projects')}
              onFocus={() => warmTopBarRoute('/projects')}
              onClick={() => navigateTopBar('/projects')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex', alignItems: 'center', gap: 5,
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              {locale === 'zh' ? '项目' : 'Projects'}
            </button>
          )}
          {page === 'projects' && (
            <button
              onPointerDown={() => warmTopBarRoute('/home')}
              onFocus={() => warmTopBarRoute('/home')}
              onClick={() => navigateTopBar('/home')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                display: 'flex', alignItems: 'center', gap: 5,
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              {locale === 'zh' ? '探索' : 'Explore'}
            </button>
          )}
          <button
            onClick={() => setShowChangelog(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.45)',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
          >
            {locale === 'zh' ? '更新日志' : "What's new"}
          </button>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && creditBalance !== null && (
            <button
              type="button"
              aria-label={locale === 'zh' ? '打开数据面板' : 'Open dashboard'}
              onPointerDown={() => warmTopBarRoute('/dashboard')}
              onFocus={() => warmTopBarRoute('/dashboard')}
              onClick={() => navigateTopBar('/dashboard')}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                textDecoration: 'none',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={creditBalance < 20 ? '#fbbf24' : '#e879f9'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span style={{
                fontSize: '0.7rem', fontWeight: 600,
                color: creditBalance < 20 ? '#fbbf24' : 'rgba(255,255,255,0.5)',
              }}>
                {creditBalance.toLocaleString()}
              </span>
            </button>
          )}
          {user ? (
            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                onPointerDown={warmTopBarMenuRoutes}
                onFocus={warmTopBarMenuRoutes}
                onClick={() => setUserMenuOpen(v => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: userMenuOpen ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)',
                  transition: 'color 0.2s',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => { if (!userMenuOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {userMenuOpen && (() => {
                const avatarUrl = user.user_metadata?.avatar_url
                const displayName = user.user_metadata?.full_name || user.user_metadata?.name
                const initials = (displayName || user.email || '?')[0].toUpperCase()
                const menuBtnStyle: React.CSSProperties = {
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 16px', background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem',
                  cursor: 'pointer', transition: 'background 0.15s',
                }
                return (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 8,
                    background: 'rgba(24,24,28,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12, padding: '4px 0', minWidth: 200,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100,
	                  }}>
	                    {/* User card header */}
                    <button
                      onPointerDown={() => warmTopBarRoute('/profile')}
                      onFocus={() => warmTopBarRoute('/profile')}
                      onClick={() => navigateTopBar('/profile')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '12px 16px', background: 'none', border: 'none',
                        cursor: 'pointer', transition: 'background 0.15s', borderRadius: '8px 8px 0 0',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                        background: avatarUrl ? 'none' : 'linear-gradient(135deg, #a855f7, #ec4899)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {avatarUrl ? (
                          <img src={getThumbnailUrl(avatarUrl, 72, 80, 72, 'cover')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ color: 'white', fontSize: '0.8rem', fontWeight: 600 }}>{initials}</span>
                        )}
                      </div>
                      <div style={{ overflow: 'hidden', textAlign: 'left' }}>
                        {displayName && (
                          <div style={{ fontSize: '0.78rem', fontWeight: 500, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {displayName}
                          </div>
                        )}
                        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {user.email}
                        </div>
                      </div>
                    </button>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 8px' }} />
                    <button
                      onPointerDown={() => warmTopBarRoute('/dashboard')}
                      onFocus={() => warmTopBarRoute('/dashboard')}
                      onClick={() => navigateTopBar('/dashboard')}
                      style={menuBtnStyle}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {locale === 'zh' ? '数据面板' : 'Dashboard'}
                    </button>
                    <button
                      onPointerDown={() => warmTopBarRoute('/dashboard?tab=keys')}
                      onFocus={() => warmTopBarRoute('/dashboard?tab=keys')}
                      onClick={() => navigateTopBar('/dashboard?tab=keys')}
                      style={menuBtnStyle}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {locale === 'zh' ? '获取 API' : 'Get API'}
                    </button>
                    <button
                      onPointerDown={() => warmTopBarRoute('/skills')}
                      onFocus={() => warmTopBarRoute('/skills')}
                      onClick={() => navigateTopBar('/skills')}
                      style={menuBtnStyle}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      Skills
                    </button>
                    <button
                      onClick={() => { setLocale(locale === 'zh' ? 'en' : 'zh') }}
                      style={menuBtnStyle}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {locale === 'zh' ? 'English' : '中文'}
                    </button>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 8px' }} />
                    <button
                      onClick={() => { setUserMenuOpen(false); signOut() }}
                      style={{ ...menuBtnStyle, color: 'rgba(255,255,255,0.45)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      {locale === 'zh' ? '退出登录' : 'Sign out'}
                    </button>
                  </div>
                )
              })()}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => { setLocale(locale === 'zh' ? 'en' : 'zh') }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.45)',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              >
                {locale === 'zh' ? 'EN' : '中文'}
              </button>
              <button
                onPointerDown={() => warmTopBarRoute('/login')}
                onFocus={() => warmTopBarRoute('/login')}
                onClick={() => navigateTopBar('/login')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.45)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {locale === 'zh' ? '登录' : 'Sign in'}
              </button>
            </div>
          )}
        </div>
      </div>

      {showChangelog && <Changelog onClose={() => setShowChangelog(false)} locale={locale} />}
    </>
  )
}
