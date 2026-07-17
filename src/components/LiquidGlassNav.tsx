'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/lib/i18n'
import { isMakaronIOSApp } from '@/lib/native-app'
import { warmNativeJSONCache } from '@/lib/native-app-cache'
import { warmHomeSkillsCache } from '@/lib/home-skills-warm'
import { warmProjectsListCache } from '@/lib/projects-list-warm'
import { useHydrated } from '@/hooks/useHydrated'

type PrimarySurface = 'explore' | 'projects'
export type LiquidGlassNavValue = PrimarySurface | 'human' | 'agent'

interface LiquidGlassNavItem {
  value: LiquidGlassNavValue
  label: string
}

interface LiquidGlassNavProps {
  active: LiquidGlassNavValue
  hidden?: boolean
  items?: LiquidGlassNavItem[]
  onChange?: (value: LiquidGlassNavValue) => void
  requireAuth?: boolean
  ariaLabel?: string
}

const IOS_RESET_HOME_SCROLL_KEY = 'makaron:ios-reset-home-scroll'

export default function LiquidGlassNav({
  active,
  hidden = false,
  items,
  onChange,
  requireAuth = true,
  ariaLabel,
}: LiquidGlassNavProps) {
  const router = useRouter()
  const { user } = useAuth()
  const hydrated = useHydrated()
  const { t } = useLocale()
  const [visualActive, setVisualActive] = useState(active)

  useEffect(() => {
    setVisualActive(active)
  }, [active])

  const navItems = items ?? [
    { value: 'explore' as const, label: t('nav.explore') },
    { value: 'projects' as const, label: t('nav.projects') },
  ]
  const activeIndex = Math.max(0, navItems.findIndex((item) => item.value === visualActive))

  const pathFor = useCallback((surface: PrimarySurface) => (
    surface === 'explore' ? '/home' : '/projects'
  ), [])

  const warmRoute = useCallback((surface: LiquidGlassNavValue) => {
    if (surface !== 'explore' && surface !== 'projects') return
    const path = pathFor(surface)
    try {
      router.prefetch(path)
    } catch {
      // Prefetch is opportunistic; tap navigation should never depend on it.
    }
    if (surface === 'explore') void warmHomeSkillsCache()
    if (surface === 'projects' && user?.id) void warmProjectsListCache(user.id)
    if (!isMakaronIOSApp()) return
    if (surface === 'explore') {
      void warmNativeJSONCache('/api/home-skills')
      void warmNativeJSONCache('/api/skills')
      return
    }
    void warmNativeJSONCache('/api/skills')
    void warmNativeJSONCache('/api/billing/credits')
  }, [pathFor, router, user?.id])

  useEffect(() => {
    if (!user) return
    warmRoute('explore')
    warmRoute('projects')
  }, [user, warmRoute])

  const navigate = useCallback((surface: LiquidGlassNavValue) => {
    if (surface === active) return
    if (surface !== 'explore' && surface !== 'projects') {
      warmRoute(surface)
      setVisualActive(surface)
      onChange?.(surface)
      return
    }
    const path = pathFor(surface)
    if (surface === 'explore' && typeof window !== 'undefined' && isMakaronIOSApp()) {
      try {
        sessionStorage.setItem(IOS_RESET_HOME_SCROLL_KEY, '1')
      } catch {
        // Best-effort scroll reset for the native shell.
      }
    }
    warmRoute(surface)
    setVisualActive(surface)
    router.push(path)
  }, [active, onChange, pathFor, router, warmRoute])

  const handleRouteClick = useCallback((
    event: MouseEvent<HTMLAnchorElement>,
    surface: PrimarySurface,
  ) => {
    // Keep the real href as the pre-hydration fallback. Once React is ready,
    // preserve the in-memory media caches with client-side navigation while
    // leaving modifier/middle clicks to the browser.
    if (
      !hydrated
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return

    event.preventDefault()
    navigate(surface)
  }, [hydrated, navigate])

  if (requireAuth && (!hydrated || !user)) return null

  return (
    <nav
      aria-label={ariaLabel ?? t('nav.primary')}
      className="mkr-liquid-nav"
      style={{
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transform: hidden ? 'translateX(-50%) translateY(14px) scale(0.98)' : 'translateX(-50%)',
        touchAction: 'manipulation',
      }}
      onPointerEnter={() => {
        if (!onChange) warmRoute(active === 'explore' ? 'projects' : 'explore')
      }}
    >
      <div
        className="mkr-liquid-nav-track"
        style={{ gridTemplateColumns: `repeat(${navItems.length}, 1fr)` }}
      >
        <div
          aria-hidden="true"
          className="mkr-liquid-nav-indicator"
          style={{
            width: `${100 / navItems.length}%`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {navItems.map((item) => {
          const isActive = visualActive === item.value
          if (item.value === 'explore' || item.value === 'projects') {
            const surface: PrimarySurface = item.value
            const href = pathFor(surface)
            return (
              <a
                key={item.value}
                href={href}
                aria-current={active === item.value ? 'page' : undefined}
                onClick={(event) => handleRouteClick(event, surface)}
                onPointerEnter={() => warmRoute(item.value)}
                onTouchStart={() => warmRoute(item.value)}
                onFocus={() => warmRoute(item.value)}
                className="mkr-liquid-nav-button"
                data-active={isActive ? 'true' : 'false'}
              >
                {item.label}
              </a>
            )
          }
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => navigate(item.value)}
              onPointerEnter={() => warmRoute(item.value)}
              onTouchStart={() => warmRoute(item.value)}
              onFocus={() => warmRoute(item.value)}
              className="mkr-liquid-nav-button"
              data-active={isActive ? 'true' : 'false'}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
