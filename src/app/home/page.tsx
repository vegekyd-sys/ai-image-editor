'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { isHeicFile } from '@/lib/imageUtils'
import { useLocale } from '@/lib/i18n'
import { createProject } from '@/lib/createProject'
import { createClient } from '@/lib/supabase/client'
import RollingTagline from '@/components/RollingTagline'
import TopBar from '@/components/TopBar'
import ModeToggle from '@/components/ModeToggle'
import AgentContent from '@/components/AgentContent'
import { type HomeSkill, getCachedHomeSkills, setCachedHomeSkills } from '@/lib/home-skills'
import { getThumbnailUrl, getOptimizedUrl, normalizeDomain } from '@/lib/supabase/storage'
import { useCreateInput } from '@/hooks/useCreateInput'
import CreateInputBox from '@/components/CreateInputBox'

const Z = { INPUT: 100, HERO_FLY: 90, OVERLAY: 80, AMBIENT: 0 } as const

function LazyVideo({ src, style }: { src: string; style: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [inView, setInView] = useState(false)

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
      src={inView ? src : undefined}
      autoPlay={inView}
      loop
      muted
      playsInline
      preload={inView ? 'auto' : 'none'}
      style={style}
    />
  )
}

export default function HomePage() {
  return <Suspense><HomePageInner /></Suspense>
}

