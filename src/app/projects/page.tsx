'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { Suspense, type CSSProperties } from 'react'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getCachedImages, getCachedProjectsListSync, getCachedProjectsList, getLastProjectsListSync, cacheProjectsList } from '@/lib/imageCache'
import { isHeicFile } from '@/lib/imageUtils'
import { useLocale } from '@/lib/i18n'
import { getOriginFormatThumbnailUrl, getThumbnailUrl } from '@/lib/supabase/storage'
import { createProject } from '@/lib/createProject'
import RollingTagline from '@/components/RollingTagline'
import TopBar from '@/components/TopBar'
import { useCreateInput } from '@/hooks/useCreateInput'
import CreateInputBox from '@/components/CreateInputBox'
import { MakaronSpark } from '@/components/MakaronLogo'
import ProjectEditorContainer from '@/components/ProjectEditorContainer'

interface ProjectWithSnapshots {
  id: string
  title: string
  cover_url: string | null
  updated_at: string
  created_at: string
  snapshots: { id: string; image_url: string; sort_order: number }[]
  hasVideo?: boolean
}

// Skill type for client-side rendering
interface SkillItem {
  name: string;
  label: string;
  icon: string;
  color: string;
  builtIn: boolean;
}

const IOS_PROJECT_PAN_EDGE_PX = 36
const IOS_PROJECT_PAN_COMMIT_PX = 86
const IOS_PROJECT_PAN_MIN_DX = 10
const IOS_PROJECT_OVERLAY_CLOSE_MS = 190
const IOS_PROJECT_RETURN_REFRESH_GUARD_MS = 1200
const IOS_PROJECT_AUTH_GRACE_MS = 1800
const IOS_PROJECT_NAV_LOG_SESSION_KEY = 'makaron:ios-project-nav-log'

function isMakaronIOSAppShell() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') return false
  const capacitor = (window as typeof window & {
    Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean }
  }).Capacitor
  const isCapacitorIOS = Boolean(capacitor?.isNativePlatform?.() && capacitor.getPlatform?.() === 'ios')
  return isCapacitorIOS
    || document.documentElement.dataset.nativePlatform === 'ios'
    || document.documentElement.classList.contains('makaron-ios-app')
    || navigator.userAgent.includes('MakaronIOS')
}

function logIOSProjectNav(event: string, data?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !isMakaronIOSAppShell()) return
  const target = window as typeof window & {
    __makaronIOSProjectNavLog?: Array<{ event: string; t: number; data?: Record<string, unknown> }>
  }
  const state = {
    href: window.location.href,
    scrollY: Math.round(window.scrollY),
    innerHeight: Math.round(window.innerHeight),
    docHeight: Math.round(document.documentElement.scrollHeight),
    bodyHeight: Math.round(document.body.scrollHeight),
    cardCount: document.querySelectorAll('.mkr-card').length,
    hasProjectsPage: Boolean(document.querySelector('.makaron-projects-page')),
    hasEditor: Boolean(document.querySelector('[data-testid="editor"]')),
    hasOverlay: Boolean(document.querySelector('[data-makaron-ios-project-overlay="true"]')),
    hasHiddenEditor: Boolean(document.querySelector('[data-makaron-ios-project-overlay="true"][aria-hidden="true"]')),
  }
  const entry = { event, t: Math.round(performance.now()), data: { ...state, ...data } }
  target.__makaronIOSProjectNavLog = [...(target.__makaronIOSProjectNavLog ?? []).slice(-80), entry]
  try {
    const previous = JSON.parse(sessionStorage.getItem(IOS_PROJECT_NAV_LOG_SESSION_KEY) || '[]') as typeof target.__makaronIOSProjectNavLog
    sessionStorage.setItem(IOS_PROJECT_NAV_LOG_SESSION_KEY, JSON.stringify([...(previous ?? []), entry].slice(-80)))
  } catch {
    // Debug logging must never affect navigation.
  }
  console.info('[ios-project-nav]', event, entry.data)
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export default function ProjectsPage() {
  return <Suspense><ProjectsPageInner /></Suspense>
}

