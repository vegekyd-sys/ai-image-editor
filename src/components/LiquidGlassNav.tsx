'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/lib/i18n'
import { isMakaronIOSApp } from '@/lib/native-app'
import { warmNativeJSONCache } from '@/lib/native-app-cache'
import { warmHomeSkillsCache } from '@/lib/home-skills-warm'
import { warmProjectsListCache } from '@/lib/projects-list-warm'

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
// Never let motion become a loading screen. Cached routes get the full shared
// element handoff; slower routes yield quickly and continue rendering normally.
const SURFACE_TRANSITION_TIMEOUT_MS = 280
const MANUAL_TRANSITION_DURATION_MS = 520
const SHARED_SURFACE_SELECTORS = [
  '.mkr-surface-brand',
  '.mkr-surface-composer',
  '.mkr-surface-nav',
] as const

type MakaronViewTransition = {
  finished: Promise<void>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => MakaronViewTransition
}

function waitForSurface(surface: PrimarySurface): Promise<void> {
  if (document.querySelector(`[data-makaron-surface="${surface}"]`)) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      window.clearTimeout(timeout)
      resolve()
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(`[data-makaron-surface="${surface}"]`)) finish()
    })
    const timeout = window.setTimeout(finish, SURFACE_TRANSITION_TIMEOUT_MS)
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

async function runManualSurfaceTransition(
  from: PrimarySurface,
  to: PrimarySurface,
  navigate: () => void,
): Promise<void> {
  const root = document.documentElement
  const currentSurface = document.querySelector<HTMLElement>(`[data-makaron-surface="${from}"]`)
  const ghosts = SHARED_SURFACE_SELECTORS.flatMap((selector) => {
    const source = document.querySelector<HTMLElement>(selector)
    if (!source) return []
    const rect = source.getBoundingClientRect()
    const ghost = source.cloneNode(true) as HTMLElement
    ghost.classList.add('mkr-surface-transition-ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.setAttribute('inert', '')
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      transform: 'none',
      transformOrigin: 'top left',
      pointerEvents: 'none',
      zIndex: '2147483200',
    })
    document.body.appendChild(ghost)
    source.classList.add('mkr-surface-shared-hidden')
    return [{ selector, ghost, fromRect: rect }]
  })

  root.dataset.makaronSurfaceFrom = from
  root.dataset.makaronSurfaceTo = to
  root.dataset.makaronSurfaceTransition = 'manual'
  currentSurface?.setAttribute('data-makaron-transition-phase', 'leaving')

  navigate()
  await waitForSurface(to)
  await nextFrame()

  const nextSurface = document.querySelector<HTMLElement>(`[data-makaron-surface="${to}"]`)
  nextSurface?.setAttribute('data-makaron-transition-phase', 'arriving')
  const destinationElements: HTMLElement[] = []
  const animations = ghosts.map(({ selector, ghost, fromRect }) => {
    const destination = document.querySelector<HTMLElement>(selector)
    if (!destination) {
      return ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 180,
        easing: 'ease-out',
        fill: 'forwards',
      }).finished.catch(() => undefined)
    }

    destination.classList.add('mkr-surface-shared-hidden')
    destinationElements.push(destination)
    const toRect = destination.getBoundingClientRect()
    const scaleX = fromRect.width > 0 ? toRect.width / fromRect.width : 1
    const scaleY = fromRect.height > 0 ? toRect.height / fromRect.height : 1
    return ghost.animate([
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1, 1)', filter: 'brightness(1)' },
      { opacity: 1, offset: 0.72, filter: 'brightness(1.16) drop-shadow(0 0 10px rgba(232,121,249,0.24))' },
      {
        opacity: 1,
        transform: `translate3d(${toRect.left - fromRect.left}px, ${toRect.top - fromRect.top}px, 0) scale(${scaleX}, ${scaleY})`,
        filter: 'brightness(1)',
      },
    ], {
      duration: MANUAL_TRANSITION_DURATION_MS,
      easing: 'cubic-bezier(0.2, 0.86, 0.2, 1)',
      fill: 'forwards',
    }).finished.catch(() => undefined)
  })

  await Promise.all(animations)
  ghosts.forEach(({ ghost, selector }) => {
    ghost.remove()
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      element.classList.remove('mkr-surface-shared-hidden')
    })
  })
  destinationElements.forEach((element) => element.classList.remove('mkr-surface-shared-hidden'))
  nextSurface?.removeAttribute('data-makaron-transition-phase')
  delete root.dataset.makaronSurfaceFrom
  delete root.dataset.makaronSurfaceTo
  delete root.dataset.makaronSurfaceTransition
}

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
  const { locale } = useLocale()
  const [visualActive, setVisualActive] = useState(active)

  useEffect(() => {
    setVisualActive(active)
  }, [active])

  const navItems = items ?? (
    locale === 'zh'
      ? [
          { value: 'explore' as const, label: '探索' },
          { value: 'projects' as const, label: '项目' },
        ]
      : [
          { value: 'explore' as const, label: 'Explore' },
          { value: 'projects' as const, label: 'Projects' },
        ]
  )
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
    const fromSurface: PrimarySurface = active === 'projects' ? 'projects' : 'explore'
    if (surface === 'explore' && typeof window !== 'undefined' && isMakaronIOSApp()) {
      try {
        sessionStorage.setItem(IOS_RESET_HOME_SCROLL_KEY, '1')
      } catch {
        // Best-effort scroll reset for the native shell.
      }
    }
    warmRoute(surface)
    setVisualActive(surface)
    if (typeof window === 'undefined') {
      router.push(path)
      return
    }

    const doc = document as ViewTransitionDocument
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      window.requestAnimationFrame(() => router.push(path))
      return
    }

    if (!doc.startViewTransition) {
      window.requestAnimationFrame(() => {
        void runManualSurfaceTransition(fromSurface, surface, () => router.push(path))
      })
      return
    }

    const root = document.documentElement
    root.dataset.makaronSurfaceFrom = fromSurface
    root.dataset.makaronSurfaceTo = surface
    root.dataset.makaronSurfaceTransition = 'native'

    window.requestAnimationFrame(() => {
      const transition = doc.startViewTransition?.(async () => {
        router.push(path)
        await waitForSurface(surface)
      })
      transition?.finished.finally(() => {
        delete root.dataset.makaronSurfaceFrom
        delete root.dataset.makaronSurfaceTo
        delete root.dataset.makaronSurfaceTransition
      })
    })
  }, [active, onChange, pathFor, router, warmRoute])

  if (requireAuth && !user) return null

  return (
    <nav
      aria-label={ariaLabel ?? (locale === 'zh' ? '主导航' : 'Primary navigation')}
      className="mkr-liquid-nav mkr-surface-nav"
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
          const isRouteItem = item.value === 'explore' || item.value === 'projects'
          const isActive = visualActive === item.value
          return (
            <button
              key={item.value}
              type="button"
              aria-current={isRouteItem && active === item.value ? 'page' : undefined}
              aria-pressed={!isRouteItem ? isActive : undefined}
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
