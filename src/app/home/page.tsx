'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { isHeicFile, ensureDecodableFile } from '@/lib/imageUtils'
import { useLocale, LocaleToggle } from '@/lib/i18n'
import { createProject } from '@/lib/createProject'
import { createClient } from '@/lib/supabase/client'
import RollingTagline from '@/components/RollingTagline'
import Changelog from '@/components/Changelog'
import Link from 'next/link'

interface SkillItem {
  name: string
  label: string
  icon: string
  color: string
  builtIn: boolean
}

const SKILL_TEMPLATES = [
  {
    id: 'studio-portrait',
    label: '影棚形象照', labelEn: 'Studio Portrait',
    bg: 'linear-gradient(160deg, #3d2a14 0%, #1a1208 100%)',
    prompt: 'Professional studio portrait with cinematic lighting',
  },
  {
    id: 'blueprint',
    label: '蓝图海报', labelEn: 'Blueprint Poster',
    bg: 'linear-gradient(160deg, #0d2847 0%, #061428 100%)',
    prompt: 'Blueprint style technical illustration poster',
  },
  {
    id: 'night-flash',
    label: '夜拍闪光', labelEn: 'Night Flash',
    bg: 'linear-gradient(160deg, #2a2518 0%, #0f0d08 100%)',
    prompt: 'Night photography with flash, urban street style',
  },
  {
    id: 'anime',
    label: '动漫风', labelEn: 'Anime Style',
    bg: 'linear-gradient(160deg, #2a1545 0%, #120a22 100%)',
    prompt: 'Anime style illustration',
  },
  {
    id: 'comic',
    label: '漫画', labelEn: 'Comic',
    bg: 'linear-gradient(160deg, #3a1520 0%, #1a0a10 100%)',
    prompt: 'Comic book style with bold lines and vibrant colors',
  },
  {
    id: 'logo-design',
    label: '标识设计', labelEn: 'Logo Design',
    bg: 'linear-gradient(160deg, #1a2a1a 0%, #0a140a 100%)',
    prompt: 'Clean modern logo design',
  },
  {
    id: 'oil-painting',
    label: '油画风', labelEn: 'Oil Painting',
    bg: 'linear-gradient(160deg, #2a2010 0%, #141008 100%)',
    prompt: 'Classical oil painting style with rich textures',
  },
  {
    id: 'cyberpunk',
    label: '赛博朋克', labelEn: 'Cyberpunk',
    bg: 'linear-gradient(160deg, #0a1a2a 0%, #1a0828 100%)',
    prompt: 'Cyberpunk neon aesthetic with futuristic elements',
  },
]

