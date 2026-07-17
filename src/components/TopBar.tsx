'use client'

import { useCallback, useEffect, useState, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useAuth } from '@/hooks/useAuth'
import { LocaleToggle, useLocale } from '@/lib/i18n'
import { getThumbnailUrl } from '@/lib/supabase/storage'
import { readNativeJSONCache, warmNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache'
import { isMakaronIOSApp } from '@/lib/native-app'
import { warmProjectsListCache } from '@/lib/projects-list-warm'
import { requestNativePageStackPush } from '@/lib/native-page-stack'

const Changelog = dynamic(() => import('@/components/Changelog'), { ssr: false })

interface TopBarProps {
  page: 'home' | 'projects'
  authReturnPath?: string | null
}

interface CreditsPayload {
  balance?: number
}

const IOS_LAST_PRIMARY_ROUTE_KEY = 'makaron:ios-last-primary-route'
const IOS_RESET_HOME_SCROLL_KEY = 'makaron:ios-reset-home-scroll'
const ACCOUNT_EDGE_SWIPE_WIDTH = 30
const ACCOUNT_EDGE_SWIPE_OPEN_DISTANCE = 44
const ACCOUNT_EDGE_SWIPE_MAX_VERTICAL_DRIFT = 42

const TOPBAR_ROUTE_WARM_APIS: Record<string, string[]> = {
  '/home': ['/api/home-skills', '/api/skills'],
  '/projects': ['/api/skills', '/api/billing/credits'],
  '/dashboard': ['/api/billing/dashboard', '/api/billing/credits'],
  '/profile': ['/api/billing/credits'],
  '/skills': ['/api/skills'],
}

function isPrimaryTopBarRoute(path: string): boolean {
  return path === '/home' || path === '/projects'
}

const accountMenuGlassLayerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  borderRadius: 'inherit',
  background:
    'radial-gradient(circle at 18% -8%, rgba(255,255,255,0.18), rgba(255,255,255,0.045) 24%, transparent 52%), linear-gradient(126deg, rgba(255,255,255,0.058), rgba(255,255,255,0.014) 36%, rgba(236,72,153,0.028) 74%, rgba(34,211,238,0.022))',
  mixBlendMode: 'screen',
  opacity: 0.66,
}

const accountMenuEdgeStyle: CSSProperties = {
  position: 'absolute',
  inset: 1,
  borderRadius: 'inherit',
  pointerEvents: 'none',
  boxShadow:
    'inset 0 0 0 0.5px rgba(255,255,255,0.045), inset 0 10px 18px rgba(255,255,255,0.032), inset 0 -0.5px 0 rgba(0,0,0,0.34), inset 1px 0 0 rgba(56,189,248,0.032), inset -1px 0 0 rgba(236,72,153,0.034)',
}

const desktopAccountMenuStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 8,
  minWidth: 208,
  padding: 5,
  borderRadius: 22,
  border: '0.5px solid rgba(255,255,255,0.10)',
  background:
    'linear-gradient(180deg, rgba(46,47,56,0.68), rgba(17,18,24,0.75) 48%, rgba(7,8,11,0.86))',
  boxShadow:
    '0 24px 64px rgba(0,0,0,0.50), inset 0 0.5px 0 rgba(255,255,255,0.14), inset 0 -16px 30px rgba(0,0,0,0.22)',
  backdropFilter: 'blur(32px) saturate(158%) contrast(106%)',
  WebkitBackdropFilter: 'blur(32px) saturate(158%) contrast(106%)',
  zIndex: 240,
  overflow: 'hidden',
  isolation: 'isolate',
}

const mobileAccountOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483200,
  display: 'none',
}

const mobileAccountBackdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: 0,
  padding: 0,
  background: 'rgba(0,0,0,0.48)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  cursor: 'pointer',
}

const mobileAccountPanelStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  height: '100dvh',
  width: 'min(84vw, 382px)',
  padding: 'calc(env(safe-area-inset-top, 0px) + 18px) 16px calc(env(safe-area-inset-bottom, 0px) + 18px)',
  borderRadius: '22px 0 0 22px',
  border: '0.5px solid rgba(255,255,255,0.11)',
  borderRight: 0,
  background:
    'linear-gradient(180deg, rgba(46,47,56,0.70), rgba(17,18,24,0.78) 48%, rgba(7,8,11,0.88))',
  boxShadow:
    '-26px 0 60px rgba(0,0,0,0.46), inset 0 0.5px 0 rgba(255,255,255,0.14), inset 18px 0 34px rgba(255,255,255,0.020), inset 0 -22px 34px rgba(0,0,0,0.24)',
  backdropFilter: 'blur(32px) saturate(158%) contrast(106%)',
  WebkitBackdropFilter: 'blur(32px) saturate(158%) contrast(106%)',
  overflow: 'hidden',
  isolation: 'isolate',
  animation: 'makaron-account-drawer-in 260ms cubic-bezier(0.22, 1, 0.36, 1)',
}