function ProjectsPageInner() {
  const { user, loading: authLoading } = useAuth()
  const { t, locale } = useLocale()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const userId = user?.id
  // Phase 1: Synchronous memory cache — same-session instant render
  const [projects, setProjects] = useState<ProjectWithSnapshots[]>(() => {
    if (typeof window === 'undefined') return []
    const cachedUserId = user?.id
    if (!cachedUserId) {
      return isMakaronIOSAppShell()
        ? ((getLastProjectsListSync()?.projects as ProjectWithSnapshots[] | undefined) ?? [])
        : []
    }
    return (getCachedProjectsListSync(cachedUserId) as ProjectWithSnapshots[]) ?? []
  })
  const [loadingProjects, setLoadingProjects] = useState(() => {
    if (typeof window === 'undefined') return true
    const cachedUserId = user?.id
    if (!cachedUserId) {
      return !(isMakaronIOSAppShell() && (getLastProjectsListSync()?.projects.length ?? 0) > 0)
    }
    return getCachedProjectsListSync(cachedUserId) === null
  })
  const createInput = useCreateInput()
  const inputBoxRef = useRef<HTMLDivElement>(null)
  const extractedMetadataRef = useRef<import('@/types').PhotoMetadata | undefined>(undefined)
  const [photoSlotWidth, setPhotoSlotWidth] = useState(80)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [availableSkills, setAvailableSkills] = useState<SkillItem[]>([])
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  const [showWelcome, setShowWelcome] = useState(false)
  const [, setSkillUploading] = useState(false)
  const [, setSkillUploadError] = useState<string | null>(null)
  const handleSkillUpload = useCallback(async (file: File) => {
    setSkillUploading(true)
    setSkillUploadError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/skills', { method: 'POST', body: form })
      const data = await res.json()
      if (data.success) {
        const r = await fetch('/api/skills')
        const d = await r.json()
        if (d.skills) setAvailableSkills(d.skills)
      } else {
        setSkillUploadError(data.error || 'Upload failed')
        setTimeout(() => setSkillUploadError(null), 3000)
      }
    } catch (err) {
      setSkillUploadError('Upload failed')
      setTimeout(() => setSkillUploadError(null), 3000)
      console.error('Skill upload error:', err)
    } finally {
      setSkillUploading(false)
    }
  }, [])
  // Prefetch skills during idle time so they're ready when user expands
  const skillsFetchedRef = useRef(false)
  useEffect(() => {
    if (skillsFetchedRef.current) return
    const load = () => {
      skillsFetchedRef.current = true
      fetch('/api/skills').then(r => r.json()).then(d => {
        if (d.skills) setAvailableSkills(d.skills)
      }).catch(() => {})
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(load, { timeout: 5000 })
      return () => cancelIdleCallback(id)
    }
    // Safari fallback
    const t = setTimeout(load, 2000)
    return () => clearTimeout(t)
  }, [])
  // Auto-select skill from URL param (after claim redirect). Read from the
  // browser URL directly so iOS inline project navigation never subscribes
  // this page to Next search-param router updates.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const skillParam = new URLSearchParams(window.location.search).get('skill')
    if (skillParam && availableSkills.length > 0) {
      const match = availableSkills.find(s => s.name === skillParam)
      if (match) {
        setSelectedSkill(match.name)
      }
      window.history.replaceState({}, '', '/projects')
    }
  }, [availableSkills])

  const skillFileRef = useRef<HTMLInputElement>(null)

  const [actionSheet, setActionSheet] = useState<ProjectWithSnapshots | null>(null)
  const [navigating, setNavigating] = useState(false)
  const [iosAppShell, setIosAppShell] = useState(() => isMakaronIOSAppShell())
  const [projectsRefreshNonce, setProjectsRefreshNonce] = useState(0)
  const shownRef = useRef(!loadingProjects) // tracks whether we've shown content
  const projectsRef = useRef(projects)
  const loadingProjectsRef = useRef(loadingProjects)
  const [activeIOSProjectId, setActiveIOSProjectId] = useState<string | null>(null)
  const [renderedIOSProjectId, setRenderedIOSProjectId] = useState<string | null>(null)
  const activeIOSProjectIdRef = useRef<string | null>(null)
  const renderedIOSProjectIdRef = useRef<string | null>(null)
  const [iosProjectX, setIosProjectX] = useState(0)
  const [iosProjectSettling, setIosProjectSettling] = useState(false)
  const [iosProjectPanActive, setIosProjectPanActive] = useState(false)
  const iosProjectOverlayRef = useRef<HTMLDivElement | null>(null)
  const iosProjectPanRef = useRef({ tracking: false, startX: 0, startY: 0, lastX: 0, startTime: 0, locked: false })
  const iosProjectCloseTimerRef = useRef<number | null>(null)
  const iosProjectClosingRef = useRef(false)
  const iosProjectScrollYRef = useRef(0)
  const pendingIOSProjectsRefreshRef = useRef<ProjectWithSnapshots[] | null>(null)
  const pendingIOSProjectsRefreshTimerRef = useRef<number | null>(null)
  const iosProjectReturnFreezeUntilRef = useRef(0)
  const iosProjectAuthGraceUntilRef = useRef(0)
  const iosProjectNavGenerationRef = useRef(0)
  const iosReturnSelfTestStartedRef = useRef(false)
  const iosRefreshSelfTestStartedRef = useRef(false)
  const lastProjectsRefreshRequestRef = useRef(0)
  const projectsPageInstanceIdRef = useRef(`projects-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

  const clearIOSProjectCloseTimer = useCallback(() => {
    if (iosProjectCloseTimerRef.current === null) return
    window.clearTimeout(iosProjectCloseTimerRef.current)
    iosProjectCloseTimerRef.current = null
  }, [])

  const clearPendingIOSProjectsRefreshTimer = useCallback(() => {
    if (pendingIOSProjectsRefreshTimerRef.current === null) return
    window.clearTimeout(pendingIOSProjectsRefreshTimerRef.current)
    pendingIOSProjectsRefreshTimerRef.current = null
  }, [])

  const requestProjectsRefresh = useCallback((reason: string) => {
    if (typeof window === 'undefined') return
    const now = performance.now()
    if (now - lastProjectsRefreshRequestRef.current < 500) return
    lastProjectsRefreshRequestRef.current = now
    logIOSProjectNav('projects-background-refresh-requested', { reason })
    setProjectsRefreshNonce((nonce) => nonce + 1)
  }, [])

  const applyProjectsRefresh = useCallback((nextProjects: ProjectWithSnapshots[]) => {
    const schedulePendingFlush = () => {
      if (typeof window === 'undefined') return
      clearPendingIOSProjectsRefreshTimer()
      const delay = Math.max(32, iosProjectReturnFreezeUntilRef.current - performance.now() + 32)
      pendingIOSProjectsRefreshTimerRef.current = window.setTimeout(() => {
        pendingIOSProjectsRefreshTimerRef.current = null
        const pending = pendingIOSProjectsRefreshRef.current
        if (!pending) return
        const stillFrozen = activeIOSProjectIdRef.current
          || performance.now() < iosProjectReturnFreezeUntilRef.current
        if (stillFrozen) {
          schedulePendingFlush()
          return
        }
        pendingIOSProjectsRefreshRef.current = null
        shownRef.current = true
        logIOSProjectNav('projects-stashed-refresh-applied', { count: pending.length })
        setProjects(pending)
        setLoadingProjects(false)
      }, delay)
    }

    const isFrozenIOSReturn = isMakaronIOSAppShell()
      && (
        activeIOSProjectIdRef.current
        || performance.now() < iosProjectReturnFreezeUntilRef.current
      )
    const needsInitialProjects = loadingProjectsRef.current && projectsRef.current.length === 0

    if (isFrozenIOSReturn && !needsInitialProjects) {
      logIOSProjectNav('projects-refresh-stashed', {
        activeProjectId: activeIOSProjectIdRef.current,
        frozenUntil: iosProjectReturnFreezeUntilRef.current,
        count: nextProjects.length,
      })
      pendingIOSProjectsRefreshRef.current = nextProjects
      schedulePendingFlush()
      return
    }

    pendingIOSProjectsRefreshRef.current = null
    clearPendingIOSProjectsRefreshTimer()
    shownRef.current = true
    logIOSProjectNav('projects-refresh-applied', { count: nextProjects.length, duringFrozenReturn: isFrozenIOSReturn, needsInitialProjects })
    setProjects(nextProjects)
    setLoadingProjects(false)
  }, [clearPendingIOSProjectsRefreshTimer])

  const openIOSProject = useCallback((projectId: string) => {
    if (typeof window === 'undefined') return
    clearIOSProjectCloseTimer()
    clearPendingIOSProjectsRefreshTimer()
    iosProjectClosingRef.current = false
    iosProjectNavGenerationRef.current += 1
    pendingIOSProjectsRefreshRef.current = null
    iosProjectScrollYRef.current = window.scrollY
    logIOSProjectNav('open-project', { projectId, scrollY: iosProjectScrollYRef.current })
    activeIOSProjectIdRef.current = projectId
    renderedIOSProjectIdRef.current = projectId
    setRenderedIOSProjectId(projectId)
    setActiveIOSProjectId(projectId)
    setIosProjectSettling(true)
    setIosProjectPanActive(false)
    setIosProjectX(window.innerWidth)
    window.requestAnimationFrame(() => setIosProjectX(0))
  }, [clearIOSProjectCloseTimer, clearPendingIOSProjectsRefreshTimer])

  const replaceIOSProject = useCallback((projectId: string) => {
    if (typeof window === 'undefined') return
    clearIOSProjectCloseTimer()
    iosProjectClosingRef.current = false
    logIOSProjectNav('replace-project', { projectId })
    activeIOSProjectIdRef.current = projectId
    renderedIOSProjectIdRef.current = projectId
    setRenderedIOSProjectId(projectId)
    setActiveIOSProjectId(projectId)
    setIosProjectSettling(false)
    setIosProjectPanActive(false)
    setIosProjectX(0)
  }, [clearIOSProjectCloseTimer])

  const refreshIOSProjectCard = useCallback(async (projectId: string) => {
    if (!userId) return
    try {
      const supabase = createClient()
      const { data: projectRow, error: projectError } = await supabase
        .from('projects')
        .select('id, title, cover_url, updated_at, created_at')
        .eq('id', projectId)
        .eq('user_id', userId)
        .maybeSingle()

      if (projectError) {
        console.warn('Failed to refresh iOS project card:', projectError)
        return
      }

      const [{ data: snapshotRows }, { data: animRows }, { data: videoSnaps }] = await Promise.all([
        supabase.from('snapshots')
          .select('id, project_id, image_url, sort_order')
          .eq('project_id', projectId)
          .order('sort_order', { ascending: true })
          .limit(3000),
        supabase.from('project_animations')
          .select('project_id')
          .eq('project_id', projectId)
          .eq('status', 'completed'),
        supabase.from('snapshots')
          .select('project_id')
          .eq('project_id', projectId)
          .eq('type', 'video'),
      ])

      const nextProject = projectRow
        ? {
            ...projectRow,
            snapshots: (snapshotRows ?? []).map((s) => ({
              id: s.id,
              image_url: s.image_url,
              sort_order: s.sort_order,
            })),
            hasVideo: Boolean(animRows?.length || videoSnaps?.length),
          }
        : null

      setProjects((current) => {
        const index = current.findIndex((project) => project.id === projectId)
        const next = nextProject && nextProject.snapshots.length > 0
          ? index >= 0
            ? current.map((project) => project.id === projectId ? nextProject : project)
            : [nextProject, ...current]
          : current.filter((project) => project.id !== projectId)
        projectsRef.current = next
        cacheProjectsList(userId, next)
        return next
      })
      logIOSProjectNav('project-card-refreshed-after-return', {
        projectId,
        snapshots: nextProject?.snapshots.length ?? 0,
      })
    } catch (err) {
      console.warn('Failed to refresh iOS project card:', err)
    }
  }, [userId])

  const closeIOSProject = useCallback(() => {
    if (!activeIOSProjectIdRef.current || typeof window === 'undefined') return
    if (iosProjectClosingRef.current) {
      logIOSProjectNav('close-project-ignored-already-closing', { projectId: activeIOSProjectIdRef.current })
      return
    }
    iosProjectClosingRef.current = true
    const closingProjectId = activeIOSProjectIdRef.current
    logIOSProjectNav('close-project-start', { projectId: closingProjectId, scrollY: iosProjectScrollYRef.current })
    iosProjectReturnFreezeUntilRef.current = performance.now() + IOS_PROJECT_RETURN_REFRESH_GUARD_MS
    iosProjectAuthGraceUntilRef.current = performance.now() + IOS_PROJECT_AUTH_GRACE_MS
    clearIOSProjectCloseTimer()
    setIosProjectSettling(true)
    setIosProjectPanActive(false)
    setIosProjectX(window.innerWidth)
    iosProjectCloseTimerRef.current = window.setTimeout(() => {
      iosProjectCloseTimerRef.current = null
      activeIOSProjectIdRef.current = null
      iosProjectClosingRef.current = false
      iosProjectNavGenerationRef.current += 1
      setActiveIOSProjectId(null)
      setIosProjectX(0)
      setIosProjectSettling(false)
      logIOSProjectNav('close-project-commit', {
        scrollY: iosProjectScrollYRef.current,
        frozenUntil: iosProjectReturnFreezeUntilRef.current,
      })
      window.scrollTo(0, iosProjectScrollYRef.current)
      logIOSProjectNav('editor-retained-hidden-after-return', { projectId: closingProjectId })
      void refreshIOSProjectCard(closingProjectId)
      window.setTimeout(() => requestProjectsRefresh('ios-project-return'), 32)
    }, IOS_PROJECT_OVERLAY_CLOSE_MS)
  }, [clearIOSProjectCloseTimer, refreshIOSProjectCard, requestProjectsRefresh])

  useEffect(() => {
    const detect = () => setIosAppShell(isMakaronIOSAppShell())
    detect()
    const timer = window.setTimeout(detect, 250)
    return () => window.clearTimeout(timer)
  }, [])

  const handleProjectNavigate = useCallback((event: React.MouseEvent<HTMLElement>, project: ProjectWithSnapshots) => {
    if (iosAppShell || isMakaronIOSAppShell()) {
      event.preventDefault()
      setNavigating(false)
      openIOSProject(project.id)
      return
    }
    setNavigating(true)
  }, [iosAppShell, openIOSProject])
  const useIOSInlineProjectNavigation = iosAppShell || isMakaronIOSAppShell()

  const [renameValue, setRenameValue] = useState('')
  const [renameMode, setRenameMode] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const openActionSheet = useCallback((e: React.MouseEvent, project: ProjectWithSnapshots) => {
    e.stopPropagation()
    setActionSheet(project)
    setRenameValue(project.title)
    setRenameMode(false)
  }, [])

  const handleDelete = useCallback(() => {
    if (!actionSheet) return
    // Optimistic: remove from UI and close sheet immediately
    const projectId = actionSheet.id
    setProjects(prev => prev.filter(p => p.id !== projectId))
    setActionSheet(null)
    // Delete from DB in background (fire-and-forget)
    Promise.resolve().then(async () => {
      try {
        const supabase = createClient()
        await Promise.all([
          supabase.from('messages').delete().eq('project_id', projectId),
          supabase.from('snapshots').delete().eq('project_id', projectId),
        ])
        await supabase.from('projects').delete().eq('id', projectId)
      } catch (err) {
        console.error('Delete project error:', err)
      }
    })
  }, [actionSheet])

  const handleRename = useCallback(async () => {
    if (!actionSheet || !renameValue.trim()) return
    const newTitle = renameValue.trim()
    const supabase = createClient()
    await supabase.from('projects').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', actionSheet.id)
    setProjects(prev => prev.map(p => p.id === actionSheet.id ? { ...p, title: newTitle } : p))
    setActionSheet(null)
  }, [actionSheet, renameValue])

  const canHoldIOSProjectsDuringAuthGap = useIOSInlineProjectNavigation
    && projects.length > 0
    && typeof performance !== 'undefined'
    && performance.now() < iosProjectAuthGraceUntilRef.current
  const canHoldCachedIOSProjectsWithoutUser = useIOSInlineProjectNavigation
    && projects.length > 0
    && !user

  useEffect(() => {
    if (authLoading || user) return
    if (canHoldCachedIOSProjectsWithoutUser) {
      logIOSProjectNav('auth-empty-held-with-cached-projects')
      return
    }
    if (canHoldIOSProjectsDuringAuthGap) {
      const remaining = Math.max(0, iosProjectAuthGraceUntilRef.current - performance.now())
      logIOSProjectNav('auth-gap-held-after-return', { remaining: Math.round(remaining) })
      const timer = window.setTimeout(() => {
        if (!activeIOSProjectIdRef.current) router.replace('/login')
      }, remaining + 20)
      return () => window.clearTimeout(timer)
    }
    router.replace('/login')
  }, [user, authLoading, router, canHoldIOSProjectsDuringAuthGap, canHoldCachedIOSProjectsWithoutUser])

  useEffect(() => {
    activeIOSProjectIdRef.current = activeIOSProjectId
  }, [activeIOSProjectId])

  useEffect(() => {
    renderedIOSProjectIdRef.current = renderedIOSProjectId
  }, [renderedIOSProjectId])

  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    loadingProjectsRef.current = loadingProjects
  }, [loadingProjects])

  useEffect(() => () => {
    clearIOSProjectCloseTimer()
    clearPendingIOSProjectsRefreshTimer()
  }, [clearIOSProjectCloseTimer, clearPendingIOSProjectsRefreshTimer])

  useEffect(() => {
    if (!useIOSInlineProjectNavigation || typeof window === 'undefined') return
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (activeIOSProjectIdRef.current) return
      requestProjectsRefresh('ios-projects-visible')
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [useIOSInlineProjectNavigation, requestProjectsRefresh])

  useEffect(() => {
    const overlay = iosProjectOverlayRef.current
    if (!overlay || !activeIOSProjectId) return

    const blockNativeBackSwipe = (event: TouchEvent) => {
      if (!activeIOSProjectIdRef.current || event.touches.length !== 1) return
      if (isCuiOpen()) return
      if (isIOSProjectPanEditableTarget(event.target)) return
      if (event.touches[0].clientX > IOS_PROJECT_PAN_EDGE_PX) return

      event.preventDefault()
    }

    overlay.addEventListener('touchstart', blockNativeBackSwipe, { capture: true, passive: false })
    return () => overlay.removeEventListener('touchstart', blockNativeBackSwipe, { capture: true })
  }, [activeIOSProjectId])

  // Measure input box height → set photo slot width = height (square)
  useEffect(() => {
    const el = inputBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setPhotoSlotWidth(Math.round(entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Phase 2: Async IndexedDB cache (cross-session persistence, no auth dependency)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getCachedProjectsList(userId).then((cached) => {
      if (cancelled || shownRef.current || !cached) return
      applyProjectsRefresh(cached as ProjectWithSnapshots[])
    })
    return () => { cancelled = true }
  }, [userId, applyProjectsRefresh])

  // Phase 3: Supabase fetch (always runs when user is available, refreshes cache)
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    let cancelled = false

    async function fetchProjects() {
      try {
        const fetchNavGeneration = iosProjectNavGenerationRef.current
        const { data: projectRows, error: pErr } = await supabase
          .from('projects')
          .select('id, title, cover_url, updated_at, created_at')
          .eq('user_id', userId!)
          .order('created_at', { ascending: false })

        if (cancelled) return
        if (isMakaronIOSAppShell() && fetchNavGeneration !== iosProjectNavGenerationRef.current && projectsRef.current.length > 0) {
          logIOSProjectNav('projects-fetch-discarded-nav-generation-changed', {
            fetchNavGeneration,
            currentNavGeneration: iosProjectNavGenerationRef.current,
            phase: 'projects',
          })
          return
        }

        if (pErr || !projectRows) {
          console.error('Failed to fetch projects:', pErr)
          if (!shownRef.current) setLoadingProjects(false)
          return
        }

        if (projectRows.length === 0) {
          cacheProjectsList(userId!, [])
          applyProjectsRefresh([])
          return
        }

        // Fetch all snapshots (incremental optimization based on current displayed projects)
        const currentProjects = projectsRef.current
        const currentMap = new Map(currentProjects.map(p => [p.id, p]))
        const staleIds = projectRows
          .filter(p => {
            const cached = currentMap.get(p.id)
            return !cached || cached.updated_at !== p.updated_at
          })
          .map(p => p.id)

        const staleSet = new Set(staleIds)
        const snapshotMap = new Map<string, { id: string; image_url: string; sort_order: number }[]>()
        for (const [id, p] of currentMap) {
          if (!staleSet.has(id)) snapshotMap.set(id, p.snapshots)
        }

        if (staleIds.length > 0) {
          // Fetch snapshots in parallel batches (Supabase default limit is 1000 rows)
          const BATCH = 30
          const batches: string[][] = []
          for (let i = 0; i < staleIds.length; i += BATCH) batches.push(staleIds.slice(i, i + BATCH))
          const results = await Promise.all(batches.map(batch =>
            supabase.from('snapshots')
              .select('id, project_id, image_url, sort_order')
              .in('project_id', batch)
              .order('sort_order', { ascending: true })
              .limit(3000)
          ))
          for (const { data: snapshotRows, error: sErr } of results) {
            if (sErr) console.error('Failed to fetch snapshots:', sErr)
            for (const s of snapshotRows ?? []) {
              const list = snapshotMap.get(s.project_id) ?? []
              list.push({ id: s.id, image_url: s.image_url, sort_order: s.sort_order })
              snapshotMap.set(s.project_id, list)
            }
          }
        }

        if (cancelled) return
        if (isMakaronIOSAppShell() && fetchNavGeneration !== iosProjectNavGenerationRef.current && projectsRef.current.length > 0) {
          logIOSProjectNav('projects-fetch-discarded-nav-generation-changed', {
            fetchNavGeneration,
            currentNavGeneration: iosProjectNavGenerationRef.current,
            phase: 'snapshots',
          })
          return
        }

        // Fetch which projects have completed videos (v1: project_animations, v2: snapshots with type=video)
        const projectIds = projectRows.map(p => p.id)
        const videoProjectIds = new Set<string>()
        if (projectIds.length > 0) {
          const [{ data: animRows }, { data: videoSnaps }] = await Promise.all([
            supabase.from('project_animations').select('project_id').in('project_id', projectIds).eq('status', 'completed'),
            supabase.from('snapshots').select('project_id').in('project_id', projectIds).eq('type', 'video'),
          ])
          if (animRows) for (const row of animRows) videoProjectIds.add(row.project_id)
          if (videoSnaps) for (const row of videoSnaps) videoProjectIds.add(row.project_id)
        }

        if (cancelled) return
        if (isMakaronIOSAppShell() && fetchNavGeneration !== iosProjectNavGenerationRef.current && projectsRef.current.length > 0) {
          logIOSProjectNav('projects-fetch-discarded-nav-generation-changed', {
            fetchNavGeneration,
            currentNavGeneration: iosProjectNavGenerationRef.current,
            phase: 'videos',
          })
          return
        }

        const result: ProjectWithSnapshots[] = projectRows
          .map((p) => ({ ...p, snapshots: snapshotMap.get(p.id) ?? [], hasVideo: videoProjectIds.has(p.id) }))
          .filter((p) => p.snapshots.length > 0)

        // Patch missing image_urls from IndexedDB cache (upload may not have completed)
        const missingKeys = result.flatMap(p =>
          p.snapshots.filter(s => !s.image_url).map(s => `snap:${s.id}`)
        )
        let displayResult = result
        if (missingKeys.length > 0) {
          const cacheMap = await getCachedImages(missingKeys)
          if (cacheMap.size > 0) {
            displayResult = result.map(p => ({
              ...p,
              snapshots: p.snapshots.map(s => {
                const cached = !s.image_url ? cacheMap.get(`snap:${s.id}`) : undefined
                return cached ? { ...s, image_url: cached } : s
              }),
            }))
          }
        }

        if (cancelled) return
        if (isMakaronIOSAppShell() && fetchNavGeneration !== iosProjectNavGenerationRef.current && projectsRef.current.length > 0) {
          logIOSProjectNav('projects-fetch-discarded-nav-generation-changed', {
            fetchNavGeneration,
            currentNavGeneration: iosProjectNavGenerationRef.current,
            phase: 'cache-patch',
          })
          return
        }
        // Cache clean Supabase data (with URLs, no base64)
        cacheProjectsList(userId!, result)
        applyProjectsRefresh(displayResult)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch projects:', err)
        // Offline: if cache already showed data, stay on it
        if (!shownRef.current) setLoadingProjects(false)
      }
    }

    fetchProjects()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, projectsRefreshNonce, applyProjectsRefresh])

  // Fetch credit balance + detect welcome
  useEffect(() => {
    if (!user) return
    fetch('/api/billing/credits').then(r => r.json()).then(d => {
      setCreditBalance(d.balance ?? 0)
    }).catch(() => {})
    // Detect ?welcome=1
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('welcome')) {
        window.history.replaceState({}, '', window.location.pathname)
        setShowWelcome(true)
      }
    }
  }, [user])

  const handleCreateProject = useCallback(async (files: File[], prompt?: string) => {
    if (!user || createInput.creating || (files.length === 0 && !prompt)) return
    createInput.setCreating(true)
    try {
      const supabase = createClient()
      const opts: { prompt?: string; skill?: string } = {}
      if (prompt) opts.prompt = prompt
      if (selectedSkill) opts.skill = selectedSkill
      const result = await createProject(supabase, user.id, files, Object.keys(opts).length ? opts : undefined, extractedMetadataRef.current)
      if (!result) throw new Error('Failed to create project')
      if (useIOSInlineProjectNavigation) {
        createInput.setCreating(false)
        openIOSProject(result.projectId)
        return
      }
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
  }, [user, createInput, router, selectedSkill, t, useIOSInlineProjectNavigation, openIOSProject])

  // Unified create: text only, image only, or both — all go through handleCreateProject
  const handleCreate = useCallback(async () => {
    const hasText = createInput.text.trim()
    const hasFiles = createInput.files.length > 0
    if (!hasText && !hasFiles) return
    await handleCreateProject(hasFiles ? createInput.files : [], hasText || undefined)
    createInput.clear()
  }, [createInput, handleCreateProject])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (createInput.creating) return
    const droppedFiles = Array.from(e.dataTransfer.files ?? []).filter(
      f => f.type.startsWith('image/') || f.type.startsWith('video/') || isHeicFile(f)
    )
    createInput.addFiles(droppedFiles)
  }, [createInput])

  const resetIOSProjectPan = useCallback(() => {
    iosProjectPanRef.current.tracking = false
    iosProjectPanRef.current.locked = false
    setIosProjectX(0)
    setIosProjectPanActive(false)
    setIosProjectSettling(false)
  }, [])

  const isIOSProjectPanEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  const isCuiOpen = () => {
    const editor = document.querySelector('[data-testid="editor"]')
    return editor?.getAttribute('data-view-mode') === 'cui'
  }

  const handleIOSProjectPanStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!activeIOSProjectId || event.touches.length !== 1 || isIOSProjectPanEditableTarget(event.target)) return
    if (isCuiOpen()) return
    const touch = event.touches[0]
    if (touch.clientX > IOS_PROJECT_PAN_EDGE_PX) return

    clearIOSProjectCloseTimer()
    iosProjectPanRef.current = {
      tracking: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      startTime: performance.now(),
      locked: false,
    }
    setIosProjectSettling(false)
  }, [activeIOSProjectId, clearIOSProjectCloseTimer])

  const handleIOSProjectPanMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const pan = iosProjectPanRef.current
    if (!pan.tracking || event.touches.length !== 1) return

    const touch = event.touches[0]
    const dx = touch.clientX - pan.startX
    const dy = touch.clientY - pan.startY
    pan.lastX = touch.clientX

    if (!pan.locked) {
      if (dx <= IOS_PROJECT_PAN_MIN_DX || dx < Math.abs(dy) * 1.15) {
        if (Math.abs(dy) > IOS_PROJECT_PAN_MIN_DX && Math.abs(dy) > dx) {
          resetIOSProjectPan()
        }
        return
      }
      pan.locked = true
      setIosProjectPanActive(true)
    }

    event.preventDefault()
    event.stopPropagation()
    setIosProjectX(Math.max(0, Math.min(dx, window.innerWidth)))
  }, [resetIOSProjectPan])

  const handleIOSProjectPanEnd = useCallback(() => {
    const pan = iosProjectPanRef.current
    if (!pan.tracking) return

    const dx = Math.max(0, pan.lastX - pan.startX)
    const elapsed = Math.max(1, performance.now() - pan.startTime)
    const velocity = dx / elapsed
    const shouldClose = dx >= IOS_PROJECT_PAN_COMMIT_PX || velocity > 0.42
    pan.tracking = false

    setIosProjectSettling(true)
    if (shouldClose) {
      setIosProjectPanActive(true)
      closeIOSProject()
      return
    }

    setIosProjectX(0)
    window.setTimeout(resetIOSProjectPan, 180)
  }, [closeIOSProject, resetIOSProjectPan])

  const canRenderCachedIOSProjectsWhileAuthPending = useIOSInlineProjectNavigation
    && (authLoading || canHoldIOSProjectsDuringAuthGap || canHoldCachedIOSProjectsWithoutUser)
    && projects.length > 0

  useEffect(() => {
    if (!useIOSInlineProjectNavigation || iosReturnSelfTestStartedRef.current || projects.length === 0) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('iosReturnSelfTest') !== '1') return

    iosReturnSelfTestStartedRef.current = true
    const project = projects[0]
    const startScrollY = window.scrollY
    const startCount = projects.length
    logIOSProjectNav('return-self-test-start', { projectId: project.id, startCount, startScrollY })
    openIOSProject(project.id)

    const closeTimer = window.setTimeout(() => {
      logIOSProjectNav('return-self-test-close-request', { projectId: project.id })
      closeIOSProject()
    }, 1200)
    const assertTimer = window.setTimeout(() => {
      const visibleCards = document.querySelectorAll('.mkr-card').length
      const overlay = document.querySelector('[data-makaron-ios-project-overlay="true"]') as HTMLElement | null
      const passed = window.location.pathname === '/projects'
        && visibleCards > 0
        && overlay?.style.visibility === 'hidden'
      logIOSProjectNav(passed ? 'return-self-test-pass' : 'return-self-test-fail', {
        projectId: project.id,
        visibleCards,
        startCount,
        startScrollY,
        scrollY: window.scrollY,
        overlayVisibility: overlay?.style.visibility,
        pathname: window.location.pathname,
      })
      window.history.replaceState({}, '', '/projects')
    }, 2600)

    return () => {
      window.clearTimeout(closeTimer)
      window.clearTimeout(assertTimer)
    }
  }, [useIOSInlineProjectNavigation, projects, openIOSProject, closeIOSProject])

  useEffect(() => {
    if (!useIOSInlineProjectNavigation || iosRefreshSelfTestStartedRef.current || projects.length === 0 || !userId) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('iosProjectRefreshSelfTest') !== '1') return

    const project = projects[0]
    const sourceSnap = project.snapshots.filter((snapshot) => snapshot.image_url).at(-1)
    if (!sourceSnap?.image_url) {
      logIOSProjectNav('refresh-self-test-skip-no-image', { projectId: project.id })
      return
    }

    iosRefreshSelfTestStartedRef.current = true
    const supabase = createClient()
    const testSnapshotId = crypto.randomUUID()
    const startSnapshotCount = project.snapshots.length
    const startCardCount = document.querySelectorAll('.mkr-card').length
    const startScrollY = window.scrollY
    const pageInstanceId = projectsPageInstanceIdRef.current
    const sortOrder = Math.max(...project.snapshots.map((snapshot) => snapshot.sort_order), -1) + 1

    logIOSProjectNav('refresh-self-test-start', {
      projectId: project.id,
      testSnapshotId,
      startSnapshotCount,
      startCardCount,
      startScrollY,
      pageInstanceId,
    })
    openIOSProject(project.id)

    let cancelled = false
    let inserted = false
    const timers: number[] = []
    const cleanupTestSnapshot = async () => {
      if (!inserted) return
      await supabase.from('snapshots').delete().eq('id', testSnapshotId)
      await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', project.id)
      requestProjectsRefresh('ios-refresh-self-test-cleanup')
    }

    timers.push(window.setTimeout(async () => {
      try {
        const { error } = await supabase.from('snapshots').insert({
          id: testSnapshotId,
          project_id: project.id,
          image_url: sourceSnap.image_url,
          tips: [],
          sort_order: sortOrder,
          metadata: { ios_refresh_self_test: true },
        })
        if (error) throw error
        inserted = true
        await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', project.id)
        logIOSProjectNav('refresh-self-test-snapshot-inserted', { projectId: project.id, testSnapshotId, sortOrder })
        closeIOSProject()
      } catch (err) {
        logIOSProjectNav('refresh-self-test-insert-fail', { projectId: project.id, message: err instanceof Error ? err.message : String(err) })
      }
    }, 900))

    timers.push(window.setTimeout(async () => {
      const card = document.querySelector(`[data-project-id="${project.id}"]`) as HTMLElement | null
      const visibleCards = document.querySelectorAll('.mkr-card').length
      const currentProject = projectsRef.current.find((item) => item.id === project.id)
      const actualSnapshotCount = currentProject?.snapshots.length ?? 0
      const domSnapshotCount = Number(card?.dataset.snapshotCount ?? '0')
      const currentPageInstanceId = document.querySelector('.makaron-projects-page')?.getAttribute('data-page-instance')
      const passed = window.location.pathname === '/projects'
        && actualSnapshotCount >= startSnapshotCount + 1
        && domSnapshotCount >= startSnapshotCount + 1
        && visibleCards === startCardCount
        && currentPageInstanceId === pageInstanceId
        && Math.abs(window.scrollY - startScrollY) < 4

      logIOSProjectNav(passed ? 'refresh-self-test-pass' : 'refresh-self-test-fail', {
        projectId: project.id,
        testSnapshotId,
        startSnapshotCount,
        actualSnapshotCount,
        domSnapshotCount,
        startCardCount,
        visibleCards,
        startScrollY,
        scrollY: window.scrollY,
        pageInstanceId,
        currentPageInstanceId,
        pathname: window.location.pathname,
      })
      if (!cancelled && params.get('iosProjectRefreshSelfTestKeep') !== '1') {
        await cleanupTestSnapshot()
      }
      window.history.replaceState({}, '', '/projects')
    }, 3600))

    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [useIOSInlineProjectNavigation, projects, userId, openIOSProject, closeIOSProject, requestProjectsRefresh])

  if ((authLoading || !user) && !canRenderCachedIOSProjectsWhileAuthPending) {
    return (
      <div style={{ height: '100dvh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    )
  }

  return (
    <>
      <style>{`
        @font-face {
          font-family: 'Caveat';
          font-style: normal;
          font-weight: 400 500;
          font-display: swap;
          src: url('/fonts/caveat-latin-400.woff2') format('woff2');
          unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }
        .mkr-page { font-family: inherit; }
        .mkr-handwrite { font-family: 'Caveat', cursive; }

        @keyframes mkr-in {
          from { transform: translateY(12px); }
          to   { transform: translateY(0); }
        }
        .mkr-row-enter { animation: mkr-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }

        .mkr-card {
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
        }
        .mkr-card img {
          transition: transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: center;
        }
        .mkr-card:active img,
        .mkr-card:active .mkr-card-img { transform: scale(0.96); }

        .mkr-new-btn {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.18s, opacity 0.15s;
          user-select: none;
          -webkit-user-select: none;
        }
        .mkr-new-btn:hover {
          border-color: rgba(217,70,239,0.6) !important;
          box-shadow: 0 0 32px rgba(217,70,239,0.2);
        }
        .mkr-new-btn:active { transform: scale(0.96); opacity: 0.8; }

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
        .mkr-create-btn:hover {
          background: rgba(217,70,239,0.1) !important;
          border-color: rgba(217,70,239,0.5) !important;
          box-shadow: 0 0 20px rgba(217,70,239,0.15);
        }
        .mkr-create-btn:active { transform: scale(0.96); }

        @keyframes mkr-spin { to { transform: rotate(360deg); } }
        .mkr-spin { animation: mkr-spin 0.9s linear infinite; }

        .mkr-more-btn {
          transition: background 0.15s, opacity 0.15s;
        }
        .mkr-more-btn:hover { opacity: 1 !important; }
        .hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div
        className={`mkr-page makaron-projects-page${navigating ? ' page-slide-out' : ''}`}
        data-page-instance={projectsPageInstanceIdRef.current}
        style={{
          minHeight: '100dvh',
          background: '#000',
          color: '#fff',
          overflowX: 'hidden',
        }}
      >

        {/* Ambient glow — center at 40% so top is black, fades to purple below */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          height: '520px', pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse at 50% 40%, rgba(217,70,239,0.22) 0%, transparent 65%)',
        }} />

        <input
          ref={skillFileRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) await handleSkillUpload(file)
            e.target.value = ''
          }}
        />

        <TopBar page="projects" />

        {/* ═══════════════════════════════
            HERO — ~45dvh, fully centered
        ════════════════════════════════ */}
        <div className="makaron-projects-hero" style={{
          paddingTop: '20vh', paddingBottom: '40px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '0px',
          position: 'relative', zIndex: 1,
        }}>
          {/* Wordmark row: Makaron Spark + Makaron */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <MakaronSpark size="clamp(34px, 6vw, 52px)" />

            {/* Wordmark */}
            <div style={{
              fontWeight: 800,
              fontSize: 'clamp(3rem, 12vw, 5rem)',
              letterSpacing: '-0.04em',
              color: '#fff',
              lineHeight: 1,
            }}>
              Makaron
            </div>
          </div>

          {/* Subtitle */}
          <div style={{ marginTop: '4px' }}>
            <RollingTagline className="text-[1.25rem] tracking-wide" />
          </div>

          {/* Create input: shared component */}
          <div style={{ marginTop: '32px', width: '100%', padding: '0 16px', maxWidth: '480px' }}>
            <CreateInputBox
              input={createInput}
              slotWidth={photoSlotWidth}
              isInline
              isDesktop={isDesktop}
              boxRef={inputBoxRef}
              placeholder={locale === 'zh' ? '描述你想要的创意...' : "Got a pic? Let's glow it up.\nNo pic? I'll cook one up."}
              createLabel="Create"
              onSubmit={handleCreate}
              skills={availableSkills}
              selectedSkill={selectedSkill}
              onSkillChange={setSelectedSkill}
              onDeleteSkill={(name) => {
                setAvailableSkills(prev => prev.filter(s => s.name !== name))
                fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {})
              }}
              onUploadSkill={() => skillFileRef.current?.click()}
              skillDirection="up"
              dragOver={dragOver}
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
            />
          </div>
        </div>

        {/* ═══════════════════════════════
            GALLERY SECTION
        ════════════════════════════════ */}
        <div style={{ position: 'relative', zIndex: 1, marginTop: '8px', maxWidth: isDesktop ? '1232px' : undefined, margin: isDesktop ? '8px auto 0' : undefined }}>

          {/* Section divider — only show when projects exist */}
          {!loadingProjects && projects.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '0 16px', marginBottom: '14px',
            }}>
              <span style={{
                fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.18)', fontWeight: 400, flexShrink: 0,
              }}>
                Recents
              </span>
              <div style={{ height: '1px', flex: 1, background: 'rgba(255,255,255,0.07)' }} />
            </div>
          )}

          {loadingProjects ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <Spinner size={20} />
            </div>
          ) : projects.length === 0 ? (
            <p style={{
              textAlign: 'center', padding: '40px 0 80px', margin: 0,
              color: 'rgba(255,255,255,0.2)', fontSize: '0.82rem', letterSpacing: '0.04em',
            }}>
              No projects yet
            </p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(2, 1fr)',
              gap: isDesktop ? '14px' : '10px',
              padding: '0 16px 80px',
              maxWidth: isDesktop ? '1200px' : undefined,
              margin: isDesktop ? '0 auto' : undefined,
            }}>
              {projects.map((project, i) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  index={i}
                  useInlineNavigation={useIOSInlineProjectNavigation}
                  useIOSSafeImageUrls={useIOSInlineProjectNavigation}
                  onMore={(e) => openActionSheet(e, project)}
                  onNavigate={handleProjectNavigate}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Action Sheet ── */}
      {actionSheet && (
        <div
          onClick={() => setActionSheet(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '480px', margin: '0 auto',
              background: '#141414', borderRadius: '20px 20px 0 0',
              padding: '12px 16px 32px',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {/* Handle */}
            <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', margin: '0 auto 16px' }} />

            {/* Project name */}
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em', textAlign: 'center', marginBottom: '16px' }}>
              {actionSheet.title}
            </div>

            {renameMode ? (
              /* Rename input */
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleRename(); if (e.key === 'Escape') setRenameMode(false); }}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '10px', padding: '12px 14px', color: '#fff', fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleRename}
                  style={{
                    background: 'rgba(217,70,239,0.2)', border: '1px solid rgba(217,70,239,0.3)',
                    borderRadius: '10px', color: 'rgba(217,70,239,0.9)', padding: '0 18px',
                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
                  }}
                >
                  {t('project.save')}
                </button>
              </div>
            ) : (
              <>
                {/* Rename button */}
                <button
                  onClick={() => setRenameMode(true)}
                  style={{
                    width: '100%', padding: '16px', background: 'rgba(255,255,255,0.04)',
                    border: 'none', borderRadius: '12px', color: 'rgba(255,255,255,0.8)',
                    cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  {t('project.rename')}
                </button>

                {/* Delete button */}
                <button
                  onClick={handleDelete}
                  style={{
                    width: '100%', padding: '16px', background: 'rgba(239,68,68,0.08)',
                    border: 'none', borderRadius: '12px', color: 'rgba(239,68,68,0.85)',
                    cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3,6 5,6 21,6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  {t('project.delete')}
                </button>
              </>
            )}

            {/* Cancel */}
            <button
              onClick={() => setActionSheet(null)}
              style={{
                width: '100%', padding: '14px', background: 'none',
                border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
                fontSize: '0.85rem', marginTop: '4px',
              }}
            >
              {t('project.cancel')}
            </button>
          </div>
        </div>
      )}

      {renderedIOSProjectId && (
        <div
          ref={iosProjectOverlayRef}
          data-makaron-ios-project-overlay="true"
          aria-hidden={activeIOSProjectId ? undefined : 'true'}
          className="fixed inset-0 z-[240] bg-black"
          style={{
            transform: `translate3d(${iosProjectX}px, 0, 0)`,
            transition: iosProjectSettling ? `transform ${IOS_PROJECT_OVERLAY_CLOSE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
            willChange: iosProjectPanActive || iosProjectSettling ? 'transform' : undefined,
            visibility: activeIOSProjectId ? 'visible' : 'hidden',
            contentVisibility: activeIOSProjectId ? 'visible' : 'hidden',
            pointerEvents: activeIOSProjectId ? 'auto' : 'none',
            contain: 'layout paint',
            isolation: 'isolate',
            touchAction: 'pan-y',
            overscrollBehaviorX: 'contain',
          }}
          onTouchStart={handleIOSProjectPanStart}
          onTouchMove={handleIOSProjectPanMove}
          onTouchEnd={handleIOSProjectPanEnd}
          onTouchCancel={handleIOSProjectPanEnd}
        >
          <ProjectEditorContainer
            key={renderedIOSProjectId}
            projectId={renderedIOSProjectId}
            className=""
            loadingClassName="h-dvh bg-black"
            onBack={closeIOSProject}
            onProjectCreated={replaceIOSProject}
            disableAgentLiveReload
            disableBodyScrollLock
            isInlineActive={activeIOSProjectId === renderedIOSProjectId}
          />
        </div>
      )}

      {/* Welcome credits popup */}
      {showWelcome && creditBalance !== null && creditBalance > 0 && (
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
                {creditBalance.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                credits · ${(creditBalance * 0.01).toFixed(2)} {locale === 'zh' ? '价值' : 'value'}
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

function ProjectCard({
  project,
  index,
  useInlineNavigation,
  useIOSSafeImageUrls,
  onMore,
  onNavigate,
}: {
  project: ProjectWithSnapshots
  index: number
  useInlineNavigation: boolean
  useIOSSafeImageUrls: boolean
  onMore: (e: React.MouseEvent) => void
  onNavigate: (e: React.MouseEvent<HTMLElement>, project: ProjectWithSnapshots) => void
}) {
  // Use last snapshot with an actual image URL (skip design snapshots with empty image_url)
  const lastSnap = project.snapshots.filter(s => s.image_url).pop() ?? project.snapshots[project.snapshots.length - 1]
  const imageSrc = lastSnap.image_url
    ? useIOSSafeImageUrls
      ? getOriginFormatThumbnailUrl(lastSnap.image_url, 400, 50, 400)
      : getThumbnailUrl(lastSnap.image_url, 400, 50, 400)
    : undefined
  const [loaded, setLoaded] = useState(useIOSSafeImageUrls)

  const cardStyle: CSSProperties = {
    display: 'block',
    position: 'relative',
    aspectRatio: '1 / 1',
    borderRadius: '16px',
    overflow: 'hidden',
    background: '#120d1a',
    animationDelay: useIOSSafeImageUrls ? undefined : `${index * 0.06}s`,
    textDecoration: 'none',
    border: 'none',
    padding: 0,
    width: '100%',
    color: 'inherit',
  }

  const cardContent = (
    <>
      {/* Placeholder shimmer while image loads */}
      {!loaded && !useIOSSafeImageUrls && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #120d1a 0%, #1c1026 50%, #120d1a 100%)',
        }} />
      )}

      {/* Full-bleed photo — iOS app avoids transform/WebP thumbnails to keep WKWebView return stable. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={project.title}
        fetchPriority={index < 4 ? 'high' : undefined}
        loading={index < 4 ? 'eager' : 'lazy'}
        decoding="async"
        style={{
          width: '100%', height: '100%',
          objectFit: 'cover',
          display: 'block',
          pointerEvents: 'none',
          opacity: loaded || useIOSSafeImageUrls ? 1 : 0,
          transition: useIOSSafeImageUrls ? 'none' : 'opacity 0.3s',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onLoad={() => setLoaded(true)}
      />

      {/* Bottom gradient overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)',
        pointerEvents: 'none',
      }} />

      {/* Overlaid text — bottom */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '10px 10px 11px',
        pointerEvents: 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '6px',
        }}>
          <div style={{
            fontSize: '0.82rem', fontWeight: 500, color: '#fff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.3, flex: 1, minWidth: 0,
          }}>
            {project.title}
          </div>
          <div style={{
            fontSize: '0.62rem',
            color: 'rgba(255,255,255,0.45)',
            flexShrink: 0,
          }}>
            {timeAgo(project.updated_at)}
          </div>
        </div>
        {/* Badges row */}
        {(project.snapshots.length > 1 || project.hasVideo) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            marginTop: '5px',
          }}>
            {project.snapshots.length > 1 && (
              <span style={{
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)',
                borderRadius: '6px',
                padding: '2px 6px',
                fontSize: '0.68rem',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.8)',
              }}>
                {project.snapshots.length} snaps
              </span>
            )}
            {project.hasVideo && (
              <span style={{
                background: 'rgba(217,70,239,0.4)',
                backdropFilter: 'blur(4px)',
                borderRadius: '6px',
                padding: '2px 6px',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="white">
                  <polygon points="3,1.5 8.5,5 3,8.5" />
                </svg>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Top-right more button */}
      <button
        className="mkr-more-btn"
        onClick={(e) => { e.preventDefault(); onMore(e) }}
        style={{
          position: 'absolute', top: '8px', right: '8px',
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          border: 'none',
          borderRadius: '8px',
          color: 'rgba(255,255,255,0.75)',
          width: '28px', height: '28px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          fontSize: '1rem',
          lineHeight: 1,
          opacity: 0.85,
          letterSpacing: '0.02em',
        }}
        aria-label="More options"
      >
        ···
      </button>
    </>
  )

  if (useInlineNavigation) {
    return (
      <div
        role="link"
        tabIndex={0}
        className="mkr-card"
        data-project-id={project.id}
        data-snapshot-count={project.snapshots.length}
        onClick={(e) => onNavigate(e, project)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onNavigate(e as unknown as React.MouseEvent<HTMLElement>, project)
        }}
        style={cardStyle}
      >
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      href={`/projects/${project.id}`}
      className="mkr-card mkr-row-enter"
      data-project-id={project.id}
      data-snapshot-count={project.snapshots.length}
      onClick={(e) => onNavigate(e, project)}
      style={cardStyle}
    >
      {cardContent}
    </Link>
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