export default function HomePage() {
  const { user, loading: authLoading, signOut } = useAuth()
  const { t, locale } = useLocale()
  const router = useRouter()
  const isDesktop = useIsDesktop()

  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputBoxRef = useRef<HTMLDivElement>(null)
  const [photoSlotWidth, setPhotoSlotWidth] = useState(80)
  const [inputText, setInputText] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [attachedPreviews, setAttachedPreviews] = useState<(string | null)[]>([])
  const [showChangelog, setShowChangelog] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [availableSkills, setAvailableSkills] = useState<SkillItem[]>([])
  const [skillsExpanded, setSkillsExpanded] = useState(false)
  const [skillDragOver, setSkillDragOver] = useState(false)
  const [skillUploading, setSkillUploading] = useState(false)
  const [skillUploadError, setSkillUploadError] = useState<string | null>(null)

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
    const tm = setTimeout(load, 2000)
    return () => clearTimeout(tm)
  }, [])

  const [cardIndex, setCardIndex] = useState(0)
  const [cardDragX, setCardDragX] = useState(0)
  const cardTouchRef = useRef<{ startX: number; startY: number; locked: 'x' | 'y' | null } | null>(null)
  const cardSwipeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = cardSwipeRef.current
    if (!el) return
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
      setCardDragX(prev => {
        const idx = parseInt(el.dataset.idx || '0')
        const count = parseInt(el.dataset.count || '0')
        const atStart = idx === 0 && dx > 0
        const atEnd = idx >= count - 1 && dx < 0
        return (atStart || atEnd) ? dx * 0.2 : dx
      })
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  })

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
    const el = inputBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setPhotoSlotWidth(Math.round(entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login')
  }, [user, authLoading, router])

  const handleCreateProject = useCallback(async (files: File[], prompt?: string) => {
    if (!user || creating || (files.length === 0 && !prompt)) return
    setCreating(true)
    try {
      const supabase = createClient()
      const opts: { prompt?: string; skill?: string } = {}
      if (prompt) opts.prompt = prompt
      if (selectedSkill) opts.skill = selectedSkill
      const result = await createProject(supabase, user.id, files, Object.keys(opts).length ? opts : undefined)
      if (!result) throw new Error('Failed to create project')
      router.push(`/projects/${result.projectId}`)
    } catch (err) {
      console.error('Create project error:', err)
      setCreating(false)
    }
  }, [user, creating, router, selectedSkill])

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
    const droppedFiles = Array.from(e.dataTransfer.files ?? []).filter(
      f => f.type.startsWith('image/') || isHeicFile(f)
    )
    addFiles(droppedFiles)
  }, [creating, addFiles])

  const handleSkillCardClick = (template: typeof SKILL_TEMPLATES[0]) => {
    setSelectedSkill(template.id)
    setInputText(template.prompt)
    setSkillsExpanded(true)
    // Scroll to bottom input
    setTimeout(() => {
      inputBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
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
        .mkr-create-btn:hover {
          background: rgba(217,70,239,0.1) !important;
          border-color: rgba(217,70,239,0.5) !important;
          box-shadow: 0 0 20px rgba(217,70,239,0.15);
        }
        .mkr-create-btn:active { transform: scale(0.96); }

        @keyframes mkr-spin { to { transform: rotate(360deg); } }
        .mkr-spin { animation: mkr-spin 0.9s linear infinite; }

        .hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="mkr-page" style={{ minHeight: '100dvh', background: '#000', color: '#fff', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Ambient glow */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          height: '520px', pointerEvents: 'none', zIndex: 0,
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

        {/* ── Header — same as projects page ── */}
        <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <LocaleToggle />
            <button
              onClick={() => setShowChangelog(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            >
              {locale === 'zh' ? '更新日志' : "What's new"}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              href="/projects"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                transition: 'color 0.2s',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
            >
              {locale === 'zh' ? '我的项目' : 'My Projects'}
            </Link>
            <button
              onClick={() => signOut()}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.18)',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.18)')}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* ── Hero: Logo + Tagline ── */}
        <div style={{
          paddingTop: '6vh', paddingBottom: '24px',
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
              fontSize: 'clamp(2.2rem, 10vw, 3.5rem)',
              letterSpacing: '-0.04em',
              color: '#fff',
              lineHeight: 1,
            }}>
              Makaron
            </div>
          </div>
          <div style={{ marginTop: '4px' }}>
            <RollingTagline className="text-[1.1rem] tracking-wide" />
          </div>
        </div>

        {/* ── Skill Template Grid ── */}
        <div style={{
          flex: 1,
          padding: '0 14px',
          maxWidth: '520px',
          width: '100%',
          margin: '0 auto',
          paddingBottom: '200px',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
          }}>
            {SKILL_TEMPLATES.map((template, i) => (
              <div
                key={template.id}
                className="mkr-skill-card mkr-row-enter"
                onClick={() => handleSkillCardClick(template)}
                style={{
                  position: 'relative',
                  aspectRatio: '3 / 4',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  background: template.bg,
                  border: selectedSkill === template.id
                    ? '2px solid rgba(217,70,239,0.6)'
                    : '1px solid rgba(255,255,255,0.06)',
                  animationDelay: `${i * 0.06}s`,
                }}
              >
                {/* Bottom gradient for text readability */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)',
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
                    {locale === 'zh' ? template.label : template.labelEn}
                  </div>
                </div>

                {/* Selected indicator */}
                {selectedSkill === template.id && (
                  <div style={{
                    position: 'absolute', top: 10, right: 10,
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(217,70,239,0.85)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Skill pills — in scroll area below grid */}
          {skillsExpanded && availableSkills.length > 0 && (
            <div
              style={{
                display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center',
                padding: skillDragOver ? 8 : 0,
                borderRadius: 12,
                border: skillDragOver ? '2px dashed rgba(217,70,239,0.5)' : '2px dashed transparent',
                background: skillDragOver ? 'rgba(217,70,239,0.08)' : 'transparent',
                transition: 'all 0.15s',
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSkillDragOver(true) }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setSkillDragOver(false) }}
              onDrop={async (e) => {
                e.preventDefault(); e.stopPropagation(); setSkillDragOver(false)
                const file = e.dataTransfer.files?.[0]
                if (file && file.name.endsWith('.zip')) await handleSkillUpload(file)
              }}
            >
              {availableSkills.map(skill => (
                <button
                  key={skill.name}
                  onClick={() => setSelectedSkill(selectedSkill === skill.name ? null : skill.name)}
                  style={{
                    padding: '5px 14px', borderRadius: 20, fontSize: '0.8rem',
                    letterSpacing: '0.01em', border: 'none',
                    background: selectedSkill === skill.name ? 'rgba(217,70,239,0.15)' : 'rgba(255,255,255,0.06)',
                    color: selectedSkill === skill.name ? '#f0abfc' : 'rgba(255,255,255,0.6)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    fontFamily: 'var(--font-geist-sans), sans-serif',
                  }}
                >
                  {skill.icon} {skill.label}
                </button>
              ))}
              {skillUploading && <Spinner size={14} />}
              {skillUploadError && (
                <span style={{ fontSize: '0.75rem', color: 'rgba(239,68,68,0.8)' }}>{skillUploadError}</span>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom Input Box (fixed) ── */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 50,
          background: 'linear-gradient(to top, #000 70%, transparent)',
          padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
        }}>
          <div style={{ maxWidth: '480px', margin: '0 auto' }}>
            <div
              ref={inputBoxRef}
              className="mkr-input-box"
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
              style={{
                display: 'flex', gap: 0,
                borderRadius: 18,
                border: dragOver ? '1px solid rgba(217,70,239,0.6)' : '1px solid rgba(255,255,255,0.1)',
                background: dragOver ? 'rgba(217,70,239,0.08)' : 'rgba(10,10,10,0.95)',
                overflow: 'hidden',
                transition: 'border-color 0.2s, background 0.2s',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            >
              {/* Left: photo slot */}
              <div
                onClick={() => { if (!creating) fileInputRef.current?.click() }}
                style={{
                  width: photoSlotWidth, flexShrink: 0, alignSelf: 'stretch',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: creating ? 'default' : 'pointer',
                  borderRight: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                  background: attachedFiles.length > 0 ? 'transparent' : 'rgba(217,70,239,0.04)',
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
                          const cardStyle = (rotate: number, zIndex: number): React.CSSProperties => ({
                            position: 'absolute', inset: 0,
                            borderRadius: 6, overflow: 'hidden',
                            transform: `rotate(${rotate}deg)`,
                            border: '1.5px solid rgba(255,255,255,0.12)',
                            background: '#1a1a1a', zIndex,
                            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                          })
                          const n = attachedFiles.length
                          const layers: { preview: string | null; rotate: number; z: number }[] = []
                          if (n >= 3) layers.push({ preview: attachedPreviews[0], rotate: -6, z: 1 })
                          if (n >= 2) layers.push({ preview: attachedPreviews[n >= 3 ? 1 : 0], rotate: n >= 3 ? 4 : -5, z: 2 })
                          layers.push({ preview: attachedPreviews[n - 1], rotate: 0, z: 3 })
                          return layers.map((layer, i) => (
                            <div key={i} style={cardStyle(layer.rotate, layer.z)}>
                              {layer.preview && layer.preview !== 'heic-pending' ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : layer.preview === null ? (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <Spinner size={12} />
                                </div>
                              ) : null}
                            </div>
                          ))
                        })()}
                      </div>
                    ) : (
                      <div
                        ref={cardSwipeRef}
                        data-idx={Math.min(cardIndex, attachedFiles.length - 1)}
                        data-count={attachedFiles.length}
                        style={{ position: 'absolute', inset: 6 }}
                        onTouchStart={(e) => {
                          cardTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, locked: null }
                        }}
                        onTouchEnd={() => {
                          const touch = cardTouchRef.current
                          cardTouchRef.current = null
                          if (!touch || touch.locked !== 'x') { setCardDragX(0); return }
                          const threshold = 25
                          const idx = Math.min(cardIndex, attachedFiles.length - 1)
                          if (cardDragX < -threshold && idx < attachedFiles.length - 1) {
                            setCardIndex(idx + 1)
                          } else if (cardDragX > threshold && idx > 0) {
                            setCardIndex(idx - 1)
                          }
                          setCardDragX(0)
                        }}
                      >
                        {(() => {
                          const n = attachedFiles.length
                          const idx = Math.min(cardIndex, n - 1)
                          const dragging = cardDragX !== 0
                          const layers: { preview: string | null; baseRotate: number; z: number; key: number; isFront: boolean }[] = []
                          if (idx + 1 < n) layers.push({ preview: attachedPreviews[idx + 1], baseRotate: 4, z: 1, key: idx + 1, isFront: false })
                          if (idx > 0) layers.push({ preview: attachedPreviews[idx - 1], baseRotate: -4, z: 1, key: idx - 1, isFront: false })
                          layers.push({ preview: attachedPreviews[idx], baseRotate: 0, z: 3, key: idx, isFront: true })
                          return layers.map((layer) => {
                            const tx = layer.isFront ? cardDragX : 0
                            const rot = layer.isFront ? cardDragX * 0.15 : layer.baseRotate
                            const opacity = layer.isFront ? Math.max(0.5, 1 - Math.abs(cardDragX) / 150) : 1
                            return (
                              <div key={layer.key} style={{
                                position: 'absolute', inset: 0,
                                borderRadius: 6, overflow: 'hidden',
                                transform: `translateX(${tx}px) rotate(${rot}deg)`,
                                border: '1.5px solid rgba(255,255,255,0.12)',
                                background: '#1a1a1a', zIndex: layer.z,
                                boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity,
                                transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
                              }}>
                                {layer.preview && layer.preview !== 'heic-pending' ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                                ) : layer.preview === null ? (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Spinner size={12} />
                                  </div>
                                ) : null}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    )}
                    <div style={{
                      position: 'absolute', bottom: 4, right: 4, zIndex: 4,
                      background: 'rgba(217,70,239,0.85)', color: '#fff',
                      borderRadius: 8, padding: '1px 6px',
                      fontSize: '0.6rem', fontWeight: 700,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    }}>
                      {isDesktop ? attachedFiles.length : Math.min(cardIndex, attachedFiles.length - 1) + 1}
                    </div>
                    <div style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 5 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isDesktop) {
                          setAttachedFiles([]); setAttachedPreviews([])
                        } else {
                          const idx = Math.min(cardIndex, attachedFiles.length - 1)
                          if (attachedFiles.length <= 1) {
                            setAttachedFiles([]); setAttachedPreviews([]); setCardIndex(0)
                          } else {
                            setAttachedFiles(prev => prev.filter((_, j) => j !== idx))
                            setAttachedPreviews(prev => prev.filter((_, j) => j !== idx))
                            if (idx >= attachedFiles.length - 1) setCardIndex(Math.max(0, idx - 1))
                          }
                        }
                      }}>✕</div>
                  </>
                )}
              </div>

              {/* Right: textarea + bottom toolbar */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (inputText.trim() || attachedFiles.length > 0)) {
                      e.preventDefault()
                      handleCreate()
                    }
                  }}
                  placeholder={locale === 'zh'
                    ? "有照片？让我来美化。\n没照片？我来创作。"
                    : "Got a pic? Let's glow it up.\nNo pic? I'll cook one up."}
                  disabled={creating}
                  rows={3}
                  style={{
                    flex: 1, border: 'none', background: 'transparent',
                    color: '#fff', fontSize: '0.95rem', lineHeight: 1.45,
                    padding: '12px 14px 4px',
                    outline: 'none', resize: 'none',
                    fontFamily: 'var(--font-geist-sans), sans-serif',
                    minHeight: 60,
                  }}
                />
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px 8px',
                }}>
                  <div
                    className="hide-scrollbar"
                    onWheel={(e) => {
                      if (e.deltaY !== 0) {
                        e.currentTarget.scrollLeft += e.deltaY
                        e.preventDefault()
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      flex: 1, minWidth: 0,
                      overflowX: 'auto',
                      paddingTop: 4,
                    }}
                  >
                    {isDesktop && attachedFiles.length >= 2 && attachedPreviews.map((preview, i) => (
                      <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                        {preview && preview !== 'heic-pending' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={preview} alt="" style={{
                            width: 36, height: 36, borderRadius: 8,
                            objectFit: 'cover', display: 'block',
                            border: '1px solid rgba(255,255,255,0.12)',
                          }} />
                        ) : (
                          <div style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Spinner size={10} />
                          </div>
                        )}
                        <div
                          onClick={(e) => {
                            e.stopPropagation()
                            setAttachedFiles(prev => prev.filter((_, j) => j !== i))
                            setAttachedPreviews(prev => prev.filter((_, j) => j !== i))
                          }}
                          style={{
                            position: 'absolute', top: -4, right: -4,
                            width: 14, height: 14, borderRadius: '50%',
                            background: 'rgba(20,20,20,0.9)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Skill button */}
                  <button
                    onClick={() => setSkillsExpanded(prev => !prev)}
                    style={{
                      flexShrink: 0,
                      padding: selectedSkill ? '4px 10px' : '5px 6px',
                      borderRadius: selectedSkill ? 12 : 0,
                      border: 'none',
                      background: selectedSkill ? 'rgba(217,70,239,0.15)' : 'none',
                      color: selectedSkill ? '#f0abfc' : 'rgba(255,255,255,0.45)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      letterSpacing: '0.03em',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      fontFamily: 'var(--font-geist-sans), sans-serif',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedSkill
                      ? (availableSkills.find(s => s.name === selectedSkill)?.label
                        || SKILL_TEMPLATES.find(s => s.id === selectedSkill)?.label
                        || 'Skill')
                      : 'Skill'}
                  </button>

                  {/* Create button */}
                  <button
                    className="mkr-create-btn"
                    onClick={() => {
                      if (inputText.trim() || attachedFiles.length > 0) handleCreate()
                      else fileInputRef.current?.click()
                    }}
                    disabled={creating}
                    style={{
                      flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '14px',
                      background: 'none',
                      border: 'none',
                      color: 'rgba(217,70,239,0.9)',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      letterSpacing: '0.03em',
                      cursor: creating ? 'default' : 'pointer',
                      fontFamily: 'var(--font-geist-sans), sans-serif',
                    }}
                  >
                    {creating ? <Spinner size={12} /> : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Create
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {showChangelog && <Changelog onClose={() => setShowChangelog(false)} locale={locale} />}
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
