'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { isHeicFile } from '@/lib/imageUtils'
import { useLocale } from '@/lib/i18n'
import { compressCreateImageFile, createProject, createProjectFromStagedMedia } from '@/lib/createProject'
import { createClient } from '@/lib/supabase/client'
import { cacheCreateDraft, cacheMediaUrl, clearCreateDraft, getCachedMediaObjectUrl, getCreateDraft, mediaCacheKeyForUrl } from '@/lib/imageCache'
import { extractPhotoMetadata } from '@/lib/image/metadata'
import type { PhotoMetadata } from '@/types'
import { createMetaEventId, trackMetaEvent } from '@/lib/marketing/meta-pixel'
import RollingTagline from '@/components/RollingTagline'
import TopBar from '@/components/TopBar'
import ModeToggle from '@/components/ModeToggle'
import AgentContent from '@/components/AgentContent'
import { type HomeSkill, getCachedHomeSkills, setCachedHomeSkills } from '@/lib/home-skills'
import { warmHomeSkillMedia } from '@/lib/home-skills-warm'
import { getThumbnailUrl, getOptimizedUrl, normalizeDomain } from '@/lib/supabase/storage'
import { isMakaronIOSApp } from '@/lib/native-app'
import { readNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache'
import { useCreateInput } from '@/hooks/useCreateInput'
import CreateInputBox from '@/components/CreateInputBox'
import MakaronLogo from '@/components/MakaronLogo'
import LiquidGlassNav from '@/components/LiquidGlassNav'

const Z = { INPUT: 100, HERO_FLY: 90, OVERLAY: 80, AMBIENT: 0 } as const
const IOS_SKILL_BACK_EDGE_PX = 36
const IOS_SKILL_BACK_LOCK_PX = 10
const IOS_SKILL_BACK_COMMIT_PX = 88
const IOS_SKILL_BACK_CLOSE_MS = 180
const IOS_RESET_HOME_SCROLL_KEY = 'makaron:ios-reset-home-scroll'
const IOS_PENDING_HOME_SKILL_KEY = 'makaron:ios-pending-home-skill-id'

function getHomeScrollContainer(node: HTMLElement | null): HTMLElement | null {
  if (!node) return null
  return node.closest('[data-makaron-ios-stack-entry]') as HTMLElement | null
}

interface SkillsPayload {
  skills?: { name: string; label: string; icon: string; color: string; builtIn: boolean }[]
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
}

function useCachedVideoSource(src: string, enabled: boolean) {
  const normalizedSrc = normalizeDomain(src)
  const [resolvedSrc, setResolvedSrc] = useState(normalizedSrc)

  useEffect(() => {
    let cancelled = false
    setResolvedSrc(normalizedSrc)
    if (!enabled) return

    const key = mediaCacheKeyForUrl(normalizedSrc)
    getCachedMediaObjectUrl(key)
      .then((cachedSrc) => cachedSrc ?? cacheMediaUrl(normalizedSrc, key))
      .then((cachedSrc) => {
        if (!cancelled && cachedSrc) setResolvedSrc(cachedSrc)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [enabled, normalizedSrc])

  return resolvedSrc
}

function LazyVideo({ src, style }: { src: string; style: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [inView, setInView] = useState(false)
  const resolvedSrc = useCachedVideoSource(src, inView)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      src={inView ? resolvedSrc : undefined}
      autoPlay={inView}
      loop
      muted
      playsInline
      preload={inView ? 'auto' : 'none'}
      style={style}
    />
  )
}

function SkillVideo({ src, style, eager = false }: { src: string; style: React.CSSProperties; eager?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const resolvedSrc = useCachedVideoSource(src, eager)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    video.playsInline = true
    if (eager) video.load()
    const play = () => {
      void video.play().catch(() => {
        window.setTimeout(() => {
          video.muted = true
          void video.play().catch(() => undefined)
        }, 80)
      })
    }
    const raf = window.requestAnimationFrame(play)
    return () => window.cancelAnimationFrame(raf)
  }, [eager, resolvedSrc])

  return (
    <video
      ref={ref}
      src={resolvedSrc}
      autoPlay
      loop
      muted
      playsInline
      preload={eager ? 'auto' : 'metadata'}
      style={style}
    />
  )
}

export default function HomePage() {
  return <Suspense><HomePageInner /></Suspense>
}

function HomePageInner() {
  const { user, loading: authLoading } = useAuth()
  const requireAuth = useRequireAuth()
  const { t, locale } = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isDesktop = useIsDesktop()
  const [isIOSAppShell] = useState(() => isMakaronIOSApp())

  const [viewMode, setViewMode] = useState<'human' | 'agent'>('human')
  const createInput = useCreateInput()
  const inputBoxRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [photoSlotWidth, setPhotoSlotWidth] = useState(80)
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const [inputWrapperHeight, setInputWrapperHeight] = useState(0)
  const [slotDragOver, setSlotDragOver] = useState(-1)
  const [homeSkills, setHomeSkills] = useState<HomeSkill[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [availableSkills, setAvailableSkills] = useState<{ name: string; label: string; icon: string; color: string; builtIn: boolean }[]>([])
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [skillMenuPos, setSkillMenuPos] = useState<{ bottom: number; left: number } | null>(null)
  const [skillUploading, setSkillUploading] = useState(false)
  const [installingSkill, setInstallingSkill] = useState(false)
  const skillFileRef = useRef<HTMLInputElement>(null)
  const skillMenuRef = useRef<HTMLDivElement>(null)
  const [selectedDetail, setSelectedDetail] = useState<HomeSkill | null>(null)
  const [heroRect, setHeroRect] = useState<DOMRect | null>(null)
  const [heroExpanded, setHeroExpanded] = useState(false)
  const detailSnapRef = useRef<HTMLDivElement>(null)
  const detailInnerRef = useRef<HTMLDivElement>(null)
  const detailSwipeRef = useRef<{ startY: number; startIdx: number; swiping: boolean } | null>(null)
  const wheelCooldownRef = useRef(false)
  const [kbInset, setKbInset] = useState(0)
  const [nativeKbInset, setNativeKbInset] = useState(0)
  const [textareaFocused, setTextareaFocused] = useState(false)
  const scrollStartY = useRef<number | null>(null)
  const inlineInputRef = useRef<HTMLDivElement>(null)
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null)
  const inlineBoxRef = useRef<HTMLDivElement>(null)
  const [inlineBoxHeight, setInlineBoxHeight] = useState(0)
  const [showFixedInput, setShowFixedInput] = useState(false)
  const fixedInputSyncFrameRef = useRef<number | null>(null)
  const [shareToast, setShareToast] = useState(false)
  const openedFromUrlRef = useRef(false)
  const detailPathActiveRef = useRef(false)
  const hasSelectedDetail = Boolean(selectedDetail)
  const [skillBackPanX, setSkillBackPanX] = useState(0)
  const [skillBackPanActive, setSkillBackPanActive] = useState(false)
  const [skillBackPanSettling, setSkillBackPanSettling] = useState(false)
  const skillBackPanRef = useRef<{
    tracking: boolean
    locked: boolean
    startX: number
    startY: number
    lastX: number
    startTime: number
  }>({ tracking: false, locked: false, startX: 0, startY: 0, lastX: 0, startTime: 0 })
  const lastUploadIntentRef = useRef<{ at: number; key: string } | null>(null)
  const selectedDetailRef = useRef(selectedDetail)
  selectedDetailRef.current = selectedDetail
  const homeSkillsRef = useRef(homeSkills)
  homeSkillsRef.current = homeSkills
  const pathSkillId = pathname?.startsWith('/home/') ? pathname.split('/')[2] : null
  const activeSkillId = selectedDetail?.id || searchParams.get('skill') || pathSkillId || null
  const activeSkill = selectedDetail || (activeSkillId ? homeSkills.find(s => s.id === activeSkillId) || null : null)
  const showGuestModeToggle = !authLoading && !user
  const showAgentLanding = showGuestModeToggle && viewMode === 'agent'

  const blurHomeComposers = useCallback(() => {
    textareaRef.current?.blur()
    inlineTextareaRef.current?.blur()
    setTextareaFocused(false)
    setKbInset(0)
  }, [])

  const handleHomeTextareaBlur = useCallback(() => {
    window.setTimeout(() => {
      const active = document.activeElement
      if (active === textareaRef.current || active === inlineTextareaRef.current) return
      setTextareaFocused(false)
      setKbInset(0)
    }, 0)
  }, [])

  const rememberIOSSkillReturn = useCallback((skillId: string | null | undefined) => {
    if (!isIOSAppShell || !skillId) return
    const returnPath = `/home/${skillId}`
    localStorage.setItem('mkr_return_url', returnPath)
    sessionStorage.setItem('mkr_return_url', returnPath)
    localStorage.setItem(IOS_PENDING_HOME_SKILL_KEY, skillId)
    sessionStorage.setItem(IOS_PENDING_HOME_SKILL_KEY, skillId)
  }, [isIOSAppShell])

  const clearIOSSkillReturn = useCallback(() => {
    if (!isIOSAppShell) return
    localStorage.removeItem(IOS_PENDING_HOME_SKILL_KEY)
    sessionStorage.removeItem(IOS_PENDING_HOME_SKILL_KEY)
  }, [isIOSAppShell])

  const writeSkillDetailPath = useCallback((skillId: string, mode: 'push' | 'replace') => {
    const state = isIOSAppShell ? { makaronHomeSkill: true, skillId } : null
    const url = isIOSAppShell ? '/home' : `/home?skill=${encodeURIComponent(skillId)}`
    if (mode === 'push') window.history.pushState(state, '', url)
    else window.history.replaceState(state, '', url)
    if (!user) rememberIOSSkillReturn(skillId)
  }, [isIOSAppShell, rememberIOSSkillReturn, user])

  const resetSkillBackPan = useCallback(() => {
    skillBackPanRef.current = { tracking: false, locked: false, startX: 0, startY: 0, lastX: 0, startTime: 0 }
    setSkillBackPanX(0)
    setSkillBackPanActive(false)
    setSkillBackPanSettling(false)
  }, [])

  const closeSkillDetail = useCallback((historyMode: 'none' | 'pushHome' = 'none', options?: { preservePan?: boolean; skipHeroCollapse?: boolean }) => {
    if (options?.skipHeroCollapse) {
      setSelectedDetail(null)
      setHeroRect(null)
      resetSkillBackPan()
    } else {
      setHeroExpanded(false)
      setTimeout(() => {
        setSelectedDetail(null)
        setHeroRect(null)
        resetSkillBackPan()
      }, 350)
    }
    setSelectedSkill(null)
    createInput.clear()
    if (!options?.preservePan) resetSkillBackPan()
    clearIOSSkillReturn()
    detailPathActiveRef.current = false
    if (historyMode === 'pushHome') {
      if (isIOSAppShell) window.history.replaceState(null, '', '/home')
      else window.history.pushState(null, '', '/home')
    }
  }, [clearIOSSkillReturn, createInput, isIOSAppShell, resetSkillBackPan])

  const handleSkillBackPanStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!selectedDetailRef.current || isDesktop || !isIOSAppShell || e.touches.length !== 1) return
    const touch = e.touches[0]
    if (!touch || touch.clientX > IOS_SKILL_BACK_EDGE_PX || isEditableTarget(e.target)) return
    skillBackPanRef.current = {
      tracking: true,
      locked: false,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      startTime: performance.now(),
    }
  }, [isDesktop, isIOSAppShell])

  const handleSkillBackPanMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const pan = skillBackPanRef.current
    if (!pan.tracking) return
    const touch = e.touches[0]
    if (!touch) return
    const dx = touch.clientX - pan.startX
    const dy = touch.clientY - pan.startY

    if (!pan.locked) {
      if (dx < -IOS_SKILL_BACK_LOCK_PX || (Math.abs(dy) > IOS_SKILL_BACK_LOCK_PX && Math.abs(dy) > dx)) {
        resetSkillBackPan()
        return
      }
      if (dx < IOS_SKILL_BACK_LOCK_PX || dx < Math.abs(dy) * 1.15) return
      pan.locked = true
      setSkillBackPanActive(true)
      detailSwipeRef.current = null
    }

    e.preventDefault()
    e.stopPropagation()
    pan.lastX = touch.clientX
    setSkillBackPanX(Math.max(0, Math.min(dx, window.innerWidth)))
  }, [resetSkillBackPan])

  const handleSkillBackPanEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const pan = skillBackPanRef.current
    if (!pan.tracking) return
    if (!pan.locked) {
      resetSkillBackPan()
      return
    }

    const touch = e.changedTouches[0]
    const endX = touch?.clientX ?? pan.lastX
    const dx = Math.max(0, endX - pan.startX)
    const elapsed = Math.max(1, performance.now() - pan.startTime)
    const velocity = dx / elapsed
    const shouldClose = dx >= IOS_SKILL_BACK_COMMIT_PX || velocity > 0.55

    e.preventDefault()
    e.stopPropagation()
    setSkillBackPanSettling(true)
    if (shouldClose) {
      setSkillBackPanX(window.innerWidth)
      window.setTimeout(() => closeSkillDetail('pushHome', { preservePan: true, skipHeroCollapse: true }), IOS_SKILL_BACK_CLOSE_MS)
    } else {
      setSkillBackPanX(0)
      window.setTimeout(resetSkillBackPan, IOS_SKILL_BACK_CLOSE_MS)
    }
  }, [closeSkillDetail, resetSkillBackPan])

  const placeholders = locale === 'zh' ? [
    '把这些图片做个 vlog',
    '用这张产品图帮我做一套小红书素材',
    '把我P的美一点',
    '给我的猫拍一组表情包',
    '把这张图片变成个电商海报',
    '把这几张照片做成一个故事板，加上配乐',
    '一张照片，帮我探索 6 个完全不同的方向',
  ] : [
    'Turn these photos into a vlog',
    'Make a set of social media content from this product shot',
    'Make me look better',
    "Create an emoji pack from my cat's photo",
    'Turn this photo into an e-commerce poster',
    'Storyboard these photos and add a soundtrack',
    'One photo, show me 6 completely different directions',
  ]
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [showWelcome, setShowWelcome] = useState(false)
  const [welcomeCredits, setWelcomeCredits] = useState(0)
  useEffect(() => { setPlaceholderIdx(Math.floor(Math.random() * placeholders.length)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore state from login redirect + detect welcome
  const returnTextRef = useRef<string | null>(null)
  useEffect(() => {
    const text = localStorage.getItem('mkr_return_text')
    if (text) { returnTextRef.current = text; localStorage.removeItem('mkr_return_text') }
    localStorage.removeItem('mkr_return_skill')
    localStorage.removeItem('mkr_return_url')
    sessionStorage.removeItem('mkr_return_url')
    // Welcome credits popup — activates new user + grants credits
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('welcome')) {
        window.history.replaceState({}, '', window.location.pathname + window.location.search.replace(/[?&]welcome=1/, ''))
        fetch('/api/auth/activate', { method: 'POST' })
          .then(r => r.json())
          .then(d => {
            if (d.isNew) {
              trackMetaEvent(
                'CompleteRegistration',
                {},
                d.metaEvents?.CompleteRegistration || createMetaEventId('registration'),
              )
            }
            if (d.credits > 0) {
              trackMetaEvent(
                'StartTrial',
                { credits: d.credits },
                d.metaEvents?.StartTrial || createMetaEventId('starttrial'),
              )
              setWelcomeCredits(d.credits); setShowWelcome(true)
              window.dispatchEvent(new Event('credits-updated'))
            } else if (d.isNew === false) {
              // Already activated user revisiting with ?welcome=1 — just refresh credits
              fetch('/api/billing/credits').then(r => r.json()).then(b => {
                writeNativeJSONCache('/api/billing/credits', b)
                if (b.balance > 0) { setWelcomeCredits(b.balance); setShowWelcome(true); window.dispatchEvent(new Event('credits-updated')) }
              })
            }
          })
          .catch(() => {})
      }
    }
    // Delay text restore to run after skill overlay sets its default prompt
    setTimeout(() => {
      if (returnTextRef.current) { createInput.setText(returnTextRef.current); returnTextRef.current = null }
    }, 100)
  }, [])

  useEffect(() => {
    // Hydrate from sessionStorage first (instant, avoids skeleton flash on same-session)
    const cached = readNativeJSONCache<HomeSkill[]>('/api/home-skills') ?? getCachedHomeSkills()
    if (cached.length > 0) {
      setHomeSkills(cached)
      warmHomeSkillMedia(cached)
    }

    // Then fetch fresh data in background
    fetch('/api/home-skills').then(r => r.json()).then(data => {
      if (!Array.isArray(data) || data.length === 0) return
      writeNativeJSONCache('/api/home-skills', data)
      warmHomeSkillMedia(data)
      setHomeSkills(prev => {
        if (prev.length === 0) { setCachedHomeSkills(data); return data }
        const newMap = new Map(data.map((s: HomeSkill) => [s.id, s]))
        const merged = prev.map(s => {
          const fresh = newMap.get(s.id)
          if (!fresh) return null
          newMap.delete(s.id)
          return JSON.stringify(fresh) === JSON.stringify(s) ? s : fresh as HomeSkill
        }).filter(Boolean) as HomeSkill[]
        for (const s of newMap.values()) merged.push(s)
        merged.sort((a, b) => a.sort_order - b.sort_order)
        setCachedHomeSkills(merged)
        return merged
      })
    }).catch(() => {})
  }, [])

  // Preload user's installed skills
  const skillsFetchedRef = useRef(false)
  useEffect(() => {
    if (skillsFetchedRef.current) return
    const load = () => {
      skillsFetchedRef.current = true
      const cachedSkills = readNativeJSONCache<SkillsPayload>('/api/skills')?.skills
      if (cachedSkills) setAvailableSkills(cachedSkills)
      fetch('/api/skills').then(r => r.json()).then(d => {
        writeNativeJSONCache('/api/skills', d)
        if (d.skills) setAvailableSkills(d.skills)
      }).catch(() => {})
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(load, { timeout: 5000 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(load, 2000)
    return () => clearTimeout(t)
  }, [])

  // Close skill menu on click outside
  useEffect(() => {
    if (!skillMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (skillMenuRef.current && !skillMenuRef.current.contains(e.target as Node)) setSkillMenuOpen(false)
    }
    const onScroll = (e: Event) => {
      if (skillMenuRef.current?.contains(e.target as Node)) return
      setSkillMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', handler); window.removeEventListener('scroll', onScroll, true) }
  }, [skillMenuOpen])


  const handleSkillUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) return
    setSkillUploading(true)
    setInstallingSkill(true)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/skills', { method: 'POST', body: form })
      const data = await res.json()
      if (data.success) {
        const r = await fetch('/api/skills')
        const d = await r.json()
        writeNativeJSONCache('/api/skills', d)
        if (d.skills) setAvailableSkills(d.skills)
        if (data.skillName) setSelectedSkill(data.skillName)
        setSkillMenuOpen(false)
      }
    } catch {}
    setSkillUploading(false)
    setInstallingSkill(false)
  }, [])

  const installHomeSkill = useCallback(async (skill: HomeSkill): Promise<string | undefined> => {
    if (!skill.skill_path) return undefined
    setInstallingSkill(true)
    try {
      const installRes = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillPath: skill.skill_path, homeSkillId: skill.id }),
      })
      const installData = await installRes.json()
      if (installData.skillName) {
        setSelectedSkill(installData.skillName)
        fetch('/api/skills').then(r => r.json()).then(d => {
          writeNativeJSONCache('/api/skills', d)
          if (d.skills) setAvailableSkills(d.skills)
        }).catch(() => {})
        return installData.skillName as string
      }
    } finally {
      setInstallingSkill(false)
    }
    return undefined
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKbInset(Math.round(inset))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
  useEffect(() => {
    if (!isIOSAppShell) return
    const readNativeInset = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--makaron-native-keyboard-inset')
        .trim()
      const next = Number.parseFloat(raw)
      setNativeKbInset(Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0)
    }
    const onNativeInset = (event: Event) => {
      const inset = (event as CustomEvent<{ inset?: number }>).detail?.inset
      if (typeof inset === 'number') {
        setNativeKbInset(Math.max(0, Math.round(inset)))
      } else {
        readNativeInset()
      }
    }
    readNativeInset()
    window.addEventListener('makaron-keyboard-inset-change', onNativeInset)
    return () => window.removeEventListener('makaron-keyboard-inset-change', onNativeInset)
  }, [isIOSAppShell])
  const effectiveKbInset = Math.max(kbInset, nativeKbInset)

  useEffect(() => {
    const el = inputBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.round(entry.contentRect.height)
      setPhotoSlotWidth(prev => prev === 80 ? h : prev)
      setInputBoxHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = inputWrapperRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setInputWrapperHeight(Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = document.querySelector('.mkr-page') as HTMLElement | null
    if (!el) return
    const onTouchStart = (e: TouchEvent) => { scrollStartY.current = e.touches[0].clientY }
    const onTouchMove = (e: TouchEvent) => {
      if (scrollStartY.current === null) return
      if (Math.abs(e.touches[0].clientY - scrollStartY.current) > 8) {
        blurHomeComposers()
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [blurHomeComposers])

  const unlockHomeScroll = useCallback((force = false) => {
    if (!force && selectedDetailRef.current) return
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  }, [])

  useEffect(() => {
    if (selectedDetail) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      return () => unlockHomeScroll(true)
    }
    unlockHomeScroll(true)
  }, [selectedDetail, unlockHomeScroll])

  useEffect(() => {
    if (!isIOSAppShell) return
    const unlockIfNoDetail = () => unlockHomeScroll(false)
    window.addEventListener('pageshow', unlockIfNoDetail)
    window.addEventListener('focus', unlockIfNoDetail)
    window.addEventListener('makaron-ios-page-stack-back', unlockIfNoDetail)
    window.addEventListener('makaron-ios-page-stack-push', unlockIfNoDetail)
    return () => {
      window.removeEventListener('pageshow', unlockIfNoDetail)
      window.removeEventListener('focus', unlockIfNoDetail)
      window.removeEventListener('makaron-ios-page-stack-back', unlockIfNoDetail)
      window.removeEventListener('makaron-ios-page-stack-push', unlockIfNoDetail)
    }
  }, [isIOSAppShell, unlockHomeScroll])

  // Unmute active slide's video, mute all others (after transition completes)
  useEffect(() => {
    if (!selectedDetail) return
    const playActiveVideo = () => {
      const snap = detailSnapRef.current
      if (!snap) return
      const slides = snap.querySelectorAll('.mkr-detail-slide')
      slides.forEach((slide) => {
        const video = slide.querySelector('video') as HTMLVideoElement | null
        if (!video) return
        if (slide.getAttribute('data-skill-id') === selectedDetail.id) {
          video.muted = false
          video.volume = 1
          video.playsInline = true
          try {
            if (video.readyState >= 1) video.currentTime = 0
          } catch {
            // Some iOS media states reject currentTime before metadata.
          }
          video.play().catch(() => {
            video.muted = true
            void video.play().catch(() => undefined)
          })
        } else {
          video.muted = true
          video.pause()
        }
      })
    }
    const raf = window.requestAnimationFrame(playActiveVideo)
    const tid = window.setTimeout(playActiveVideo, 420)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(tid)
    }
  }, [selectedDetail])

  // Open detail overlay from URL param (?skill={id}) or iOS login return state.
  useEffect(() => {
    const pendingIOSSkillId = isIOSAppShell
      ? (sessionStorage.getItem(IOS_PENDING_HOME_SKILL_KEY) || localStorage.getItem(IOS_PENDING_HOME_SKILL_KEY))
      : null
    const skillId = searchParams.get('skill') || pathSkillId || pendingIOSSkillId
    if (!skillId || homeSkills.length === 0 || selectedDetail) return
    const skill = homeSkills.find(s => s.id === skillId)
    if (!skill) return

    openedFromUrlRef.current = true
    setSelectedDetail(skill)
    setSelectedSkill(skill.skill_path ? skill.id : null)
    createInput.setText(skill.prompt)
    setHeroExpanded(true)
    detailPathActiveRef.current = true
    writeSkillDetailPath(skillId, 'replace')
    if (pendingIOSSkillId === skillId) clearIOSSkillReturn()
  }, [clearIOSSkillReturn, homeSkills, isIOSAppShell, pathSkillId, searchParams, selectedDetail, writeSkillDetailPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Position slide when overlay DOM mounts via ref callback (stable — no deps to avoid re-bindinging)
  const detailSnapCallbackRef = useCallback((el: HTMLDivElement | null) => {
    detailSnapRef.current = el
    if (!el || !openedFromUrlRef.current) return
    requestAnimationFrame(() => {
      const skill = selectedDetailRef.current
      if (!skill) return
      const skills = homeSkillsRef.current
      const idx = skills.findIndex(t => t.id === skill.id)
      if (detailInnerRef.current && el) {
        const slideH = el.clientHeight
        detailInnerRef.current.style.transition = 'none'
        detailInnerRef.current.style.transform = `translateY(${-idx * slideH}px)`
      }
      openedFromUrlRef.current = false
    })
  }, [])

  // Handle browser back button
  useEffect(() => {
    if (!hasSelectedDetail) return
    const onPop = () => closeSkillDetail('none')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [hasSelectedDetail, closeSkillDetail])

  useEffect(() => {
    if (isIOSAppShell) return
    const hasSkillQuery = new URLSearchParams(window.location.search).has('skill')
    if (!hasSelectedDetail || !detailPathActiveRef.current || pathname !== '/home' || hasSkillQuery) return
    closeSkillDetail('none')
  }, [closeSkillDetail, hasSelectedDetail, isIOSAppShell, pathname, searchParams])

  const syncFixedInputVisibility = useCallback(() => {
    if (isDesktop) return
    setShowFixedInput(textareaFocused)
  }, [isDesktop, textareaFocused])
  const keepSkillComposerAboveKeyboard = useCallback(() => {
    setTextareaFocused(true)
    if (!isDesktop) setShowFixedInput(true)
    const sync = () => {
      const vv = window.visualViewport
      if (vv) {
        const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        setKbInset(Math.round(inset))
      }
      inputWrapperRef.current?.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'smooth' })
    }
    sync()
    window.setTimeout(sync, 80)
    window.setTimeout(sync, 220)
  }, [isDesktop])

  useEffect(() => {
    if (isDesktop) return
    const scheduleSync = () => {
      if (fixedInputSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(fixedInputSyncFrameRef.current)
      }
      fixedInputSyncFrameRef.current = window.requestAnimationFrame(() => {
        fixedInputSyncFrameRef.current = null
        syncFixedInputVisibility()
      })
    }

    scheduleSync()

    const scrollContainer = getHomeScrollContainer(inlineInputRef.current)

    const inlineResizeObserver = inlineInputRef.current
      ? new ResizeObserver(() => scheduleSync())
      : null
    if (inlineResizeObserver && inlineInputRef.current) {
      inlineResizeObserver.observe(inlineInputRef.current)
    }

    scrollContainer?.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)
    window.addEventListener('pageshow', scheduleSync)
    window.addEventListener('popstate', scheduleSync)
    window.addEventListener('makaron-ios-page-stack-back', scheduleSync as EventListener)
    window.addEventListener('makaron-ios-page-stack-push', scheduleSync as EventListener)
    window.visualViewport?.addEventListener('resize', scheduleSync)
    window.visualViewport?.addEventListener('scroll', scheduleSync)

    return () => {
      if (fixedInputSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(fixedInputSyncFrameRef.current)
        fixedInputSyncFrameRef.current = null
      }
      inlineResizeObserver?.disconnect()
      scrollContainer?.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      window.removeEventListener('pageshow', scheduleSync)
      window.removeEventListener('popstate', scheduleSync)
      window.removeEventListener('makaron-ios-page-stack-back', scheduleSync as EventListener)
      window.removeEventListener('makaron-ios-page-stack-push', scheduleSync as EventListener)
      window.visualViewport?.removeEventListener('resize', scheduleSync)
      window.visualViewport?.removeEventListener('scroll', scheduleSync)
    }
  }, [isDesktop, syncFixedInputVisibility])

  useEffect(() => {
    if (!isIOSAppShell) return
    let shouldReset = false
    try {
      shouldReset = sessionStorage.getItem(IOS_RESET_HOME_SCROLL_KEY) === '1'
      if (shouldReset) sessionStorage.removeItem(IOS_RESET_HOME_SCROLL_KEY)
    } catch {
      shouldReset = false
    }
    if (!shouldReset) return

    const resetToTop = () => {
      unlockHomeScroll(true)
      document.documentElement.classList.remove('makaron-ios-project-overlay-open')
      const scrollContainer = getHomeScrollContainer(inlineInputRef.current)
      if (scrollContainer) {
        scrollContainer.scrollTop = 0
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      setShowFixedInput(false)
      syncFixedInputVisibility()
    }

    resetToTop()
    const rafId = window.requestAnimationFrame(resetToTop)
    const timerId = window.setTimeout(resetToTop, 180)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(timerId)
    }
  }, [isIOSAppShell, syncFixedInputVisibility, unlockHomeScroll])

  useEffect(() => {
    const el = inlineBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.round(entry.contentRect.height)
      setInlineBoxHeight(prev => prev === 0 ? h : prev)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const userTypingRef = useRef(false)
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const prev = el.offsetHeight
    el.style.transition = 'none'
    el.style.height = 'auto'
    const next = el.scrollHeight
    if (prev !== next) {
      el.style.height = `${prev}px`
      el.offsetHeight // force reflow
      el.style.transition = 'height 0.15s ease'
      el.style.height = `${next}px`
    } else {
      el.style.height = `${next}px`
    }
  }, [])
  const resizeInlineTextarea = useCallback(() => {
    const el = inlineTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useEffect(() => {
    resizeTextarea()
    resizeInlineTextarea()
    userTypingRef.current = false
  }, [createInput.text, resizeTextarea])
  useEffect(() => {
    if (selectedDetail) {
      const tid = setTimeout(resizeTextarea, 300)
      return () => clearTimeout(tid)
    }
  }, [selectedDetail, resizeTextarea])

  const cardSwipeRef = useRef<HTMLDivElement>(null)
  const inlineCardSwipeRef = useRef<HTMLDivElement>(null)

  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const saveContextBeforeLogin = useCallback(() => {
    if (createInput.text.trim()) localStorage.setItem('mkr_return_text', createInput.text)
    if (activeSkill?.id) localStorage.setItem('mkr_return_skill', activeSkill.id)
    if (activeSkill?.id) rememberIOSSkillReturn(activeSkill.id)
  }, [activeSkill, createInput.text, rememberIOSSkillReturn])

  const saveCreateDraftBeforeLogin = useCallback(async (files: File[], prompt?: string) => {
    const homeSkill = selectedDetail || activeSkill
    const imageFiles = files.filter(file => file.type.startsWith('image/') || isHeicFile(file))
    const [images, metadata] = await Promise.all([
      Promise.all(imageFiles.map(file => compressCreateImageFile(file))),
      imageFiles[0]
        ? extractPhotoMetadata(imageFiles[0]).catch(() => undefined)
        : Promise.resolve(undefined),
    ])
    cacheCreateDraft({
      images,
      metadata,
      prompt,
      selectedSkill: homeSkill?.skill_path ? undefined : (selectedSkill ?? undefined),
      homeSkillId: homeSkill?.id,
      returnPath: homeSkill?.id ? `/home/${homeSkill.id}` : window.location.pathname + window.location.search,
    })
    const returnPath = homeSkill?.id ? `/home/${homeSkill.id}` : window.location.pathname + window.location.search
    localStorage.setItem('mkr_return_url', returnPath)
    sessionStorage.setItem('mkr_return_url', returnPath)
  }, [activeSkill, selectedDetail, selectedSkill])

  const handleCreateProject = useCallback(async (files: File[], prompt?: string) => {
    if (createInput.creating || (files.length === 0 && !prompt)) return
    saveContextBeforeLogin()
    let authedUser = user
    if (!authedUser) {
      createInput.setCreating(true)
      try {
        await saveCreateDraftBeforeLogin(files, prompt)
      } catch (err) {
        console.error('Save create draft error:', err)
        createInput.setCreating(false)
        return
      }
      authedUser = await requireAuth()
      if (!authedUser) return
    }
    createInput.setCreating(true)
    try {
      const supabase = createClient()
      let skillName: string | undefined
      const homeSkill = selectedDetail || activeSkill
      if (homeSkill?.skill_path) {
        skillName = await installHomeSkill(homeSkill)
      } else if (selectedSkill) {
        skillName = selectedSkill
      }
      const opts: { prompt?: string; skill?: string } = {}
      if (prompt) opts.prompt = prompt
      if (skillName) opts.skill = skillName
      const result = await createProject(supabase, authedUser.id, files, Object.keys(opts).length ? opts : undefined)
      if (!result) throw new Error('Failed to create project')
      void clearCreateDraft()
      router.push(`/projects/${result.projectId}`)
    } catch (err) {
      console.error('Create project error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Video too long')) {
        const { MAX_DURATION } = await import('@/lib/video-upload')
        alert(t('video.tooLong').replace('{duration}', msg.match(/\((\d+(?:\.\d+)?)s\)/)?.[1] || '?').replace('{max}', String(MAX_DURATION)))
      }
      createInput.setCreating(false)
    }
  }, [activeSkill, createInput, installHomeSkill, requireAuth, router, saveContextBeforeLogin, saveCreateDraftBeforeLogin, selectedDetail, selectedSkill, t, user])

  const consumeDraftRef = useRef(false)
  useEffect(() => {
    if (!user || consumeDraftRef.current) return
    let cancelled = false
    const consume = async () => {
      const draft = await getCreateDraft()
      if (!draft || cancelled) return
      if (draft.homeSkillId && homeSkills.length === 0) return
      if (draft.homeSkillId && draft.images.length === 0) {
        await clearCreateDraft()
        return
      }
      if (draft.images.length === 0 && !draft.prompt) {
        await clearCreateDraft()
        return
      }

      consumeDraftRef.current = true
      createInput.restoreDraftImages(draft.images)
      if (draft.prompt) createInput.setText(draft.prompt)
      createInput.setCreating(true)
      try {
        const supabase = createClient()
        let skillName = draft.selectedSkill
        const homeSkill = draft.homeSkillId ? homeSkills.find(skill => skill.id === draft.homeSkillId) : null
        if (homeSkill?.skill_path) {
          skillName = await installHomeSkill(homeSkill)
        }
        const result = await createProjectFromStagedMedia(supabase, user.id, {
          images: draft.images,
          metadata: draft.metadata as PhotoMetadata | undefined,
          prompt: draft.prompt,
          skill: skillName,
        })
        if (!result) throw new Error('Failed to create project from draft')
        await clearCreateDraft()
        localStorage.removeItem('mkr_return_text')
        localStorage.removeItem('mkr_return_skill')
        localStorage.removeItem('mkr_return_url')
        router.replace(`/projects/${result.projectId}`)
      } catch (err) {
        console.error('Resume create draft error:', err)
        consumeDraftRef.current = false
        createInput.setCreating(false)
      }
    }
    void consume()
    return () => { cancelled = true }
  }, [createInput, homeSkills, installHomeSkill, router, user])

  const handleCreate = useCallback(async () => {
    const hasText = createInput.text.trim()
    const hasFiles = createInput.files.length > 0
    if (!hasText && !hasFiles) return
    await handleCreateProject(hasFiles ? createInput.files : [], hasText || undefined)
    createInput.clear()
  }, [createInput, handleCreateProject])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (createInput.creating) return
    const allFiles = Array.from(e.dataTransfer.files ?? [])
    const zipFile = allFiles.find(f => f.name.endsWith('.zip'))
    const droppedFiles = allFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || isHeicFile(f))
    if (!zipFile && droppedFiles.length === 0) return
    const authedUser = await requireAuth()
    if (!authedUser) return
    if (zipFile) { handleSkillUpload(zipFile); return }
    createInput.addFiles(droppedFiles)
  }, [createInput, handleSkillUpload, requireAuth])

  const handleSlotDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files ?? []).filter(f => f.type.startsWith('image/') || isHeicFile(f))
    if (files.length === 0) return
    if (!user && selectedDetail) {
      rememberIOSSkillReturn(selectedDetail.id)
      createInput.addFiles(files)
      return
    }
    const authedUser = await requireAuth()
    if (!authedUser) return
    createInput.addFiles(files)
  }, [createInput, rememberIOSSkillReturn, requireAuth, selectedDetail, user])

  const trackUploadIntentEvent = useCallback((source: string) => {
    if (user || !activeSkill) return
    const dedupeKey = `${activeSkill.id}:${source}:${createInput.files.length}`
    const now = Date.now()
    if (lastUploadIntentRef.current?.key === dedupeKey && now - lastUploadIntentRef.current.at < 700) return
    lastUploadIntentRef.current = { at: now, key: dedupeKey }
    const skillLabel = activeSkill.labels[locale] || activeSkill.labels.en || activeSkill.id
    trackMetaEvent('UploadIntent', {
      content_type: 'skill',
      content_name: skillLabel,
      skill_id: activeSkill.id,
      required_photo_count: Math.max(1, activeSkill.image_count ?? 1),
      selected_photo_count: createInput.files.length,
      source,
    }, createMetaEventId('upload.intent'))
  }, [activeSkill, createInput.files.length, locale, user])

  const renderUploadSlots = useCallback((template: { image_count?: number; before_images?: string[] }, isActive: boolean) => {
    const minSlots = template.image_count ?? 1
    const count = Math.max(minSlots, createInput.files.length + 1)
    const befores = (template.before_images || []).slice(0, 3)
    const showBefores = befores.length > 0 && createInput.files.length === 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflowX: 'visible', position: 'relative', minHeight: 64 }}>
        {Array.from({ length: count }, (_, i) => {
          const isDragTarget = slotDragOver === i
          return (
            <div key={i}
              onClick={async () => {
                if (!isActive || createInput.previews[i] || createInput.creating) return
                if (!user && selectedDetail) {
                  rememberIOSSkillReturn(selectedDetail.id)
                  trackUploadIntentEvent('upload_slot')
                  createInput.fileInputRef.current?.click()
                  return
                }
                const u = await requireAuth()
                if (u) {
                  trackUploadIntentEvent('upload_slot')
                  createInput.fileInputRef.current?.click()
                }
              }}
              onDragEnter={(e) => { e.preventDefault(); setSlotDragOver(i) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={() => setSlotDragOver(-1)}
              onDrop={(e) => { setSlotDragOver(-1); handleSlotDrop(e) }}
              style={{
                width: 64, height: 64, borderRadius: 16, flexShrink: 0,
                border: isDragTarget ? '1.5px solid rgba(217,70,239,0.6)' : '1.5px solid rgba(255,255,255,0.25)',
                background: isDragTarget ? 'rgba(217,70,239,0.08)' : 'rgba(0,0,0,0.4)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', position: 'relative', overflow: 'hidden',
                pointerEvents: 'auto',
                boxShadow: isDragTarget ? '0 0 0 1px rgba(217,70,239,0.12)' : 'none',
                transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
              }}>
              {isActive && createInput.previews[i] && createInput.previews[i] !== 'heic-pending' ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={createInput.previews[i]!} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  {!createInput.creating && (
                    <div onClick={(e) => { e.stopPropagation(); createInput.removeFile(i) }}
                      style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', cursor: 'pointer' }}>&#x2715;</div>
                  )}
                </>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              )}
            </div>
          )
        })}
        {showBefores && (
          <div style={{
            position: 'absolute', right: 0, bottom: 0,
            display: 'flex', alignItems: 'flex-end', flexShrink: 0,
            pointerEvents: 'none',
          }}>
            {/* Curved dashed arrow, to the LEFT of the before image, arcs up-LEFT away from it (pointing into the cover scene) */}
            <svg
              width="72" height="96" viewBox="0 0 72 96"
              style={{ position: 'absolute', right: '100%', bottom: 24, marginRight: -4, pointerEvents: 'none', overflow: 'visible' }}
            >
              <path
                d="M 66 30 C 48 58, 18 50, 22 -28"
                stroke="rgba(255,255,255,0.92)"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeDasharray="5 5"
              />
              <path
                d="M 12 -20 L 22 -32 L 32 -20"
                stroke="rgba(255,255,255,0.92)"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {befores.map((url, i, arr) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={i} src={getThumbnailUrl(url, 200, 60, 250, 'cover')} alt=""
                style={{
                  width: 96, height: 120, objectFit: 'cover',
                  border: '3px solid rgba(255,255,255,0.95)',
                  borderRadius: 10,
                  boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
                  transform: `rotate(${(i - (arr.length - 1) / 2) * 5}deg)`,
                  transformOrigin: 'bottom center',
                  background: '#1a1a1a',
                  marginLeft: i === 0 ? 0 : -18,
                  position: 'relative', zIndex: arr.length - i,
                }} />
            ))}
          </div>
        )}
      </div>
    )
  }, [createInput, handleSlotDrop, rememberIOSSkillReturn, requireAuth, selectedDetail, slotDragOver, trackUploadIntentEvent, user])

  const guestSkillCreateLabel = selectedDetail && !user
    ? createInput.files.length > 0
      ? (locale === 'zh' ? '生成免费预览' : 'Create free preview')
      : (locale === 'zh' ? '上传照片' : 'Upload photo')
    : !user
      ? (locale === 'zh' ? '免费试用' : 'Try free')
      : 'Create'

  const requiredPhotoCount = Math.max(1, activeSkill?.image_count ?? 1)
  const selectedPhotoCount = createInput.files.length
  const remainingPhotoCount = Math.max(requiredPhotoCount - selectedPhotoCount, 0)
  const hasEnoughPhotos = remainingPhotoCount === 0
  const isGuestSkillAction = !user && !!activeSkill
  const formatPhotoCount = (count: number) => locale === 'zh'
    ? `${count} 张照片`
    : `${count} photo${count === 1 ? '' : 's'}`

  const skillActionCreateLabel = isGuestSkillAction
    ? hasEnoughPhotos
      ? (locale === 'zh' ? '免费预览' : 'Preview free')
      : (locale === 'zh' ? '上传照片' : 'Upload photo')
    : guestSkillCreateLabel

  const skillActionTitle = isGuestSkillAction
    ? hasEnoughPhotos
      ? (locale === 'zh' ? '看看你的版本' : 'See your version')
      : selectedPhotoCount > 0
        ? (locale === 'zh' ? '快好了' : 'Almost ready')
        : (locale === 'zh' ? '上传一张照片' : 'Upload one photo')
    : undefined

  const skillActionSubtitle = isGuestSkillAction
    ? hasEnoughPhotos
      ? (locale === 'zh' ? '一键生成预览，无需信用卡。' : 'Generate a preview. No credit card.')
      : selectedPhotoCount > 0
        ? (locale === 'zh' ? `再补 ${formatPhotoCount(remainingPhotoCount)}，即可免费预览。` : `Add ${formatPhotoCount(remainingPhotoCount)} to preview free.`)
        : (locale === 'zh' ? '免费生成预览，无需信用卡。' : 'Get a free preview. No credit card.')
    : undefined

  const skillActionMeta = isGuestSkillAction && activeSkill
    ? (activeSkill.labels[locale] || activeSkill.labels.en || null)
    : null

  const trackUploadIntent = useCallback((source: string) => {
    if (!isGuestSkillAction) return
    const dedupeKey = `${activeSkill?.id || 'skill'}:${source}:${createInput.files.length}`
    const now = Date.now()
    if (lastUploadIntentRef.current?.key === dedupeKey && now - lastUploadIntentRef.current.at < 700) return
    lastUploadIntentRef.current = { at: now, key: dedupeKey }
    trackMetaEvent('UploadIntent', {
      content_type: 'skill',
      content_name: skillActionMeta || activeSkill?.id || 'skill',
      skill_id: activeSkill?.id,
      required_photo_count: requiredPhotoCount,
      selected_photo_count: createInput.files.length,
      source,
    }, createMetaEventId('upload.intent'))
  }, [activeSkill?.id, createInput.files.length, isGuestSkillAction, requiredPhotoCount, skillActionMeta])

  const trackFileSelected = useCallback((files: File[], source: string) => {
    if (!isGuestSkillAction || files.length === 0) return
    trackMetaEvent('FileSelected', {
      content_type: 'skill',
      content_name: skillActionMeta || activeSkill?.id || 'skill',
      skill_id: activeSkill?.id,
      file_count: files.length,
      image_count: files.filter(file => file.type.startsWith('image/') || isHeicFile(file)).length,
      video_count: files.filter(file => file.type.startsWith('video/')).length,
      source,
    }, createMetaEventId('file.selected'))
  }, [activeSkill?.id, isGuestSkillAction, skillActionMeta])

  const handleCreateOrUpload = useCallback(() => {
    if (isGuestSkillAction && createInput.files.length < requiredPhotoCount) {
      rememberIOSSkillReturn(activeSkill?.id)
      trackUploadIntent('primary_action')
      createInput.fileInputRef.current?.click()
      return
    }
    handleCreate()
  }, [activeSkill?.id, createInput.fileInputRef, createInput.files.length, handleCreate, isGuestSkillAction, rememberIOSSkillReturn, requiredPhotoCount, trackUploadIntent])

  const handleInputSlotClick = useCallback(async () => {
    if (!user && selectedDetail) {
      rememberIOSSkillReturn(selectedDetail.id)
      trackUploadIntent('slot')
      createInput.fileInputRef.current?.click()
      return
    }
    const u = await requireAuth()
    if (u) {
      trackUploadIntent('slot')
      createInput.fileInputRef.current?.click()
    }
  }, [createInput.fileInputRef, rememberIOSSkillReturn, requireAuth, selectedDetail, trackUploadIntent, user])

  const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url)

  type CoverVariant = 'thumb' | 'detail' | 'hero'
  const renderCoverMedia = (
    url: string,
    alt: string,
    variant: CoverVariant,
    opts?: { priority?: boolean; extraStyle?: React.CSSProperties },
  ) => {
    const style: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: variant === 'detail' ? 'contain' : 'cover', ...(variant === 'detail' ? { objectPosition: 'center 30%' } : {}), pointerEvents: 'none', ...opts?.extraStyle }
    if (isVideoUrl(url)) {
      if (variant === 'thumb') {
        if (opts?.priority) {
          return <SkillVideo src={normalizeDomain(url)} style={style} eager />
        }
        return <LazyVideo src={normalizeDomain(url)} style={style} />
      }
      return <SkillVideo src={normalizeDomain(url)} style={style} eager />
    }
    const src = variant === 'thumb'
      ? getThumbnailUrl(url, 400, 70, 533, 'cover')
      : getOptimizedUrl(url, 95)
    // eslint-disable-next-line @next/next/no-img-element
    return <img
      src={src}
      alt={alt}
      loading={variant === 'thumb' && !opts?.priority ? 'lazy' : undefined}
      fetchPriority={opts?.priority ? 'high' : undefined}
      style={style}
    />
  }

  const renderTemplateLabel = (template: { labels: Record<string, string> }) => (
    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
      {template.labels[locale] || template.labels.en || ''}
    </div>
  )

  const handleSkillCardClick = (template: HomeSkill, e: React.MouseEvent) => {
    if (selectedDetail?.id === template.id) {
      closeSkillDetail('pushHome')
      return
    }
    openedFromUrlRef.current = false
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setHeroRect(rect)
    setHeroExpanded(false)
    setSelectedDetail(template)
    setSelectedSkill(template.skill_path ? template.id : null)
    createInput.setText(template.prompt)
    const idx = homeSkills.findIndex(t => t.id === template.id)
    requestAnimationFrame(() => {
      setHeroExpanded(true)
      // Position to the clicked slide via JS transform (no scroll-snap)
      if (detailInnerRef.current && detailSnapRef.current) {
        const slideH = detailSnapRef.current.clientHeight
        detailInnerRef.current.style.transition = 'none'
        detailInnerRef.current.style.transform = `translateY(${-idx * slideH}px)`
      }
      detailPathActiveRef.current = true
      writeSkillDetailPath(template.id, 'push')
    })
  }


  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');`}</style>
      <style>{`
        .mkr-page { font-family: inherit; }
        .mkr-handwrite { font-family: 'Caveat', cursive; }

        @keyframes mkr-in {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .mkr-row-enter { animation: mkr-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .mkr-skill-item:hover { background: rgba(255,255,255,0.06) !important; }

        .mkr-detail-snap {
          /* No scroll-snap — JS touch handlers control slide transitions
             to avoid iOS Safari video compositor vs scroll-snap conflict. */
        }

        @keyframes mkr-shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .mkr-skeleton {
          background: linear-gradient(90deg, #1a1520 25%, #2a2035 50%, #1a1520 75%);
          background-size: 800px 100%;
          animation: mkr-shimmer 1.5s ease-in-out infinite;
        }

        .mkr-skill-card {
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
          transition: transform 0.15s, box-shadow 0.2s;
        }
        .mkr-skill-card:active { transform: scale(0.97); }
        .mkr-skill-card:hover { box-shadow: 0 4px 24px rgba(217,70,239,0.12); }

        .mkr-input-box {
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .mkr-input-box:focus-within {
          border-color: rgba(217,70,239,0.35) !important;
          box-shadow: 0 0 0 1px rgba(217,70,239,0.12);
        }

        .mkr-create-btn {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
          transition: background 0.2s, border-color 0.2s, transform 0.15s, box-shadow 0.2s;
        }
        @media (hover: hover) {
          .mkr-create-btn:hover, .mkr-skill-btn:hover {
            background: rgba(217,70,239,0.1) !important;
            border-radius: 12px !important;
            box-shadow: 0 0 20px rgba(217,70,239,0.15);
          }
        }
        .mkr-create-btn:active, .mkr-skill-btn:active { transform: scale(0.96); }

        @keyframes mkr-spin { to { transform: rotate(360deg); } }

        @keyframes mkr-menu-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes mkr-sheet-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes mkr-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .mkr-spin { animation: mkr-spin 0.9s linear infinite; }

        .hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="mkr-page" style={{ minHeight: '100dvh', background: '#000', color: '#fff', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <input
          ref={skillFileRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) await handleSkillUpload(file)
            e.target.value = ''
          }}
        />

        {/* Ambient glow */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          height: '520px', pointerEvents: 'none', zIndex: Z.AMBIENT,
          background: 'radial-gradient(ellipse at 50% 40%, rgba(217,70,239,0.22) 0%, transparent 65%)',
        }} />

        {showAgentLanding && <AgentContent />}

        <div style={{ display: showAgentLanding ? 'none' : undefined }}>
        <div style={{ display: selectedDetail ? 'none' : undefined }}>
          <TopBar page="home" authReturnPath={activeSkill?.id ? `/home/${activeSkill.id}` : null} />
        </div>

        {/* ── Hero: Landing-page style ── */}
        <div className="relative flex flex-col items-center" style={{ paddingBottom: '40px' }}>
          {/* Glow */}
          <div className="pointer-events-none absolute top-[-80px] left-1/2 -translate-x-1/2 w-[700px] h-[600px] rounded-full bg-[radial-gradient(ellipse,#d946ef18_0%,transparent_70%)]" />

          <div className="relative z-10 flex flex-col items-center text-center pt-10 lg:pt-16 px-6 max-w-[660px]">
            <MakaronLogo
              markSize="clamp(34px, 6vw, 52px)"
              className="mt-4"
              textClassName="text-[52px] lg:text-[88px] font-extrabold tracking-[-0.04em] leading-[1]"
            />
            <p className="mt-3 leading-tight">
              <RollingTagline className="text-2xl lg:text-[32px]" />
            </p>
            <p className="mt-6 text-[15px] lg:text-lg text-[#a1a1aa] leading-relaxed max-w-[480px]">
              {t('landing.heroDesc1')}<br />{t('landing.heroDesc2')}
            </p>
          </div>

          {/* ── Inline Input Box ── */}
          <div ref={inlineInputRef} data-makaron-home-inline-composer="true" className="relative z-10" style={{
            marginTop: '32px', width: '100%', maxWidth: '480px', padding: '0 16px',
            ...(isIOSAppShell && showFixedInput && !selectedDetail ? { opacity: 0, pointerEvents: 'none' as const } : {}),
          }}>
            <CreateInputBox
              input={createInput}
              slotWidth={inlineBoxHeight > 0 ? inlineBoxHeight : 52}
              isInline={true}
              collapseSlot={isGuestSkillAction}
              isDesktop={isDesktop}
              boxRef={inlineBoxRef}
              textareaRef={inlineTextareaRef}
              swipeRef={inlineCardSwipeRef}
              placeholder={placeholders[placeholderIdx]}
              createLabel={skillActionCreateLabel}
              actionMode={isGuestSkillAction}
              actionEyebrow={isGuestSkillAction ? (locale === 'zh' ? '免费预览' : 'Free preview') : undefined}
              actionTitle={skillActionTitle}
              actionSubtitle={skillActionSubtitle}
              actionMeta={skillActionMeta || undefined}
              actionIdleNote={locale === 'zh' ? `需要 ${formatPhotoCount(requiredPhotoCount)}` : `${formatPhotoCount(requiredPhotoCount)} needed`}
              actionSelectedNote={hasEnoughPhotos
                ? (locale === 'zh' ? '可以预览了' : 'Ready to preview')
                : (locale === 'zh' ? `还需要 ${formatPhotoCount(remainingPhotoCount)}` : `${formatPhotoCount(remainingPhotoCount)} more needed`)}
              showLoginIcon={!user}
              onSubmit={handleCreateOrUpload}
              onSlotClick={handleInputSlotClick}
              onFilesSelected={(files) => trackFileSelected(files, 'file_input')}
              onTextareaFocus={keepSkillComposerAboveKeyboard}
              onTextareaBlur={handleHomeTextareaBlur}
              skills={availableSkills}
              selectedSkill={selectedSkill}
              onSkillChange={setSelectedSkill}
              onDeleteSkill={(name) => {
                setAvailableSkills(prev => {
                  const next = prev.filter(s => s.name !== name)
                  writeNativeJSONCache('/api/skills', { skills: next })
                  return next
                })
                fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {})
              }}
              onUploadSkill={() => skillFileRef.current?.click()}
              installingSkill={installingSkill}
              overrideLabel={selectedSkill ? (availableSkills.find(s => s.name === selectedSkill)?.label || homeSkills.find(s => s.id === selectedSkill)?.labels[locale] || null) : null}
              skillDirection="down"
              dragOver={dragOver}
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
            />
          </div>
        </div>

        {/* ── Skill Template Grid ── */}
        <div style={{
          flex: 1,
          paddingLeft: isDesktop ? '24px' : '14px',
          paddingRight: isDesktop ? '24px' : '14px',
          paddingTop: 0,
          paddingBottom: 'calc(160px + env(safe-area-inset-bottom, 0px))',
          maxWidth: isDesktop ? '1200px' : '520px',
          width: '100%',
          margin: '0 auto',
        }}>
          <div style={{ textAlign: 'center', marginBottom: isDesktop ? 24 : 16 }}>
            <h2 style={{
              fontSize: isDesktop ? '1.25rem' : '1.1rem',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.9)',
              margin: 0,
              letterSpacing: '-0.01em',
            }}>{t('skills.title')}</h2>
            <p style={{
              fontSize: isDesktop ? '0.85rem' : '0.78rem',
              color: 'rgba(255,255,255,0.35)',
              margin: '6px 0 0',
              letterSpacing: '0.01em',
            }}>{t('skills.subtitle')}</p>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(2, 1fr)',
            gap: isDesktop ? '14px' : '10px',
          }}>
            {homeSkills.length === 0 && Array.from({ length: 8 }, (_, i) => (
              <div key={`sk-${i}`} className="mkr-skeleton" style={{
                aspectRatio: '3 / 4', borderRadius: 16,
                animationDelay: `${i * 0.1}s`,
              }}>
                <div style={{ position: 'absolute', bottom: 14, left: 14, right: 14 }}>
                  <div className="mkr-skeleton" style={{ width: '60%', height: 14, borderRadius: 6 }} />
                </div>
              </div>
            ))}
            {homeSkills.map((template, i) => (
              <div
                key={template.id}
                className="mkr-skill-card mkr-row-enter"
                onClick={(e) => handleSkillCardClick(template, e)}
                style={{
                  position: 'relative',
                  aspectRatio: '3 / 4',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  background: '#120d1a',
                  border: '1px solid rgba(255,255,255,0.06)',
                  animationDelay: `${i * 0.06}s`,
                  ...(heroRect && selectedDetail?.id === template.id ? { opacity: 0 } : {}),
                }}
              >
                {renderCoverMedia(template.image, template.labels.en || '', 'thumb', { priority: i < 4, extraStyle: { position: 'absolute', display: 'block' } })}

                {/* Bottom gradient for text readability */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 45%)',
                  pointerEvents: 'none',
                }} />

                {/* Label */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '14px',
                }}>
                  <div style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: '#fff',
                    lineHeight: 1.3,
                  }}>
                    {template.labels[locale] || template.labels.en || ''}
                  </div>
                </div>

              </div>
            ))}
          </div>

        </div>

        {/* ── Bottom edge fade — fixed, below input, blends cards into system bar ── */}
        {!isDesktop && (showFixedInput || selectedDetail) && (
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0,
            height: 'calc(env(safe-area-inset-bottom, 0px) + 40px)',
            background: 'linear-gradient(to top, #000 0%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: Z.INPUT - 1,
          }} />
        )}

        {/* ── Bottom Input Box (fixed, slides in when inline is off-screen) ── */}
        <div ref={inputWrapperRef} data-makaron-home-fixed-composer="true" style={{
          position: 'fixed', left: 0, right: 0,
          bottom: textareaFocused && effectiveKbInset > 0 ? `${effectiveKbInset}px` : isDesktop ? '24px' : 'env(safe-area-inset-bottom, 0px)',
          zIndex: Z.INPUT,
          pointerEvents: 'none',
          ...(isDesktop ? {
            padding: '0 24px',
          } : {
            padding: '60px 12px 8px',
          }),
          transform: (showFixedInput || selectedDetail) ? 'translateY(0)' : 'translateY(calc(100% + 20px))',
          transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.2s ease-out',
        }}>
          {/* No gradient overlay — cards show through below */}
          <div style={{ maxWidth: '480px', margin: '0 auto', position: 'relative' }}>
            {/* Mobile only: title + upload slots above input when overlay is open */}
            {selectedDetail && !isDesktop && (
              <div style={{ padding: '0 4px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {renderTemplateLabel(selectedDetail)}
                {renderUploadSlots(selectedDetail, true)}
              </div>
            )}
            <CreateInputBox
              input={createInput}
              slotWidth={photoSlotWidth}
              isInline={false}
              collapseSlot={isGuestSkillAction || (!isDesktop && !!selectedDetail)}
              isDesktop={isDesktop}
              boxRef={inputBoxRef}
              textareaRef={textareaRef}
              swipeRef={cardSwipeRef}
              placeholder={placeholders[placeholderIdx]}
              createLabel={skillActionCreateLabel}
              actionMode={isGuestSkillAction}
              actionEyebrow={isGuestSkillAction ? (locale === 'zh' ? '免费预览' : 'Free preview') : undefined}
              actionTitle={skillActionTitle}
              actionSubtitle={skillActionSubtitle}
              actionMeta={skillActionMeta || undefined}
              actionIdleNote={locale === 'zh' ? `需要 ${formatPhotoCount(requiredPhotoCount)}` : `${formatPhotoCount(requiredPhotoCount)} needed`}
              actionSelectedNote={hasEnoughPhotos
                ? (locale === 'zh' ? '可以预览了' : 'Ready to preview')
                : (locale === 'zh' ? `还需要 ${formatPhotoCount(remainingPhotoCount)}` : `${formatPhotoCount(remainingPhotoCount)} more needed`)}
              showLoginIcon={!user}
              onSubmit={handleCreateOrUpload}
              onSlotClick={handleInputSlotClick}
              onFilesSelected={(files) => trackFileSelected(files, 'file_input')}
              onTextareaFocus={keepSkillComposerAboveKeyboard}
              onTextareaBlur={handleHomeTextareaBlur}
              skills={availableSkills}
              selectedSkill={selectedSkill}
              onSkillChange={setSelectedSkill}
              onDeleteSkill={(name) => {
                setAvailableSkills(prev => {
                  const next = prev.filter(s => s.name !== name)
                  writeNativeJSONCache('/api/skills', { skills: next })
                  return next
                })
                fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {})
              }}
              onUploadSkill={() => skillFileRef.current?.click()}
              installingSkill={installingSkill}
              overrideLabel={selectedSkill ? (availableSkills.find(s => s.name === selectedSkill)?.label || homeSkills.find(s => s.id === selectedSkill)?.labels[locale] || null) : null}
              skillDirection="up"
              dragOver={dragOver}
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
            />
          </div>
        </div>
        <LiquidGlassNav active="explore" hidden={showFixedInput || !!selectedDetail} />
        </div>

        {showGuestModeToggle && (
          <ModeToggle
            mode={viewMode}
            onToggle={setViewMode}
            hidden={viewMode === 'human' && (showFixedInput || !!selectedDetail)}
          />
        )}
      </div>

      {/* ── Hero fly image (card → fullscreen/card) ── */}
      {heroRect && selectedDetail && (() => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800
        const cardW = 440
        const cardH = vh * 0.75
        const pb = inputWrapperHeight + 16
        const targetTop = isDesktop ? Math.max(0, (vh - cardH - pb) / 2) : 0
        const targetLeft = isDesktop ? (vw - cardW) / 2 : 0
        const targetW = isDesktop ? cardW : vw
        const targetH = isDesktop ? cardH : vh
        return (
          <div style={{
            position: 'fixed', zIndex: Z.HERO_FLY, pointerEvents: 'none',
            top: heroExpanded ? targetTop : heroRect.top,
            left: heroExpanded ? targetLeft : heroRect.left,
            width: heroExpanded ? targetW : heroRect.width,
            height: heroExpanded ? targetH : heroRect.height,
            borderRadius: heroExpanded ? (isDesktop ? 24 : 0) : 16,
            overflow: 'hidden',
            transition: 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
            opacity: heroExpanded ? 0 : 1,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {renderCoverMedia(selectedDetail.image, '', 'hero', { priority: true, extraStyle: { position: 'absolute' } })}
          </div>
        )
      })()}

      {/* Preload all before_images thumbnails so they appear instantly when user scrolls
          between skill slides (overlay virtualization caches only ±window, but before images
          are tiny and we always want them ready). */}
      {selectedDetail && (
        <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {homeSkills.flatMap(s => (s.before_images || []).slice(0, 3)).map((url, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={`preload-${i}`} src={getThumbnailUrl(url, 200, 60, 250, 'cover')} alt="" />
          ))}
        </div>
      )}

      {/* ── Skill Detail Overlay ── */}
      {selectedDetail && (
        <div
          onTouchStartCapture={handleSkillBackPanStart}
          onTouchMoveCapture={handleSkillBackPanMove}
          onTouchEndCapture={handleSkillBackPanEnd}
          onTouchCancelCapture={resetSkillBackPan}
          onClick={(e) => { if (isDesktop && e.target === e.currentTarget) closeSkillDetail('pushHome') }}
          style={{
            position: 'fixed', inset: 0, zIndex: Z.OVERLAY,
            background: isDesktop ? 'rgba(0,0,0,0.7)' : '#000',
            opacity: heroExpanded ? 1 : 0,
            pointerEvents: heroExpanded ? 'auto' : 'none',
            transform: isDesktop ? undefined : `translate3d(${skillBackPanX}px, 0, 0)`,
            transition: skillBackPanSettling
              ? 'opacity 0.3s ease 0.1s, transform 180ms ease-out'
              : 'opacity 0.3s ease 0.1s',
            willChange: skillBackPanActive || skillBackPanSettling ? 'transform, opacity' : 'opacity',
            touchAction: isDesktop ? undefined : 'pan-y',
            ...(isDesktop ? {
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              paddingBottom: inputWrapperHeight + 16,
              transition: 'padding-bottom 0.15s ease',
            } : {}),
          }}
        >
          {/* Desktop: centered card container / Mobile: full screen */}
          <div style={{
            ...(isDesktop ? {
              position: 'relative',
              width: 'min(560px, 50vw, 60vh)', maxHeight: '80vh', aspectRatio: '3 / 4',
              borderRadius: '24px', overflow: 'hidden',
              background: '#000',
            } : {
              position: 'absolute', inset: 0,
            }),
          }}>
            {/* Share button — top left */}
            <button
              onClick={async () => {
                const url = `${window.location.origin}/home/${selectedDetail.id}`
                const title = selectedDetail.labels[locale] || selectedDetail.labels.en || 'Makaron'
                if (navigator.share) {
                  try { await navigator.share({ url, title }) } catch {}
                } else {
                  try { await navigator.clipboard.writeText(url) } catch {
                    const ta = document.createElement('textarea')
                    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy')
                    document.body.removeChild(ta)
                  }
                  setShareToast(true)
                  setTimeout(() => setShareToast(false), 2000)
                }
              }}
              style={{
                position: 'absolute', top: isDesktop ? 12 : 'max(12px, env(safe-area-inset-top))', left: 12,
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                border: 'none', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 10,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>

            {/* Close button — top right */}
            <button
              onClick={() => closeSkillDetail('pushHome')}
              style={{
                position: 'absolute', top: isDesktop ? 12 : 'max(12px, env(safe-area-inset-top))', right: 12,
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                border: 'none', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 10, fontSize: '1.1rem',
              }}
            >✕</button>

            {/* Share toast */}
            {shareToast && (
              <div style={{
                position: 'absolute', top: isDesktop ? 60 : 'calc(max(12px, env(safe-area-inset-top)) + 48px)', left: 12,
                background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                color: '#fff', fontSize: 13, padding: '6px 14px', borderRadius: 8,
                zIndex: 11, whiteSpace: 'nowrap',
              }}>
                Link copied
              </div>
            )}

            {/* Slide container — JS touch handlers instead of CSS scroll-snap
                to avoid iOS Safari video compositor blocking native scroll. */}
            <div
              ref={detailSnapCallbackRef}
              className="mkr-detail-snap"
              onTouchStart={(e) => {
                const touch = e.touches[0]
                if (!touch) return
                detailSwipeRef.current = { startY: touch.clientY, startIdx: homeSkills.findIndex(s => s.id === selectedDetail?.id), swiping: false }
              }}
              onTouchMove={(e) => {
                if (!detailSwipeRef.current) return
                const touch = e.touches[0]
                if (!touch) return
                const deltaY = touch.clientY - detailSwipeRef.current.startY
                if (!detailSwipeRef.current.swiping && Math.abs(deltaY) > 20) detailSwipeRef.current.swiping = true
                if (detailSwipeRef.current.swiping) {
                  e.preventDefault()
                  if (detailInnerRef.current && detailSnapRef.current) {
                    const idx = detailSwipeRef.current.startIdx
                    const slideH = detailSnapRef.current.clientHeight
                    detailInnerRef.current.style.transform = `translateY(${-idx * slideH + deltaY}px)`
                    detailInnerRef.current.style.transition = 'none'
                  }
                }
              }}
              onTouchEnd={(e) => {
                if (!detailSwipeRef.current) return
                const touch = e.changedTouches[0]
                if (!touch) { detailSwipeRef.current = null; return }
                const deltaY = touch.clientY - detailSwipeRef.current.startY
                const threshold = 60
                let newIdx = detailSwipeRef.current.startIdx
                if (deltaY < -threshold && newIdx < homeSkills.length - 1) newIdx++
                else if (deltaY > threshold && newIdx > 0) newIdx--
                if (detailInnerRef.current && detailSnapRef.current) {
                  const slideH = detailSnapRef.current.clientHeight
                  detailInnerRef.current.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)'
                  detailInnerRef.current.style.transform = `translateY(${-newIdx * slideH}px)`
                }
                if (newIdx !== detailSwipeRef.current.startIdx) {
                  const t = homeSkills[newIdx]
                  if (t) {
                    setSelectedDetail(t)
                    setSelectedSkill(t.skill_path ? t.id : null)
                    createInput.clear()
                    createInput.setText(t.prompt)
                    detailPathActiveRef.current = true
                    writeSkillDetailPath(t.id, 'replace')
                  }
                }
                detailSwipeRef.current = null
              }}
              onWheel={(e) => {
                if (wheelCooldownRef.current) return
                if (Math.abs(e.deltaY) < 20) return
                const currentIdx = homeSkills.findIndex(s => s.id === selectedDetail?.id)
                let newIdx = currentIdx
                if (e.deltaY > 0 && newIdx < homeSkills.length - 1) newIdx++
                else if (e.deltaY < 0 && newIdx > 0) newIdx--
                if (newIdx === currentIdx) return
                wheelCooldownRef.current = true
                setTimeout(() => { wheelCooldownRef.current = false }, 400)
                if (detailInnerRef.current && detailSnapRef.current) {
                  const slideH = detailSnapRef.current.clientHeight
                  detailInnerRef.current.style.transition = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)'
                  detailInnerRef.current.style.transform = `translateY(${-newIdx * slideH}px)`
                }
                const t = homeSkills[newIdx]
                if (t) {
                  setSelectedDetail(t)
                  setSelectedSkill(t.skill_path ? t.id : null)
                  createInput.clear()
                  createInput.setText(t.prompt)
                  detailPathActiveRef.current = true
                  writeSkillDetailPath(t.id, 'replace')
                }
              }}
              style={{
                position: 'absolute', inset: 0,
                overflow: 'hidden',
                touchAction: 'none',
              }}
            >
            <div ref={detailInnerRef} style={{ position: 'relative', width: '100%', height: '100%', willChange: 'transform' }}>
            {(() => {
              const activeIdx = Math.max(0, homeSkills.findIndex(s => s.id === selectedDetail?.id))
              // Window: 4 before + active + 5 after = 10 slides rendered at most.
              const WINDOW_BEFORE = 4
              const WINDOW_AFTER = 5
              return homeSkills.map((template, i) => {
                const inWindow = i >= activeIdx - WINDOW_BEFORE && i <= activeIdx + WINDOW_AFTER
                return (
                  <div
                    key={template.id}
                    className="mkr-detail-slide"
                    data-skill-id={template.id}
                    style={{ position: 'absolute', top: `${i * 100}%`, left: 0, width: '100%', height: '100%' }}
                  >
                    {inWindow && renderCoverMedia(template.image, '', 'detail', { priority: template.id === selectedDetail?.id })}
                    {inWindow && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 30%, transparent 55%)', pointerEvents: 'none' }} />}

                    {/* Desktop: title + upload slots inside card */}
                    {inWindow && isDesktop && (
                      <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, zIndex: 1 }}>
                        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {renderTemplateLabel(template)}
                          {template.id === selectedDetail?.id && renderUploadSlots(template, true)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
          </div>
          </div>
        </div>
      )}

      {/* Skill menu now handled by SkillSelector component */}

      {/* Welcome credits popup */}
      {showWelcome && welcomeCredits > 0 && (
        <>
          <div onClick={() => setShowWelcome(false)} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} />
          <div style={{
            position: 'fixed', zIndex: 301, left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: '92%', maxWidth: 400, background: 'linear-gradient(180deg, #18181b 0%, #0f0f12 100%)',
            borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.8)', padding: '48px 24px 36px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
              {locale === 'zh' ? '欢迎来到 Makaron!' : 'Welcome to Makaron!'}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
              {locale === 'zh' ? '我们送了你一份创作礼物' : "Here's a gift to get you started"}
            </div>
            <div style={{
              marginTop: 24, padding: '20px 0', borderRadius: 16,
              background: 'rgba(192,38,211,0.06)', border: '1px solid rgba(192,38,211,0.15)',
            }}>
              <div style={{
                fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em',
                background: 'linear-gradient(135deg, #e879f9, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {welcomeCredits.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                credits · ${(welcomeCredits * 0.01).toFixed(2)} {locale === 'zh' ? '价值' : 'value'}
              </div>
            </div>
            <button
              onClick={() => setShowWelcome(false)}
              style={{
                width: '100%', marginTop: 24, padding: 14, borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)',
                color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(217,70,239,0.3)',
              }}
            >
              {locale === 'zh' ? '开始创作' : 'Start Creating'}
            </button>
          </div>
        </>
      )}
    </>
  )
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="mkr-spin" width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="rgba(217,70,239,0.12)" strokeWidth="2.5" fill="none" />
      <path fill="rgba(217,70,239,0.7)" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
