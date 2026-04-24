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

const Z = { INPUT: 100, HERO_FLY: 90, OVERLAY: 80, AMBIENT: 0 } as const

const SKILL_TEMPLATES = [
  {
    id: 'photo-to-video',
    label: '照片变视频', labelEn: 'Photo to Video',
    image: '/skills/night-flash.jpg',
    prompt: 'Turn my photo into a cinematic video',
    skill: 'photo-to-video' as string | undefined,
    imageCount: 1 as number | undefined,
  },
  {
    id: 'animated-gif',
    label: '动态表情包', labelEn: 'Animated GIF',
    image: '/skills/anime.jpg',
    prompt: 'Create an animated GIF from my photos',
    skill: 'animated-gif' as string | undefined,
    imageCount: undefined as number | undefined,
  },
  {
    id: 'studio-portrait',
    label: '影棚形象照', labelEn: 'Studio Portrait',
    image: '/skills/studio-portrait.jpg',
    prompt: 'Professional studio portrait with cinematic lighting',
  },
  {
    id: 'blueprint',
    label: '蓝图海报', labelEn: 'Blueprint Poster',
    image: '/skills/blueprint.jpg',
    prompt: 'Blueprint style technical illustration poster',
  },
  {
    id: 'night-flash',
    label: '夜拍闪光', labelEn: 'Night Flash',
    image: '/skills/night-flash.jpg',
    prompt: 'Night photography with flash, urban street style',
  },
  {
    id: 'anime',
    label: '动漫风', labelEn: 'Anime Style',
    image: '/skills/anime.jpg',
    prompt: 'Anime style illustration',
  },
  {
    id: 'comic',
    label: '漫画', labelEn: 'Comic',
    image: '/skills/comic.jpg',
    prompt: 'Comic book style with bold lines and vibrant colors',
  },
  {
    id: 'logo-design',
    label: '标识设计', labelEn: 'Logo Design',
    image: '/skills/logo-design.jpg',
    prompt: 'Clean modern logo design',
  },
  {
    id: 'oil-painting',
    label: '油画风', labelEn: 'Oil Painting',
    image: '/skills/oil-painting.jpg',
    prompt: 'Classical oil painting style with rich textures',
  },
  {
    id: 'cyberpunk',
    label: '赛博朋克', labelEn: 'Cyberpunk',
    image: '/skills/cyberpunk.jpg',
    prompt: 'Cyberpunk neon aesthetic with futuristic elements',
  },
  {
    id: 'watercolor',
    label: '水彩画', labelEn: 'Watercolor',
    image: '/skills/watercolor.jpg',
    prompt: 'Watercolor painting with soft pastel colors and wet-on-wet technique',
  },
  {
    id: 'pixel-art',
    label: '像素风', labelEn: 'Pixel Art',
    image: '/skills/pixel-art.jpg',
    prompt: 'Pixel art style retro gaming aesthetic, 16-bit detailed scene',
  },
  {
    id: '3d-render',
    label: '3D 渲染', labelEn: '3D Render',
    image: '/skills/3d-render.jpg',
    prompt: 'High quality 3D render with studio lighting, octane render style',
  },
  {
    id: 'film-photo',
    label: '胶片摄影', labelEn: 'Film Photo',
    image: '/skills/film-photo.jpg',
    prompt: 'Vintage film photography with warm tones, film grain, Kodak Portra aesthetic',
  },
  {
    id: 'sticker',
    label: '贴纸设计', labelEn: 'Sticker',
    image: '/skills/sticker.jpg',
    prompt: 'Cute kawaii sticker design with thick outline and pastel colors',
  },
  {
    id: 'food-photo',
    label: '美食摄影', labelEn: 'Food Photo',
    image: '/skills/food-photo.jpg',
    prompt: 'Dramatic food photography with studio lighting, commercial advertising style',
  },
  {
    id: 'art-deco',
    label: '装饰海报', labelEn: 'Art Deco Poster',
    image: '/skills/art-deco.jpg',
    prompt: 'Art deco poster with bold geometric shapes, vintage 1920s style',
  },
  {
    id: 'isometric',
    label: '等距插画', labelEn: 'Isometric',
    image: '/skills/isometric.jpg',
    prompt: 'Isometric 3D illustration with soft pastel colors, miniature world',
  },
  {
    id: 'bw-portrait',
    label: '黑白人像', labelEn: 'B&W Portrait',
    image: '/skills/bw-portrait.jpg',
    prompt: 'Cinematic black and white portrait with dramatic Rembrandt lighting',
  },
  {
    id: 'fantasy',
    label: '奇幻场景', labelEn: 'Fantasy',
    image: '/skills/fantasy.jpg',
    prompt: 'Fantasy digital painting of a magical enchanted world, ethereal atmosphere',
  },
  {
    id: 'flat-design',
    label: '扁平插画', labelEn: 'Flat Design',
    image: '/skills/flat-design.jpg',
    prompt: 'Minimalist flat illustration with geometric shapes and limited color palette',
  },
  {
    id: 'surrealism',
    label: '超现实', labelEn: 'Surrealism',
    image: '/skills/surrealism.jpg',
    prompt: 'Surrealist artwork with dreamlike impossible scenes, Dali inspired',
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [photoSlotWidth, setPhotoSlotWidth] = useState(80)
  const [inputText, setInputText] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [attachedPreviews, setAttachedPreviews] = useState<(string | null)[]>([])
  const [showChangelog, setShowChangelog] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<typeof SKILL_TEMPLATES[0] | null>(null)
  const [heroRect, setHeroRect] = useState<DOMRect | null>(null)
  const [heroExpanded, setHeroExpanded] = useState(false)
  const detailSnapRef = useRef<HTMLDivElement>(null)
  const [kbInset, setKbInset] = useState(0)
  const scrollStartY = useRef<number | null>(null)

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
      setPhotoSlotWidth(Math.round(entry.contentRect.height))
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
  }, [])

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

  const handleSkillCardClick = (template: typeof SKILL_TEMPLATES[0], e: React.MouseEvent) => {
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
    setSelectedSkill(template.skill || null)
    setInputText(template.prompt)
    const idx = SKILL_TEMPLATES.findIndex(t => t.id === template.id)
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
        </div>

        {/* ── Skill Template Grid ── */}
        <div style={{
          flex: 1,
          paddingLeft: isDesktop ? '24px' : '14px',
          paddingRight: isDesktop ? '24px' : '14px',
          paddingTop: 0,
          paddingBottom: '160px',
          maxWidth: isDesktop ? '1200px' : '520px',
          width: '100%',
          margin: '0 auto',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(2, 1fr)',
            gap: isDesktop ? '14px' : '10px',
          }}>
            {SKILL_TEMPLATES.map((template, i) => (
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
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.image}
                  alt={template.labelEn}
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
                    {locale === 'zh' ? template.label : template.labelEn}
                  </div>
                </div>

              </div>
            ))}
          </div>

        </div>

        {/* ── Bottom Input Box (fixed, always on top) ── */}
        <div style={{
          position: 'fixed', left: 0, right: 0,
          bottom: kbInset > 0 ? `${kbInset}px` : isDesktop ? '24px' : 0,
          zIndex: Z.INPUT,
          pointerEvents: 'none',
          ...(isDesktop ? {
            padding: '0 24px',
          } : {
            padding: `60px 12px ${kbInset > 0 ? '8px' : 'max(8px, env(safe-area-inset-bottom))'}`,
          }),
          transition: kbInset > 0 ? 'bottom 0.1s ease-out' : undefined,
        }}>
          {/* Gradient fade — visual only, click-through */}
          {!isDesktop && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.6) 50%, transparent 100%)',
              pointerEvents: 'none',
            }} />
          )}
          <div style={{ maxWidth: '480px', margin: '0 auto', position: 'relative', pointerEvents: 'auto' }}>
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
                background: dragOver ? 'rgba(217,70,239,0.08)' : isDesktop ? 'rgba(10,10,10,0.75)' : 'rgba(20,20,20,0.3)',
                overflow: 'hidden',
                transition: 'border-color 0.2s, background 0.2s',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            >
              {/* Left: + button / photo slot */}
              <div
                onClick={() => { if (!creating) fileInputRef.current?.click() }}
                style={{
                  width: attachedFiles.length > 0 ? photoSlotWidth : 44,
                  flexShrink: 0, alignSelf: 'stretch',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: creating ? 'default' : 'pointer',
                  borderRight: (attachedFiles.length > 0 || !selectedDetail) ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'width 0.2s ease',
                }}
              >
                {attachedFiles.length === 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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
                            position: 'absolute', inset: 0, borderRadius: 6, overflow: 'hidden',
                            transform: `rotate(${rotate}deg)`,
                            border: '1.5px solid rgba(255,255,255,0.12)',
                            background: '#1a1a1a', zIndex, boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
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
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={12} /></div>
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
                        onTouchStart={(e) => { cardTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, locked: null } }}
                        onTouchEnd={() => {
                          const touch = cardTouchRef.current; cardTouchRef.current = null
                          if (!touch || touch.locked !== 'x') { setCardDragX(0); return }
                          const idx = Math.min(cardIndex, attachedFiles.length - 1)
                          if (cardDragX < -25 && idx < attachedFiles.length - 1) setCardIndex(idx + 1)
                          else if (cardDragX > 25 && idx > 0) setCardIndex(idx - 1)
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
                          else { setAttachedFiles(prev => prev.filter((_, j) => j !== idx)); setAttachedPreviews(prev => prev.filter((_, j) => j !== idx)); if (idx >= attachedFiles.length - 1) setCardIndex(Math.max(0, idx - 1)) }
                        }
                      }}>✕</div>
                  </>
                )}
              </div>

              {/* Right: textarea + bottom toolbar */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (inputText.trim() || attachedFiles.length > 0)) {
                      e.preventDefault()
                      handleCreate()
                    }
                  }}
                  placeholder="where magic happens"
                  disabled={creating}
                  rows={1}
                  style={{
                    flex: 1, border: 'none', background: 'transparent',
                    color: 'rgba(255,255,255,0.88)', fontSize: '17px', lineHeight: 1.45,
                    padding: '12px 14px 4px',
                    outline: 'none', resize: 'none',
                    fontFamily: 'var(--font-geist-sans), sans-serif',
                    caretColor: '#d946ef',
                    minHeight: 40,
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
                        <div onClick={(e) => { e.stopPropagation(); setAttachedFiles(prev => prev.filter((_, j) => j !== i)); setAttachedPreviews(prev => prev.filter((_, j) => j !== i)) }}
                          style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'rgba(20,20,20,0.9)', border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Skill pill — shows when a template is selected */}
                  {selectedSkill && (
                    <button
                      onClick={() => { setSelectedSkill(null); setSelectedDetail(null); setHeroExpanded(false); setTimeout(() => setHeroRect(null), 350); setInputText(''); setAttachedFiles([]); setAttachedPreviews([]) }}
                      style={{
                        flexShrink: 0, padding: '4px 10px', borderRadius: 12, border: 'none',
                        background: 'rgba(217,70,239,0.15)', color: '#f0abfc',
                        fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.03em',
                        cursor: 'pointer', transition: 'all 0.15s',
                        fontFamily: 'var(--font-geist-sans), sans-serif',
                        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      {locale === 'zh'
                        ? SKILL_TEMPLATES.find(s => s.id === selectedSkill || s.skill === selectedSkill)?.label
                        : SKILL_TEMPLATES.find(s => s.id === selectedSkill || s.skill === selectedSkill)?.labelEn
                      }
                      <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>✕</span>
                    </button>
                  )}
                  <button
                    className="mkr-create-btn"
                    onClick={() => { if (inputText.trim() || attachedFiles.length > 0) handleCreate(); else fileInputRef.current?.click() }}
                    disabled={creating}
                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '14px', background: 'none', border: 'none', color: 'rgba(217,70,239,0.9)', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.03em', cursor: creating ? 'default' : 'pointer', fontFamily: 'var(--font-geist-sans), sans-serif' }}
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
          </div>
        </div>
      </div>

      {/* ── Hero fly image (card → fullscreen) ── */}
      {heroRect && selectedDetail && (
        <div style={{
          position: 'fixed', zIndex: Z.HERO_FLY, pointerEvents: 'none',
          top: heroExpanded ? 0 : heroRect.top,
          left: heroExpanded ? 0 : heroRect.left,
          width: heroExpanded ? '100vw' : heroRect.width,
          height: heroExpanded ? '100vh' : heroRect.height,
          borderRadius: heroExpanded ? 0 : 16,
          overflow: 'hidden',
          transition: 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
          opacity: heroExpanded ? 0 : 1,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedDetail.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}

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
            ...(isDesktop ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
          }}
        >
          {/* Desktop: centered card container / Mobile: full screen */}
          <div style={{
            ...(isDesktop ? {
              position: 'relative',
              width: '440px', height: '75vh',
              borderRadius: '24px', overflow: 'hidden',
              background: '#000',
            } : {
              position: 'absolute', inset: 0,
            }),
          }}>
            {/* Close button */}
            <button
              onClick={() => { setSelectedDetail(null); setSelectedSkill(null); setInputText(''); setAttachedFiles([]); setAttachedPreviews([]) }}
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
                const t = SKILL_TEMPLATES[idx]
                if (t && t.id !== selectedDetail?.id) {
                  setSelectedDetail(t)
                  setSelectedSkill(t.skill || null)
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
            {SKILL_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="mkr-detail-slide"
                style={{ height: '100%', minHeight: '100%', position: 'relative', flexShrink: 0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={template.image} alt="" loading="lazy"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.3) 35%, transparent 65%)', pointerEvents: 'none' }} />

                {/* Bottom content — above input box */}
                <div style={{ position: 'absolute', bottom: isDesktop ? '100px' : '140px', left: 0, right: 0, zIndex: 1 }}>
                  {template.skill ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
                      {(() => {
                        const isActive = template.id === selectedDetail?.id
                        const count = template.imageCount ?? 2
                        return Array.from({ length: count }, (_, i) => (
                          <div key={i}
                            onClick={() => { if (isActive && !attachedPreviews[i] && !creating) fileInputRef.current?.click() }}
                            style={{
                              width: 52, height: 52, borderRadius: 12, flexShrink: 0,
                              border: '1.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', position: 'relative', overflow: 'hidden',
                            }}>
                            {isActive && attachedPreviews[i] && attachedPreviews[i] !== 'heic-pending' ? (
                              <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={attachedPreviews[i]!} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                                <div onClick={(e) => { e.stopPropagation(); setAttachedFiles(prev => prev.filter((_, j) => j !== i)); setAttachedPreviews(prev => prev.filter((_, j) => j !== i)) }}
                                  style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', cursor: 'pointer' }}>✕</div>
                              </>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            )}
                          </div>
                        ))
                      })()}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {locale === 'zh' ? template.label : template.labelEn}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '0 16px' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
                        {locale === 'zh' ? template.label : template.labelEn}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

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