function HomePageInner() {
  const { user } = useAuth()
  const requireAuth = useRequireAuth()
  const { t, locale } = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isDesktop = useIsDesktop()

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
  const [textareaFocused, setTextareaFocused] = useState(false)
  const scrollStartY = useRef<number | null>(null)
  const inlineInputRef = useRef<HTMLDivElement>(null)
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null)
  const inlineBoxRef = useRef<HTMLDivElement>(null)
  const [inlineBoxHeight, setInlineBoxHeight] = useState(0)
  const [showFixedInput, setShowFixedInput] = useState(false)
  const [shareToast, setShareToast] = useState(false)
  const openedFromUrlRef = useRef(false)
  const selectedDetailRef = useRef(selectedDetail)
  selectedDetailRef.current = selectedDetail
  const homeSkillsRef = useRef(homeSkills)
  homeSkillsRef.current = homeSkills

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
    // Welcome credits popup — activates new user + grants credits
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('welcome')) {
        window.history.replaceState({}, '', window.location.pathname + window.location.search.replace(/[?&]welcome=1/, ''))
        fetch('/api/auth/activate', { method: 'POST' })
          .then(r => r.json())
          .then(d => {
            if (d.credits > 0) {
              setWelcomeCredits(d.credits); setShowWelcome(true)
              window.dispatchEvent(new Event('credits-updated'))
            } else if (d.isNew === false) {
              // Already activated user revisiting with ?welcome=1 — just refresh credits
              fetch('/api/billing/credits').then(r => r.json()).then(b => {
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
    const cached = getCachedHomeSkills()
    if (cached.length > 0) setHomeSkills(cached)

    // Then fetch fresh data in background
    fetch('/api/home-skills').then(r => r.json()).then(data => {
      if (!Array.isArray(data) || data.length === 0) return
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
      fetch('/api/skills').then(r => r.json()).then(d => {
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
        if (d.skills) setAvailableSkills(d.skills)
        if (data.skillName) setSelectedSkill(data.skillName)
        setSkillMenuOpen(false)
      }
    } catch {}
    setSkillUploading(false)
    setInstallingSkill(false)
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
        textareaRef.current?.blur()
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  useEffect(() => {
    if (selectedDetail) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [selectedDetail])

  // Unmute active slide's video, mute all others (after transition completes)
  useEffect(() => {
    if (!selectedDetail) return
    const tid = setTimeout(() => {
      const snap = detailSnapRef.current
      if (!snap) return
      const idx = homeSkills.findIndex(s => s.id === selectedDetail.id)
      const slides = snap.querySelectorAll('.mkr-detail-slide')
      slides.forEach((slide, i) => {
        const video = slide.querySelector('video') as HTMLVideoElement | null
        if (!video) return
        if (i === idx) {
          video.currentTime = 0
          video.muted = false
          video.play().catch(() => { video.muted = true })
        } else {
          video.muted = true
          video.pause()
        }
      })
    }, 450)
    return () => clearTimeout(tid)
  }, [selectedDetail, homeSkills])

  // Open detail overlay from URL param (?skill={id})
  useEffect(() => {
    const skillId = searchParams.get('skill')
    if (!skillId || homeSkills.length === 0 || selectedDetail) return
    const skill = homeSkills.find(s => s.id === skillId)
    if (!skill) return

    openedFromUrlRef.current = true
    setSelectedDetail(skill)
    setSelectedSkill(skill.skill_path ? skill.id : null)
    createInput.setText(skill.prompt)
    setHeroExpanded(true)
    window.history.replaceState(null, '', `/home/${skillId}`)
  }, [homeSkills]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browser back button
  useEffect(() => {
    if (!selectedDetail) return
    const onPop = () => {
      setHeroExpanded(false)
      setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350)
      setSelectedSkill(null)
      createInput.setText('')
      createInput.clear()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [!!selectedDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = inlineInputRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      setShowFixedInput(!entry.isIntersecting)
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

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
    if (selectedDetail?.id) localStorage.setItem('mkr_return_skill', selectedDetail.id)
  }, [createInput.text, selectedDetail])

  const handleCreateProject = useCallback(async (files: File[], prompt?: string) => {
    saveContextBeforeLogin()
    const authedUser = await requireAuth()
    if (!authedUser) return
    if (createInput.creating || (files.length === 0 && !prompt)) return
    createInput.setCreating(true)
    try {
      const supabase = createClient()
      let skillName: string | undefined
      if (selectedDetail?.skill_path) {
        setInstallingSkill(true)
        try {
          const installRes = await fetch('/api/skills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillPath: selectedDetail.skill_path, homeSkillId: selectedDetail.id }),
          })
          const installData = await installRes.json()
          if (installData.skillName) {
            skillName = installData.skillName
            setSelectedSkill(installData.skillName)
          }
        } finally {
          setInstallingSkill(false)
        }
      } else if (selectedSkill) {
        skillName = selectedSkill
      }
      const opts: { prompt?: string; skill?: string } = {}
      if (prompt) opts.prompt = prompt
      if (skillName) opts.skill = skillName
      const result = await createProject(supabase, authedUser.id, files, Object.keys(opts).length ? opts : undefined)
      if (!result) throw new Error('Failed to create project')
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
  }, [requireAuth, saveContextBeforeLogin, createInput, router, selectedDetail, selectedSkill, t])

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
    if (zipFile) { handleSkillUpload(zipFile); return }
    const droppedFiles = allFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || isHeicFile(f))
    createInput.addFiles(droppedFiles)
  }, [createInput, handleSkillUpload])

  const handleSlotDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files ?? []).filter(f => f.type.startsWith('image/') || isHeicFile(f))
    createInput.addFiles(files)
  }, [createInput])

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
              onClick={async () => { const u = await requireAuth(); if (!u) return; if (isActive && !createInput.previews[i] && !createInput.creating) createInput.fileInputRef.current?.click() }}
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
                  <div onClick={(e) => { e.stopPropagation(); createInput.removeFile(i) }}
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', cursor: 'pointer' }}>&#x2715;</div>
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
  }, [createInput, handleSlotDrop, slotDragOver])

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
        return <LazyVideo src={normalizeDomain(url)} style={style} />
      }
      return <video src={normalizeDomain(url)} autoPlay loop muted playsInline preload="auto" style={style} />
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
      setHeroExpanded(false)
      setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350)
      setSelectedSkill(null)
      createInput.setText('')
      window.history.pushState(null, '', '/home')
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
      window.history.pushState(null, '', `/home/${template.id}`)
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

        {/* Ambient glow */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          height: '520px', pointerEvents: 'none', zIndex: Z.AMBIENT,
          background: 'radial-gradient(ellipse at 50% 40%, rgba(217,70,239,0.22) 0%, transparent 65%)',
        }} />

        <div style={{ display: viewMode === 'agent' ? 'none' : undefined }}>
          <TopBar page="home" />
        </div>

        <div style={{ display: viewMode === 'agent' ? undefined : 'none' }}>
          <AgentContent />
        </div>
        <ModeToggle mode={viewMode} onToggle={setViewMode} hidden={viewMode === 'human' && (showFixedInput || !!selectedDetail)} />

        <div style={{ display: viewMode === 'agent' ? 'none' : undefined }}>
        {/* ── Hero: Landing-page style ── */}
        <div className="relative flex flex-col items-center" style={{ paddingBottom: '40px' }}>
          {/* Glow */}
          <div className="pointer-events-none absolute top-[-80px] left-1/2 -translate-x-1/2 w-[700px] h-[600px] rounded-full bg-[radial-gradient(ellipse,#d946ef18_0%,transparent_70%)]" />

          <div className="relative z-10 flex flex-col items-center text-center pt-10 lg:pt-16 px-6 max-w-[660px]">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              {[[14,1,14,27],[1,14,27,14],[5,5,23,23],[23,5,5,23]].map(([x1,y1,x2,y2], i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d946ef" strokeWidth={1.8} strokeLinecap="round" />
              ))}
            </svg>
            <h1 className="mt-4 text-[52px] lg:text-[88px] font-extrabold tracking-[-0.04em] leading-[1]">
              Makaron
            </h1>
            <p className="mt-3 leading-tight">
              <RollingTagline className="text-2xl lg:text-[32px]" />
            </p>
            <p className="mt-6 text-[15px] lg:text-lg text-[#a1a1aa] leading-relaxed max-w-[480px]">
              {t('landing.heroDesc1')}<br />{t('landing.heroDesc2')}
            </p>
          </div>

          {/* ── Inline Input Box ── */}
          <div ref={inlineInputRef} className="relative z-10" style={{
            marginTop: '32px', width: '100%', maxWidth: '480px', padding: '0 16px',
          }}>
            <CreateInputBox
              input={createInput}
              slotWidth={inlineBoxHeight > 0 ? inlineBoxHeight : 52}
              isInline={true}
              collapseSlot={false}
              isDesktop={isDesktop}
              boxRef={inlineBoxRef}
              textareaRef={inlineTextareaRef}
              swipeRef={inlineCardSwipeRef}
              placeholder={placeholders[placeholderIdx]}
              createLabel={!user ? (locale === 'zh' ? '免费试用' : 'Try free') : 'Create'}
              showLoginIcon={!user}
              onSubmit={handleCreate}
              onSlotClick={async () => { const u = await requireAuth(); if (u) createInput.fileInputRef.current?.click() }}
              onTextareaFocus={() => setTextareaFocused(true)}
              onTextareaBlur={() => setTextareaFocused(false)}
              skills={availableSkills}
              selectedSkill={selectedSkill}
              onSkillChange={setSelectedSkill}
              onDeleteSkill={(name) => { setAvailableSkills(prev => prev.filter(s => s.name !== name)); fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {}) }}
              onUploadSkill={() => skillFileRef.current?.click()}
              installingSkill={installingSkill}
              overrideLabel={selectedSkill ? (availableSkills.find(s => s.name === selectedSkill)?.label || homeSkills.find(s => s.id === selectedSkill)?.labels[locale] || null) : null}
              skillDirection="down"
              skillFileRef={skillFileRef}
              onSkillFileChange={handleSkillUpload}
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
        <div ref={inputWrapperRef} style={{
          position: 'fixed', left: 0, right: 0,
          bottom: textareaFocused && kbInset > 0 ? `${kbInset}px` : isDesktop ? '24px' : 'env(safe-area-inset-bottom, 0px)',
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
              collapseSlot={!isDesktop && !!selectedDetail}
              isDesktop={isDesktop}
              boxRef={inputBoxRef}
              textareaRef={textareaRef}
              swipeRef={cardSwipeRef}
              placeholder={placeholders[placeholderIdx]}
              createLabel={!user ? (locale === 'zh' ? '免费试用' : 'Try free') : 'Create'}
              showLoginIcon={!user}
              onSubmit={handleCreate}
              onSlotClick={async () => { const u = await requireAuth(); if (u) createInput.fileInputRef.current?.click() }}
              onTextareaFocus={() => setTextareaFocused(true)}
              onTextareaBlur={() => setTextareaFocused(false)}
              skills={availableSkills}
              selectedSkill={selectedSkill}
              onSkillChange={setSelectedSkill}
              onDeleteSkill={(name) => { setAvailableSkills(prev => prev.filter(s => s.name !== name)); fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {}) }}
              onUploadSkill={() => skillFileRef.current?.click()}
              installingSkill={installingSkill}
              overrideLabel={selectedSkill ? (availableSkills.find(s => s.name === selectedSkill)?.label || homeSkills.find(s => s.id === selectedSkill)?.labels[locale] || null) : null}
              skillDirection="up"
              skillFileRef={skillFileRef}
              onSkillFileChange={handleSkillUpload}
              dragOver={dragOver}
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
            />
          </div>
        </div>
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
          onClick={(e) => { if (isDesktop && e.target === e.currentTarget) { setHeroExpanded(false); setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350); setSelectedSkill(null); createInput.setText(''); window.history.pushState(null, '', '/home') } }}
          style={{
            position: 'fixed', inset: 0, zIndex: Z.OVERLAY,
            background: isDesktop ? 'rgba(0,0,0,0.7)' : '#000',
            opacity: heroExpanded ? 1 : 0,
            pointerEvents: heroExpanded ? 'auto' : 'none',
            transition: 'opacity 0.3s ease 0.1s',
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
              onClick={() => { setHeroExpanded(false); setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350); setSelectedSkill(null); createInput.clear(); window.history.pushState(null, '', '/home') }}
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
                    window.history.replaceState(null, '', `/home/${t.id}`)
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
                  window.history.replaceState(null, '', `/home/${t.id}`)
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
      </div>
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
