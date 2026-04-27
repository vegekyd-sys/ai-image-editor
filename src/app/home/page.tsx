'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { isHeicFile, ensureDecodableFile } from '@/lib/imageUtils'
import { useLocale } from '@/lib/i18n'
import { createProject } from '@/lib/createProject'
import { createClient } from '@/lib/supabase/client'
import RollingTagline from '@/components/RollingTagline'
import Changelog from '@/components/Changelog'
import { type HomeSkill, getCachedHomeSkills, setCachedHomeSkills } from '@/lib/home-skills'

const Z = { INPUT: 100, HERO_FLY: 90, OVERLAY: 80, AMBIENT: 0 } as const

export default function HomePage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const { t, locale } = useLocale()
  const router = useRouter()
  const isDesktop = useIsDesktop()

  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputBoxRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [photoSlotWidth, setPhotoSlotWidth] = useState(80)
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const [inputWrapperHeight, setInputWrapperHeight] = useState(0)
  const [inputText, setInputText] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [attachedPreviews, setAttachedPreviews] = useState<(string | null)[]>([])
  const [showChangelog, setShowChangelog] = useState(false)
  const [slotDragOver, setSlotDragOver] = useState(-1)
  const [homeSkills, setHomeSkills] = useState<HomeSkill[]>(getCachedHomeSkills)
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
  const [kbInset, setKbInset] = useState(0)
  const scrollStartY = useRef<number | null>(null)
  const inlineInputRef = useRef<HTMLDivElement>(null)
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null)
  const inlineBoxRef = useRef<HTMLDivElement>(null)
  const [inlineBoxHeight, setInlineBoxHeight] = useState(0)
  const [showFixedInput, setShowFixedInput] = useState(false)

  useEffect(() => {
    fetch('/api/home-skills').then(r => r.json()).then(data => {
      if (!Array.isArray(data) || data.length === 0) return
      setHomeSkills(prev => {
        if (prev.length === 0) { setCachedHomeSkills(data); return data }
        const newMap = new Map(data.map((s: HomeSkill) => [s.id, s]))
        const merged = prev.map(s => {
          const fresh = newMap.get(s.id)
          if (!fresh) return null
          newMap.delete(s.id)
          return fresh.updated_at === s.updated_at ? s : fresh
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
  }, [user])

  useEffect(() => {
    const el = inputWrapperRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setInputWrapperHeight(Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [user])

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

  useEffect(() => {
    const el = inlineInputRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      setShowFixedInput(!entry.isIntersecting)
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [user])

  useEffect(() => {
    const el = inlineBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.round(entry.contentRect.height)
      setInlineBoxHeight(prev => prev === 0 ? h : prev)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [user])

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
  }, [inputText, resizeTextarea])
  useEffect(() => {
    if (selectedDetail) {
      const tid = setTimeout(resizeTextarea, 300)
      return () => clearTimeout(tid)
    }
  }, [selectedDetail, resizeTextarea])

  const [cardIndex, setCardIndex] = useState(0)
  const [cardDragX, setCardDragX] = useState(0)
  const cardTouchRef = useRef<{ startX: number; startY: number; locked: 'x' | 'y' | null } | null>(null)
  const cardSwipeRef = useRef<HTMLDivElement>(null)
  const inlineCardSwipeRef = useRef<HTMLDivElement>(null)

  const registerSwipe = useCallback((el: HTMLDivElement | null) => {
    if (!el) return () => {}
    const onMove = (e: TouchEvent) => {
      if (!cardTouchRef.current) return
      const dx = e.touches[0].clientX - cardTouchRef.current.startX
      const dy = e.touches[0].clientY - cardTouchRef.current.startY
      if (!cardTouchRef.current.locked) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
        cardTouchRef.current.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (cardTouchRef.current.locked !== 'x') return
      e.preventDefault()
      e.stopPropagation()
      setCardDragX(() => dx)
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [])

  useEffect(() => {
    const cleanup1 = registerSwipe(cardSwipeRef.current)
    const cleanup2 = registerSwipe(inlineCardSwipeRef.current)
    return () => { cleanup1(); cleanup2() }
  }, [attachedFiles.length, registerSwipe])

  const MAX_FILES = 10
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const addFiles = useCallback(async (newFiles: File[]) => {
    if (creating || newFiles.length === 0) return
    for (const file of newFiles) {
      let atLimit = false
      setAttachedFiles(prev => {
        if (prev.length >= MAX_FILES) { atLimit = true; return prev }
        return prev
      })
      if (atLimit) break

      if (isHeicFile(file)) {
        setAttachedFiles(prev => [...prev, file].slice(0, MAX_FILES))
        setAttachedPreviews(prev => [...prev, null].slice(0, MAX_FILES))
        try {
          const decodable = await ensureDecodableFile(file)
          const previewUrl = URL.createObjectURL(decodable)
          setAttachedFiles(prev => {
            const idx = prev.indexOf(file)
            if (idx === -1) return prev
            return prev.map((f, i) => i === idx ? decodable : f)
          })
          setAttachedPreviews(prev => {
            const idx = prev.lastIndexOf(null)
            if (idx === -1) return prev
            return prev.map((p, i) => i === idx ? previewUrl : p)
          })
        } catch {
          setAttachedPreviews(prev => {
            const idx = prev.lastIndexOf(null)
            if (idx === -1) return prev
            return prev.map((p, i) => i === idx ? 'heic-pending' : p)
          })
        }
      } else {
        const previewUrl = URL.createObjectURL(file)
        setAttachedFiles(prev => [...prev, file].slice(0, MAX_FILES))
        setAttachedPreviews(prev => [...prev, previewUrl].slice(0, MAX_FILES))
      }
    }
    setCardIndex(999)
  }, [creating])

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login')
  }, [user, authLoading, router])

  const handleCreateProject = useCallback(async (files: File[], prompt?: string) => {
    if (!user || creating || (files.length === 0 && !prompt)) return
    setCreating(true)
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
      const result = await createProject(supabase, user.id, files, Object.keys(opts).length ? opts : undefined)
      if (!result) throw new Error('Failed to create project')
      router.push(`/projects/${result.projectId}`)
    } catch (err) {
      console.error('Create project error:', err)
      setCreating(false)
    }
  }, [user, creating, router, selectedDetail, selectedSkill])

  const handleCreate = useCallback(async () => {
    const hasText = inputText.trim()
    const hasFiles = attachedFiles.length > 0
    if (!hasText && !hasFiles) return
    await handleCreateProject(hasFiles ? attachedFiles : [], hasText || undefined)
    setInputText('')
    setAttachedFiles([])
    setAttachedPreviews([])
  }, [inputText, attachedFiles, handleCreateProject])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (creating) return
    const allFiles = Array.from(e.dataTransfer.files ?? [])
    const zipFile = allFiles.find(f => f.name.endsWith('.zip'))
    if (zipFile) { handleSkillUpload(zipFile); return }
    const droppedFiles = allFiles.filter(f => f.type.startsWith('image/') || isHeicFile(f))
    addFiles(droppedFiles)
  }, [creating, addFiles, handleSkillUpload])

  const removeFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, j) => j !== index))
    setAttachedPreviews(prev => prev.filter((_, j) => j !== index))
  }, [])

  const handleSlotDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files ?? []).filter(f => f.type.startsWith('image/') || isHeicFile(f))
    addFiles(files)
  }, [addFiles])

  const renderUploadSlots = useCallback((template: { image_count?: number }, isActive: boolean) => {
    const minSlots = template.image_count ?? 1
    const count = Math.max(minSlots, attachedFiles.length + 1)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto' }}>
        {Array.from({ length: count }, (_, i) => {
          const isDragTarget = slotDragOver === i
          return (
            <div key={i}
              onClick={() => { if (isActive && !attachedPreviews[i] && !creating) fileInputRef.current?.click() }}
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
              {isActive && attachedPreviews[i] && attachedPreviews[i] !== 'heic-pending' ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={attachedPreviews[i]!} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', cursor: 'pointer' }}>✕</div>
                </>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              )}
            </div>
          )
        })}
      </div>
    )
  }, [attachedPreviews, creating, handleSlotDrop, removeFile, slotDragOver])

  const renderTemplateLabel = (template: { labels: Record<string, string> }) => (
    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
      {template.labels[locale] || template.labels.en || ''}
    </div>
  )

  const renderInputBox = (opts: {
    isInline: boolean
    taRef: React.RefObject<HTMLTextAreaElement | null>
    boxRef?: React.RefObject<HTMLDivElement | null>
    slotWidth: number
  }) => {
    const { isInline, taRef, boxRef, slotWidth } = opts
    const collapseSlot = !isInline && !!selectedDetail
    const swipeRef = !isDesktop && !isInline ? cardSwipeRef : !isDesktop && isInline ? inlineCardSwipeRef : undefined
    return (
      <div
        ref={boxRef}
        className="mkr-input-box"
        onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
        onDrop={handleDrop}
        style={{
          display: 'flex', gap: 0,
          borderRadius: 18,
          border: dragOver ? '1px solid rgba(217,70,239,0.6)' : `1px solid rgba(255,255,255,${isInline ? 0.1 : 0.18})`,
          background: dragOver ? 'rgba(217,70,239,0.08)' : isInline ? 'rgba(255,255,255,0.03)' : 'rgba(15,15,15,0.65)',
          overflow: 'hidden',
          transition: 'border-color 0.2s, background 0.2s',
          ...(isInline ? {} : {
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            pointerEvents: 'auto' as const,
            boxShadow: '0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.8), 0 0 60px 30px rgba(0,0,0,0.5)',
          }),
        }}
      >
        {/* Left: + button / photo slot */}
        <div
          onClick={() => { if (!creating && !collapseSlot) fileInputRef.current?.click() }}
          style={{
            width: collapseSlot ? 0 : slotWidth,
            flexShrink: 0, alignSelf: 'stretch',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: creating || collapseSlot ? 'default' : 'pointer',
            borderRight: collapseSlot ? 'none' : '1px solid rgba(255,255,255,0.08)',
            position: 'relative', overflow: 'hidden',
            background: attachedFiles.length > 0 ? 'transparent' : 'rgba(217,70,239,0.04)',
            transition: 'width 0.25s cubic-bezier(0.22, 1, 0.36, 1), border-right 0.2s',
          }}
        >
          {attachedFiles.length === 0 ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          ) : attachedFiles.length === 1 ? (
            <>
              {attachedPreviews[0] && attachedPreviews[0] !== 'heic-pending' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachedPreviews[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : attachedPreviews[0] === null ? (
                <Spinner size={16} />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.7)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
              )}
              <div style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 2 }}
                onClick={(e) => { e.stopPropagation(); setAttachedFiles([]); setAttachedPreviews([]) }}>✕</div>
            </>
          ) : (
            <>
              {isDesktop ? (
                <div style={{ position: 'absolute', inset: 6, pointerEvents: 'none' }}>
                  {(() => {
                    const cardStyle = (rotate: number, zIdx: number): React.CSSProperties => ({
                      position: 'absolute', inset: 0, borderRadius: 6, overflow: 'hidden',
                      transform: `rotate(${rotate}deg)`,
                      border: '1.5px solid rgba(255,255,255,0.12)',
                      background: '#1a1a1a', zIndex: zIdx, boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                    })
                    const n = attachedFiles.length
                    const layers: { preview: string | null; rotate: number; z: number }[] = []
                    if (n >= 3) layers.push({ preview: attachedPreviews[0], rotate: -6, z: 1 })
                    if (n >= 2) layers.push({ preview: attachedPreviews[n >= 3 ? 1 : 0], rotate: n >= 3 ? 4 : -5, z: 2 })
                    layers.push({ preview: attachedPreviews[n - 1], rotate: 0, z: 3 })
                    return layers.map((layer, li) => (
                      <div key={li} style={cardStyle(layer.rotate, layer.z)}>
                        {layer.preview && layer.preview !== 'heic-pending' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : layer.preview === null ? (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={12} /></div>
                        ) : null}
                      </div>
                    ))
                  })()}
                </div>
              ) : (
                <div
                  ref={swipeRef}
                  data-idx={Math.min(cardIndex, attachedFiles.length - 1)}
                  data-count={attachedFiles.length}
                  style={{ position: 'absolute', inset: 6 }}
                  onTouchStart={(e) => { cardTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, locked: null } }}
                  onTouchEnd={() => {
                    const touch = cardTouchRef.current; cardTouchRef.current = null
                    if (!touch || touch.locked !== 'x') { setCardDragX(0); return }
                    const idx = Math.min(cardIndex, attachedFiles.length - 1)
                    const n = attachedFiles.length
                    if (cardDragX < -25) setCardIndex((idx + 1) % n)
                    else if (cardDragX > 25) setCardIndex((idx - 1 + n) % n)
                    setCardDragX(0)
                  }}
                >
                  {(() => {
                    const n = attachedFiles.length; const idx = Math.min(cardIndex, n - 1); const dragging = cardDragX !== 0
                    const layers: { preview: string | null; baseRotate: number; z: number; key: number; isFront: boolean }[] = []
                    if (idx + 1 < n) layers.push({ preview: attachedPreviews[idx + 1], baseRotate: 4, z: 1, key: idx + 1, isFront: false })
                    if (idx > 0) layers.push({ preview: attachedPreviews[idx - 1], baseRotate: -4, z: 1, key: idx - 1, isFront: false })
                    layers.push({ preview: attachedPreviews[idx], baseRotate: 0, z: 3, key: idx, isFront: true })
                    return layers.map((layer) => {
                      const tx = layer.isFront ? cardDragX : 0; const rot = layer.isFront ? cardDragX * 0.15 : layer.baseRotate
                      const opacity = layer.isFront ? Math.max(0.5, 1 - Math.abs(cardDragX) / 150) : 1
                      return (
                        <div key={layer.key} style={{
                          position: 'absolute', inset: 0, borderRadius: 6, overflow: 'hidden',
                          transform: `translateX(${tx}px) rotate(${rot}deg)`,
                          border: '1.5px solid rgba(255,255,255,0.12)', background: '#1a1a1a', zIndex: layer.z,
                          boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity,
                          transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
                        }}>
                          {layer.preview && layer.preview !== 'heic-pending' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                          ) : layer.preview === null ? (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={12} /></div>
                          ) : null}
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
              <div style={{ position: 'absolute', bottom: 4, right: 4, zIndex: 4, background: 'rgba(217,70,239,0.85)', color: '#fff', borderRadius: 8, padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                {isDesktop ? attachedFiles.length : Math.min(cardIndex, attachedFiles.length - 1) + 1}
              </div>
              <div style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 5 }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isDesktop) { setAttachedFiles([]); setAttachedPreviews([]) }
                  else {
                    const idx = Math.min(cardIndex, attachedFiles.length - 1)
                    if (attachedFiles.length <= 1) { setAttachedFiles([]); setAttachedPreviews([]); setCardIndex(0) }
                    else { removeFile(idx); if (idx >= attachedFiles.length - 1) setCardIndex(Math.max(0, idx - 1)) }
                  }
                }}>✕</div>
            </>
          )}
        </div>

        {/* Right: textarea + bottom toolbar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <textarea
            ref={taRef}
            value={inputText}
            onChange={(e) => { userTypingRef.current = true; setInputText(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (inputText.trim() || attachedFiles.length > 0)) {
                e.preventDefault()
                handleCreate()
              }
            }}
            placeholder="where magic happens"
            disabled={creating}
            rows={2}
            style={{
              border: 'none', background: 'transparent',
              color: 'rgba(255,255,255,0.88)', fontSize: '17px', lineHeight: 1.45,
              padding: '12px 14px 4px',
              outline: 'none', resize: 'none',
              fontFamily: 'inherit',
              caretColor: '#d946ef',
              minHeight: 40,
              maxHeight: isInline && selectedDetail ? 40 : '8rem',
              overflowY: isInline && selectedDetail ? 'hidden' : 'auto',
              display: 'block', width: '100%',
              ...(isInline && selectedDetail ? { textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 8px' }}>
            <div className="hide-scrollbar" onWheel={(e) => { if (e.deltaY !== 0) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault() } }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto', paddingTop: 4 }}>
              {isDesktop && attachedFiles.length >= 2 && attachedPreviews.map((preview, i) => (
                <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                  {preview && preview !== 'heic-pending' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', display: 'block', border: '1px solid rgba(255,255,255,0.12)' }} />
                  ) : (
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={10} /></div>
                  )}
                  <div onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                    style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'rgba(20,20,20,0.9)', border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </div>
                </div>
              ))}
            </div>
            {/* Skill button + dropdown */}
            <div style={{ position: 'relative', flexShrink: 0 }} ref={skillMenuRef}>
              <button
                className="mkr-skill-btn"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setSkillMenuPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left })
                  setSkillMenuOpen(prev => !prev)
                }}
                style={{
                  flexShrink: 0,
                  padding: (selectedSkill || installingSkill) ? '4px 10px' : '5px 6px',
                  borderRadius: (selectedSkill || installingSkill) ? 12 : 0,
                  border: 'none',
                  background: (selectedSkill || installingSkill) ? 'rgba(217,70,239,0.15)' : 'none',
                  color: (selectedSkill || installingSkill) ? '#f0abfc' : 'rgba(255,255,255,0.45)',
                  fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.03em',
                  cursor: 'pointer', transition: 'all 0.15s',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {installingSkill ? (
                  <><Spinner size={10} /> Installing...</>
                ) : selectedSkill ? (
                  <>{availableSkills.find(s => s.name === selectedSkill)?.label
                    || homeSkills.find(s => s.id === selectedSkill)?.labels[locale]
                    || 'Skill'}
                  <span onClick={(e) => { e.stopPropagation(); setSelectedSkill(null); setSkillMenuOpen(false) }}
                    style={{ opacity: 0.6, fontSize: '0.65rem', padding: '0 2px' }}>✕</span></>
                ) : 'Skill'}
              </button>
              <input ref={skillFileRef} type="file" accept=".zip" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSkillUpload(f); e.target.value = '' }} />
            </div>
            <button
              className="mkr-create-btn"
              onClick={() => { if (inputText.trim() || attachedFiles.length > 0) handleCreate(); else fileInputRef.current?.click() }}
              disabled={creating}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '14px', background: 'none', border: 'none', color: 'rgba(217,70,239,0.9)', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.03em', cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >
              {creating ? <Spinner size={12} /> : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Create
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const handleSkillCardClick = (template: HomeSkill, e: React.MouseEvent) => {
    if (selectedDetail?.id === template.id) {
      setHeroExpanded(false)
      setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350)
      setSelectedSkill(null)
      setInputText('')
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setHeroRect(rect)
    setHeroExpanded(false)
    setSelectedDetail(template)
    setSelectedSkill(template.skill_path ? template.id : null)
    setInputText(template.prompt)
    const idx = homeSkills.findIndex(t => t.id === template.id)
    requestAnimationFrame(() => {
      setHeroExpanded(true)
      detailSnapRef.current?.children[idx]?.scrollIntoView({ behavior: 'instant' })
    })
  }

  if (authLoading || !user) {
    return (
      <div style={{ height: '100dvh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&display=swap');
        .mkr-page { font-family: inherit; }
        .mkr-handwrite { font-family: 'Caveat', cursive; }

        @keyframes mkr-in {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .mkr-row-enter { animation: mkr-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .mkr-skill-item:hover { background: rgba(255,255,255,0.06) !important; }

        .mkr-detail-snap {
          scroll-snap-type: y mandatory;
          -webkit-overflow-scrolling: touch;
        }
        .mkr-detail-snap > .mkr-detail-slide {
          scroll-snap-align: start;
          scroll-snap-stop: always;
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
        .mkr-create-btn:hover, .mkr-skill-btn:hover {
          background: rgba(217,70,239,0.1) !important;
          border-radius: 12px !important;
          box-shadow: 0 0 20px rgba(217,70,239,0.15);
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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            addFiles(files)
          }}
        />

        {/* ── Hero: Logo + Tagline — matches projects page ── */}
        <div style={{
          paddingTop: '20vh', paddingBottom: '40px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '0px',
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <svg
              width="20" height="20" viewBox="0 0 24 24"
              fill="none" stroke="rgb(217,70,239)"
              strokeWidth="1.8" strokeLinecap="round"
            >
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
            </svg>
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
          <div style={{ marginTop: '4px' }}>
            <RollingTagline className="text-[1.25rem] tracking-wide" />
          </div>

          {/* ── Inline Input Box (in document flow, like projects page) ── */}
          <div ref={inlineInputRef} style={{
            marginTop: '24px', width: '100%', maxWidth: '480px', padding: '0 16px',
          }}>
            {renderInputBox({ isInline: true, taRef: inlineTextareaRef, boxRef: inlineBoxRef, slotWidth: inlineBoxHeight > 0 ? inlineBoxHeight : 52 })}
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
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(2, 1fr)',
            gap: isDesktop ? '14px' : '10px',
          }}>
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.image}
                  alt={template.labels.en || ''}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                />

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
          bottom: kbInset > 0 ? `${kbInset}px` : isDesktop ? '24px' : 'env(safe-area-inset-bottom, 0px)',
          zIndex: Z.INPUT,
          pointerEvents: 'none',
          ...(isDesktop ? {
            padding: '0 24px',
          } : {
            padding: '60px 12px 8px',
          }),
          transform: (showFixedInput || selectedDetail) ? 'translateY(0)' : 'translateY(calc(100% + 20px))',
          transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)' + (kbInset > 0 ? ', bottom 0.1s ease-out' : ''),
        }}>
          {/* No gradient overlay — cards show through below */}
          <div style={{ maxWidth: '480px', margin: '0 auto', position: 'relative', pointerEvents: 'none' }}>
            {/* Mobile only: title + upload slots above input when overlay is open */}
            {selectedDetail && !isDesktop && (
              <div style={{ padding: '0 4px 10px', display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
                {renderTemplateLabel(selectedDetail)}
                {renderUploadSlots(selectedDetail, true)}
              </div>
            )}
            {renderInputBox({ isInline: false, taRef: textareaRef, boxRef: inputBoxRef, slotWidth: photoSlotWidth })}
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
            <img src={selectedDetail.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )
      })()}

      {/* ── Skill Detail Overlay ── */}
      {selectedDetail && (
        <div
          onClick={(e) => { if (isDesktop && e.target === e.currentTarget) { setHeroExpanded(false); setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350); setSelectedSkill(null); setInputText('') } }}
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
            {/* Close button */}
            <button
              onClick={() => { setHeroExpanded(false); setTimeout(() => { setSelectedDetail(null); setHeroRect(null) }, 350); setSelectedSkill(null); setInputText(''); setAttachedFiles([]); setAttachedPreviews([]) }}
              style={{
                position: 'absolute', top: isDesktop ? 12 : 'max(12px, env(safe-area-inset-top))', right: 12,
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                border: 'none', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 10, fontSize: '1.1rem',
              }}
            >✕</button>

            {/* Snap scroll container */}
            <div
              ref={detailSnapRef}
              className="mkr-detail-snap hide-scrollbar"
              onScroll={(e) => {
                const el = e.currentTarget
                const slideH = el.clientHeight
                if (slideH === 0) return
                const idx = Math.round(el.scrollTop / slideH)
                const t = homeSkills[idx]
                if (t && t.id !== selectedDetail?.id) {
                  setSelectedDetail(t)
                  setSelectedSkill(t.skill_path ? t.id : null)
                  setInputText(t.prompt)
                  setAttachedFiles([])
                  setAttachedPreviews([])
                }
              }}
              style={{
                position: 'absolute', inset: 0,
                overflowY: 'auto', overflowX: 'hidden',
              }}
            >
            {homeSkills.map((template) => (
              <div
                key={template.id}
                className="mkr-detail-slide"
                style={{ height: '100%', minHeight: '100%', position: 'relative', flexShrink: 0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={template.image} alt="" loading="lazy"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 30%, transparent 55%)', pointerEvents: 'none' }} />

                {/* Desktop: title + upload slots inside card */}
                {isDesktop && (
                  <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, zIndex: 1 }}>
                    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {renderTemplateLabel(template)}
                      {template.id === selectedDetail?.id && renderUploadSlots(template, true)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

      {showChangelog && <Changelog onClose={() => setShowChangelog(false)} locale={locale} />}

      {/* Skill menu — rendered at top level to avoid overflow clipping */}
      {skillMenuOpen && (isDesktop ? (
        <div ref={skillMenuRef} style={{
          position: 'fixed', bottom: skillMenuPos?.bottom ?? 60, left: skillMenuPos?.left ?? 0,
          width: 200, maxHeight: 320, overflowY: 'auto',
          background: 'rgba(24,24,28,0.98)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: '4px 0',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
          zIndex: 300,
          animation: 'mkr-menu-up 0.2s ease-out',
        }}>
          {availableSkills.length === 0 && (
            <div style={{ padding: '8px 12px', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Loading...</div>
          )}
          {availableSkills.map(skill => (
            <button key={skill.name}
              className="mkr-skill-item"
              onClick={() => { setSelectedSkill(selectedSkill === skill.name ? null : skill.name); setSkillMenuOpen(false) }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 12px', border: 'none', cursor: 'pointer',
                background: selectedSkill === skill.name ? 'rgba(217,70,239,0.12)' : 'transparent',
                color: selectedSkill === skill.name ? '#f0abfc' : 'rgba(255,255,255,0.7)',
                fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
              }}>
              <span>{skill.label}</span>
              {!skill.builtIn && (
                <span onClick={(e) => {
                  e.stopPropagation()
                  if (selectedSkill === skill.name) setSelectedSkill(null)
                  setAvailableSkills(prev => prev.filter(s => s.name !== skill.name))
                  fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: skill.name }) }).catch(() => {})
                }} style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, padding: '0 2px', cursor: 'pointer' }}>✕</span>
              )}
            </button>
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
          <button className="mkr-skill-item" onClick={() => { skillFileRef.current?.click(); setSkillMenuOpen(false) }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              padding: '6px 12px', border: 'none', cursor: 'pointer',
              background: 'transparent', color: 'rgba(255,255,255,0.4)',
              fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
            }}>
            {skillUploading ? 'Installing...' : '+ Upload Skill (.zip)'}
          </button>
        </div>
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSkillMenuOpen(false) }}>
          <div style={{ background: 'rgba(0,0,0,0.5)', position: 'absolute', inset: 0, animation: 'mkr-fade-in 0.2s ease-out' }} />
          <div ref={skillMenuRef} style={{
            position: 'relative', maxHeight: '50dvh', overflowY: 'auto',
            background: 'rgba(24,24,28,0.98)', borderTop: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '18px 18px 0 0', padding: '12px 0',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            animation: 'mkr-sheet-up 0.25s ease-out',
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 12px' }} />
            {availableSkills.length === 0 && (
              <div style={{ padding: '12px 20px', color: 'rgba(255,255,255,0.3)', fontSize: 15 }}>Loading...</div>
            )}
            {availableSkills.map(skill => (
              <button key={skill.name}
                onClick={() => { setSelectedSkill(selectedSkill === skill.name ? null : skill.name); setSkillMenuOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 20px', border: 'none', cursor: 'pointer',
                  background: selectedSkill === skill.name ? 'rgba(217,70,239,0.12)' : 'transparent',
                  color: selectedSkill === skill.name ? '#f0abfc' : 'rgba(255,255,255,0.7)',
                  fontSize: 15, fontFamily: 'inherit', textAlign: 'left',
                }}>
                <span>{skill.label}</span>
                {!skill.builtIn && (
                  <span onClick={(e) => {
                    e.stopPropagation()
                    if (selectedSkill === skill.name) setSelectedSkill(null)
                    setAvailableSkills(prev => prev.filter(s => s.name !== skill.name))
                    fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: skill.name }) }).catch(() => {})
                  }} style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, padding: '2px 4px', cursor: 'pointer' }}>✕</span>
                )}
              </button>
            ))}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
            <button onClick={() => { skillFileRef.current?.click(); setSkillMenuOpen(false) }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                padding: '10px 20px', border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'rgba(255,255,255,0.4)',
                fontSize: 15, fontFamily: 'inherit', textAlign: 'left',
              }}>
              {skillUploading ? 'Installing...' : '+ Upload Skill (.zip)'}
            </button>
          </div>
        </div>
      ))}
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
