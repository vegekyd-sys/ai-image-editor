'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
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
const LIQUID_FILTER_ID = 'makaron-liquid-glass-nav-refraction'
const LENS_FILTER_ID = 'makaron-liquid-glass-nav-lens'

const shellStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5px)',
  transform: 'translateX(-50%)',
  zIndex: 210,
  padding: 4,
  borderRadius: 999,
  border: '0.5px solid rgba(255,255,255,0.11)',
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.062) 0%, rgba(88,92,104,0.105) 34%, rgba(8,9,12,0.23) 100%)',
  boxShadow:
    'inset 0 0.5px 0 rgba(255,255,255,0.34), inset 0 -0.5px 0 rgba(0,0,0,0.34), inset 0 -14px 22px rgba(0,0,0,0.15), 0 14px 34px rgba(0,0,0,0.42)',
  backdropFilter: 'blur(28px) saturate(165%) contrast(106%) brightness(1.035)',
  WebkitBackdropFilter: 'blur(28px) saturate(165%) contrast(106%) brightness(1.035)',
  overflow: 'hidden',
  clipPath: 'inset(0 round 999px)',
  isolation: 'isolate',
  touchAction: 'manipulation',
}

const svgStyle: CSSProperties = {
  position: 'absolute',
  width: 0,
  height: 0,
  pointerEvents: 'none',
}

const refractionStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 999,
  pointerEvents: 'none',
  opacity: 0.14,
  background:
    'radial-gradient(circle at 15% 0%, rgba(255,255,255,0.055), transparent 38%), radial-gradient(circle at 92% 100%, rgba(236,72,153,0.032), transparent 36%)',
  backdropFilter: `url(#${LIQUID_FILTER_ID}) blur(10px) saturate(135%) contrast(102%)`,
  WebkitBackdropFilter: `url(#${LIQUID_FILTER_ID}) blur(10px) saturate(135%) contrast(102%)`,
}

const highlightStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background:
    'radial-gradient(circle at 18% -16%, rgba(255,255,255,0.30), rgba(255,255,255,0.065) 20%, transparent 45%), linear-gradient(112deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.022) 26%, transparent 46%, rgba(236,72,153,0.04) 72%, rgba(34,211,238,0.034) 100%)',
  mixBlendMode: 'screen',
  opacity: 0.46,
}

const edgeStyle: CSSProperties = {
  position: 'absolute',
  inset: 1,
  borderRadius: 999,
  pointerEvents: 'none',
  boxShadow:
    'inset 0 0 0 0.5px rgba(255,255,255,0.065), inset 0 8px 16px rgba(255,255,255,0.04), inset 1px 0 0 rgba(56,189,248,0.038), inset -1px 0 0 rgba(236,72,153,0.04), inset 0 -10px 18px rgba(0,0,0,0.18)',
}

const activeLensStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 999,
  pointerEvents: 'none',
  background:
    'radial-gradient(circle at 30% 0%, rgba(255,255,255,0.18), transparent 46%), linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.045) 38%, rgba(255,255,255,0.016) 62%, rgba(0,0,0,0.08) 100%)',
  mixBlendMode: 'screen',
  opacity: 0.42,
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
    window.requestAnimationFrame(() => router.push(path))
  }, [active, onChange, pathFor, router, warmRoute])

  if (requireAuth && !user) return null

  const buttonStyle = (isActive: boolean): CSSProperties => ({
    position: 'relative',
    zIndex: 2,
    minWidth: 92,
    height: 34,
    border: 0,
    borderRadius: 999,
    background: 'transparent',
    color: isActive ? 'rgba(255,255,255,0.94)' : 'rgba(255,255,255,0.54)',
    boxShadow: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 760,
    letterSpacing: 0,
    cursor: 'pointer',
    transition: 'color 180ms ease, transform 160ms ease',
    fontFamily: 'inherit',
    WebkitTapHighlightColor: 'transparent',
  })

  return (
    <nav
      aria-label={ariaLabel ?? (locale === 'zh' ? '主导航' : 'Primary navigation')}
      style={{
        ...shellStyle,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 180ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        transform: hidden ? 'translateX(-50%) translateY(14px) scale(0.98)' : 'translateX(-50%)',
      }}
      onPointerEnter={() => {
        if (!onChange) warmRoute(active === 'explore' ? 'projects' : 'explore')
      }}
    >
      <svg aria-hidden="true" focusable="false" style={svgStyle}>
        <filter id={LIQUID_FILTER_ID} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.024" numOctaves="1" seed="11" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1.15" result="softNoise" />
          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="4" xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feColorMatrix in="displaced" type="saturate" values="1.08" />
        </filter>
        <filter id={LENS_FILTER_ID} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.034" numOctaves="1" seed="17" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="0.85" result="softNoise" />
          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="3" xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feColorMatrix in="displaced" type="saturate" values="1.08" />
        </filter>
      </svg>
      <div style={refractionStyle} />
      <div style={highlightStyle} />
      <div style={edgeStyle} />
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${navItems.length}, 1fr)`,
      }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${100 / navItems.length}%`,
            borderRadius: 999,
            border: '0.5px solid rgba(255,255,255,0.09)',
            background:
              'radial-gradient(circle at 28% 4%, rgba(255,255,255,0.16), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(82,86,100,0.10) 44%, rgba(14,15,20,0.18))',
            boxShadow:
              'inset 0 0.5px 0 rgba(255,255,255,0.25), inset 0 -0.5px 0 rgba(0,0,0,0.28), inset 1px 0 0 rgba(56,189,248,0.032), inset -1px 0 0 rgba(236,72,153,0.032), inset 0 -8px 14px rgba(0,0,0,0.13), 0 6px 16px rgba(0,0,0,0.24)',
            transform: `translateX(${activeIndex * 100}%)`,
            transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'transform',
            backdropFilter: `url(#${LENS_FILTER_ID}) blur(10px) saturate(145%) brightness(1.035)`,
            WebkitBackdropFilter: `url(#${LENS_FILTER_ID}) blur(10px) saturate(145%) brightness(1.035)`,
            overflow: 'hidden',
          }}
        >
          <div style={activeLensStyle} />
        </div>
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
              style={buttonStyle(isActive)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