const accountSeparatorStyle: CSSProperties = {
  height: 1,
  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
  margin: '5px 6px',
}

function AccountGlassLayers() {
  return (
    <>
      <div style={accountMenuGlassLayerStyle} />
      <div style={accountMenuEdgeStyle} />
    </>
  )
}

export default function TopBar({ authReturnPath }: TopBarProps) {
  const { user, signOut } = useAuth()
  const { locale, t } = useLocale()
  const router = useRouter()

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const accountEdgeSwipeRef = useRef<{ tracking: boolean; startX: number; startY: number; consumed: boolean }>({
    tracking: false,
    startX: 0,
    startY: 0,
    consumed: false,
  })
  const [creditBalance, setCreditBalance] = useState<number | null>(() => {
    const cached = readNativeJSONCache<CreditsPayload>('/api/billing/credits')
    return cached?.balance ?? null
  })
  const [showChangelog, setShowChangelog] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

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

  const scheduleTopBarWarm = useCallback((path: string) => {
    const warm = () => warmTopBarRoute(path)
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(warm, { timeout: 1600 })
      return
    }
    window.setTimeout(warm, 240)
  }, [warmTopBarRoute])

  const navigateTopBar = useCallback((path: string) => {
    setUserMenuOpen(false)
    const inIOSApp = isMakaronIOSApp()
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
    if (path === '/login' && authReturnPath) {
      try {
        localStorage.setItem('mkr_return_url', authReturnPath)
        sessionStorage.setItem('mkr_return_url', authReturnPath)
      } catch {
        // Return URL persistence is best-effort; login still works without it.
      }
    }
    if (inIOSApp && isPrimaryTopBarRoute(currentPath)) {
      try {
        sessionStorage.setItem(IOS_LAST_PRIMARY_ROUTE_KEY, currentPath)
      } catch {
        // Best-effort visual backdrop for native-like secondary page back.
      }
    }
    if (inIOSApp && currentPath === '/projects' && path === '/home') {
      try {
        sessionStorage.setItem(IOS_RESET_HOME_SCROLL_KEY, '1')
      } catch {
        // Best-effort only.
      }
    }
    if (!isPrimaryTopBarRoute(path)) {
      if (inIOSApp) {
        requestNativePageStackPush(path)
      }
      router.push(path)
      if (inIOSApp) {
        window.setTimeout(() => {
          window.dispatchEvent(new Event('makaron-ios-warm-page-backdrop'))
        }, 320)
      }
    } else {
      router.push(path)
    }
    scheduleTopBarWarm(path)
  }, [authReturnPath, router, scheduleTopBarWarm])

  const warmTopBarMenuRoutes = useCallback(() => {
    const warm = () => {
      ['/profile', '/dashboard', '/dashboard?tab=keys', '/skills'].forEach(warmTopBarRoute)
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(warm, { timeout: 1600 })
      return
    }
    window.setTimeout(warm, 240)
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
    const refresh = () => fetch('/api/billing/credits').then(r => {
      if (!r.ok) throw new Error('Failed to load credits')
      return r.json()
    }).then(d => {
      writeNativeJSONCache('/api/billing/credits', d)
      setCreditBalance(d.balance ?? 0)
    }).catch(() => setCreditBalance(0))
    refresh()
    window.addEventListener('credits-updated', refresh)
    return () => window.removeEventListener('credits-updated', refresh)
  }, [user])

  useEffect(() => {
    if (!userMenuOpen) return
    warmTopBarMenuRoutes()
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (target instanceof Element && target.closest('[data-makaron-locale-popover]')) return
      if (userMenuRef.current?.contains(target)) return
      if (mobileMenuRef.current?.contains(target)) return
      setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen, warmTopBarMenuRoutes])

  useEffect(() => {
    if (!userMenuOpen) return
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    window.addEventListener('keydown', keyHandler)

    const shouldLockScroll = window.matchMedia('(max-width: 767px)').matches
    const previousOverflow = document.body.style.overflow
    if (shouldLockScroll) {
      document.body.style.overflow = 'hidden'
    }

    return () => {
      window.removeEventListener('keydown', keyHandler)
      if (shouldLockScroll) {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [userMenuOpen])

  useEffect(() => {
    if (!user || userMenuOpen) return

    const isMobileViewport = () => window.matchMedia('(max-width: 767px)').matches
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false
      return !!target.closest('input, textarea, select, [contenteditable="true"]')
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (!isMobileViewport() || isEditableTarget(e.target)) return
      const touch = e.touches[0]
      if (!touch) return
      const fromRightEdge = touch.clientX >= window.innerWidth - ACCOUNT_EDGE_SWIPE_WIDTH
      if (fromRightEdge) {
        e.preventDefault()
        e.stopPropagation()
      }
      accountEdgeSwipeRef.current = {
        tracking: fromRightEdge,
        startX: touch.clientX,
        startY: touch.clientY,
        consumed: fromRightEdge,
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      const state = accountEdgeSwipeRef.current
      if (!state.tracking) return
      const touch = e.touches[0]
      if (!touch) return
      e.preventDefault()
      e.stopPropagation()
      const deltaX = touch.clientX - state.startX
      const deltaY = touch.clientY - state.startY
      if (Math.abs(deltaY) > ACCOUNT_EDGE_SWIPE_MAX_VERTICAL_DRIFT) {
        accountEdgeSwipeRef.current.tracking = false
        return
      }
      if (deltaX <= -ACCOUNT_EDGE_SWIPE_OPEN_DISTANCE) {
        accountEdgeSwipeRef.current.tracking = false
        setUserMenuOpen(true)
        window.dispatchEvent(new Event('makaron-account-menu-edge-open'))
      }
    }

    const clearTracking = (e: TouchEvent) => {
      if (accountEdgeSwipeRef.current.consumed) {
        e.preventDefault()
        e.stopPropagation()
      }
      accountEdgeSwipeRef.current.tracking = false
      accountEdgeSwipeRef.current.consumed = false
    }

    const captureOptions: AddEventListenerOptions = { passive: false, capture: true }
    window.addEventListener('touchstart', handleTouchStart, captureOptions)
    window.addEventListener('touchmove', handleTouchMove, captureOptions)
    window.addEventListener('touchend', clearTracking, captureOptions)
    window.addEventListener('touchcancel', clearTracking, captureOptions)

    return () => {
      window.removeEventListener('touchstart', handleTouchStart, true)
      window.removeEventListener('touchmove', handleTouchMove, true)
      window.removeEventListener('touchend', clearTracking, true)
      window.removeEventListener('touchcancel', clearTracking, true)
    }
  }, [user, userMenuOpen])

  const visibleUser = hasMounted ? user : null

  return (
    <>
      <div className="makaron-topbar" style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: userMenuOpen ? 360 : 140 }}>
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setShowChangelog(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.45)',
              transition: 'color 0.2s',
              display: 'flex', alignItems: 'center', gap: 5,
              minHeight: 44,
              padding: '0 2px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v3" />
              <path d="M12 18v3" />
              <path d="M3 12h3" />
              <path d="M18 12h3" />
              <path d="m6.4 6.4 2.1 2.1" />
              <path d="m15.5 15.5 2.1 2.1" />
              <path d="m17.6 6.4-2.1 2.1" />
              <path d="m8.5 15.5-2.1 2.1" />
            </svg>
            {t('nav.updates')}
          </button>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {visibleUser && creditBalance !== null && (
            <button
              type="button"
              aria-label={t('nav.openDashboard')}
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
          {visibleUser ? (
            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                aria-label={t('nav.openAccountMenu')}
                aria-expanded={userMenuOpen}
                aria-controls="makaron-account-menu makaron-account-menu-mobile"
                data-makaron-user-menu-trigger="true"
                onClick={() => setUserMenuOpen(v => !v)}
                style={{
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: 'transparent',
                  border: '0',
                  boxShadow: 'none',
                  outline: 'none',
                  borderRadius: 0,
                  cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: userMenuOpen ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)',
                  transition: 'color 0.2s',
                  display: 'flex', alignItems: 'center', gap: 4,
                  minWidth: 44,
                  minHeight: 44,
                  padding: '0 12px',
                  justifyContent: 'center',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => { if (!userMenuOpen) e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <svg className="makaron-account-trigger-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {userMenuOpen && (() => {
                const avatarUrl = visibleUser.user_metadata?.avatar_url
                const displayName = visibleUser.user_metadata?.full_name || visibleUser.user_metadata?.name
                const initials = ((displayName || visibleUser.email || '?').trim()[0] || '?').toUpperCase()
                const email = visibleUser.email || ''
                const desktopMenuBtnStyle: CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 10,
                  color: 'rgba(255,255,255,0.68)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }
                const mobileMenuBtnStyle: CSSProperties = {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  width: '100%',
                  minHeight: 50,
                  textAlign: 'left',
                  padding: '0 14px',
                  background: 'rgba(255,255,255,0.035)',
                  border: '0.5px solid rgba(255,255,255,0.055)',
                  borderRadius: 16,
                  color: 'rgba(255,255,255,0.78)',
                  fontSize: '0.88rem',
                  fontWeight: 540,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }
                const signOutButtonStyle: CSSProperties = {
                  ...mobileMenuBtnStyle,
                  color: 'rgba(255,255,255,0.52)',
                  background: 'rgba(255,255,255,0.026)',
                }
                const onDesktopItemEnter = (e: ReactMouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.055)'
                  e.currentTarget.style.color = 'rgba(255,255,255,0.88)'
                }
                const onDesktopItemLeave = (e: ReactMouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'rgba(255,255,255,0.68)'
                }
                const avatarNode = (size: number) => (
                  <div style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    flexShrink: 0,
                    background: avatarUrl
                      ? 'rgba(255,255,255,0.06)'
                      : 'linear-gradient(135deg, rgba(168,85,247,0.92), rgba(236,72,153,0.92))',
                    border: '0.5px solid rgba(255,255,255,0.16)',
                    boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.18), 0 8px 18px rgba(0,0,0,0.22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {avatarUrl ? (
                      <img src={getThumbnailUrl(avatarUrl, size * 2, 80, size * 2, 'cover')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ color: 'white', fontSize: size > 40 ? '1.05rem' : '0.8rem', fontWeight: 700 }}>{initials}</span>
                    )}
                  </div>
                )
                return (
                  <>
                    <div id="makaron-account-menu" className="makaron-account-menu-desktop" style={desktopAccountMenuStyle}>
                      <AccountGlassLayers />
                      <div style={{ position: 'relative', zIndex: 1 }}>
                        <button
                          onClick={() => navigateTopBar('/profile')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            width: '100%',
                            padding: '11px 12px',
                            background: 'rgba(255,255,255,0.022)',
                            border: '0.5px solid rgba(255,255,255,0.045)',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                            borderRadius: 12,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.022)')}
                        >
                          {avatarNode(36)}
                          <div style={{ overflow: 'hidden', textAlign: 'left', minWidth: 0 }}>
                            {displayName && (
                              <div style={{ fontSize: '0.78rem', fontWeight: 560, color: 'rgba(255,255,255,0.88)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {displayName}
                              </div>
                            )}
                            <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.42)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {email}
                            </div>
                          </div>
                        </button>
                        <div style={accountSeparatorStyle} />
                        <button onClick={() => navigateTopBar('/dashboard')} style={desktopMenuBtnStyle} onMouseEnter={onDesktopItemEnter} onMouseLeave={onDesktopItemLeave}>
                          <span>{t('nav.dashboard')}</span>
                        </button>
                        <button onClick={() => navigateTopBar('/dashboard?tab=keys')} style={desktopMenuBtnStyle} onMouseEnter={onDesktopItemEnter} onMouseLeave={onDesktopItemLeave}>
                          <span>{t('nav.getApi')}</span>
                        </button>
                        <button onClick={() => navigateTopBar('/skills')} style={desktopMenuBtnStyle} onMouseEnter={onDesktopItemEnter} onMouseLeave={onDesktopItemLeave}>
                          <span>Skills</span>
                        </button>
                        <LocaleToggle variant="menu" style={{ ...desktopMenuBtnStyle, minHeight: 38 }} />
                        <div style={accountSeparatorStyle} />
                        <button
                          onClick={() => { setUserMenuOpen(false); signOut() }}
                          style={{ ...desktopMenuBtnStyle, color: 'rgba(255,255,255,0.45)' }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                            e.currentTarget.style.color = 'rgba(255,255,255,0.68)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.color = 'rgba(255,255,255,0.45)'
                          }}
                        >
                          <span>{t('nav.signOut')}</span>
                        </button>
                      </div>
                    </div>

                    {hasMounted && createPortal((
                      <div ref={mobileMenuRef} className="makaron-account-menu-mobile" style={mobileAccountOverlayStyle}>
                        <button
                          type="button"
                          aria-label={t('nav.closeAccountMenu')}
                          onMouseDown={() => setUserMenuOpen(false)}
                          style={mobileAccountBackdropStyle}
                        />
                        <aside
                          id="makaron-account-menu-mobile"
                          role="dialog"
                          aria-modal="true"
                          aria-label={t('nav.accountMenu')}
                          style={mobileAccountPanelStyle}
                        >
                          <AccountGlassLayers />
                          <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
                              <div style={{ fontSize: '0.74rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', fontWeight: 700 }}>
                                {t('nav.account')}
                              </div>
                              <button
                                type="button"
                                aria-label={t('nav.closeAccountMenu')}
                                onClick={() => setUserMenuOpen(false)}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: '50%',
                                  border: '0.5px solid rgba(255,255,255,0.08)',
                                  background: 'rgba(255,255,255,0.04)',
                                  color: 'rgba(255,255,255,0.66)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  WebkitTapHighlightColor: 'transparent',
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>

                            <button
                              onClick={() => navigateTopBar('/profile')}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 13,
                                width: '100%',
                                padding: 14,
                                marginBottom: 14,
                                borderRadius: 20,
                                border: '0.5px solid rgba(255,255,255,0.075)',
                                background:
                                  'linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.024))',
                                color: 'inherit',
                                cursor: 'pointer',
                                boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.12)',
                                WebkitTapHighlightColor: 'transparent',
                              }}
                            >
                              {avatarNode(48)}
                              <div style={{ minWidth: 0, textAlign: 'left' }}>
                                <div style={{ fontSize: '0.98rem', fontWeight: 650, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {displayName || t('nav.profile')}
                                </div>
                                <div style={{ marginTop: 3, fontSize: '0.76rem', color: 'rgba(255,255,255,0.46)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {email}
                                </div>
                                {creditBalance !== null && (
                                  <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.045)', color: creditBalance < 20 ? '#fbbf24' : 'rgba(255,255,255,0.58)', fontSize: '0.68rem', fontWeight: 700 }}>
                                    <span>{creditBalance.toLocaleString()}</span>
                                    <span style={{ color: 'rgba(255,255,255,0.32)', fontWeight: 600 }}>credits</span>
                                  </div>
                                )}
                              </div>
                            </button>

                            <nav aria-label={t('nav.accountNavigation')} style={{ display: 'grid', gap: 10 }}>
                              <button onClick={() => navigateTopBar('/dashboard')} style={mobileMenuBtnStyle}>
                                <span>{t('nav.dashboard')}</span>
                              </button>
                              <button onClick={() => navigateTopBar('/dashboard?tab=keys')} style={mobileMenuBtnStyle}>
                                <span>{t('nav.getApi')}</span>
                              </button>
                              <button onClick={() => navigateTopBar('/skills')} style={mobileMenuBtnStyle}>
                                <span>Skills</span>
                              </button>
                              <LocaleToggle variant="menu" style={{ ...mobileMenuBtnStyle, minHeight: 50 }} />
                            </nav>

                            <div style={{ marginTop: 'auto', paddingTop: 18 }}>
                              <button onClick={() => { setUserMenuOpen(false); signOut() }} style={signOutButtonStyle}>
                                <span>{t('nav.signOut')}</span>
                              </button>
                            </div>
                          </div>
                        </aside>
                      </div>
                    ), document.body)}
                  </>
                )
              })()}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <LocaleToggle />
              <a
                href="/login"
                onClick={() => {
                  if (!authReturnPath) return
                  try {
                    localStorage.setItem('mkr_return_url', authReturnPath)
                    sessionStorage.setItem('mkr_return_url', authReturnPath)
                  } catch {
                    // Native navigation remains usable even if storage is blocked.
                  }
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.45)',
                  display: 'flex', alignItems: 'center', gap: 5,
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {t('nav.signIn')}
              </a>
            </div>
          )}
        </div>
      </div>

      {showChangelog && <Changelog onClose={() => setShowChangelog(false)} locale={locale} />}
    </>
  )
}
