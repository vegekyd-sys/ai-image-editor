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
  // --- Featured (new assets) ---
  {
    id: 'photo-to-video',
    label: '照片变视频', labelEn: 'Photo to Video',
    image: '/skills/photo-to-video.jpg',
    prompt: 'Turn my photo into a cinematic short video with dramatic camera movement',
    skill: 'photo-to-video' as string | undefined,
    imageCount: 1 as number | undefined,
  },
  {
    id: 'animated-gif',
    label: '动态表情包', labelEn: 'Animated GIF',
    image: '/skills/animated-gif.gif',
    prompt: 'Turn our selfie into a fun animated GIF with expressive movements',
    skill: 'animated-gif' as string | undefined,
    imageCount: undefined as number | undefined,
  },
  {
    id: 'attack-on-titan',
    label: '进击的巨人', labelEn: 'Attack on Titan',
    image: '/skills/attack-on-titan.jpg',
    prompt: 'Put me on top of the Wall from Attack on Titan, wearing the Survey Corps green cloak with Wings of Freedom emblem, 3D maneuvering gear on my waist, looking back at camera with a determined fearless expression. Behind me the skinless Colossal Titan head looms over the wall, steam pouring from its muscles. Dramatic orange sunset sky, ruined city far below. Epic cinematic wide shot, my figure small against the massive titan.',
  },
  {
    id: 'glass-shatter',
    label: '破屏而出', labelEn: 'Glass Shatter',
    image: '/skills/glass-shatter.jpg',
    prompt: 'Transform my photo into a dramatic action shot — I am punching straight through a glass screen toward the viewer, my fist thrust forward in the center of the frame with glass shards exploding outward frozen in mid-air. Give me bleached blonde messy hair, a black leather jacket, a bruise under one eye, and a fierce angry snarl. Teal and warm orange backlight rim-lighting my silhouette. Dark warehouse background. HBO Original Series logo in bottom-left corner. Shot with ultra-wide lens making my fist look huge.',
  },
  {
    id: 'squid-game-player',
    label: '鱿鱼游戏', labelEn: 'Squid Game',
    image: '/skills/squid-game-player.jpg',
    prompt: 'Put me in the Squid Game Red Light Green Light scene — I am wearing the green tracksuit #456, running toward camera with a terrified but determined expression. A woman with shoulder-length black hair in tracksuit #067 runs beside me on my left. Behind us, the giant robotic doll in yellow and orange dress towers over the sandy field, her head turned toward us. Other players in green tracksuits frozen mid-run in the background. Harsh overhead floodlights, overcast sky, dust kicked up. Netflix cinematic quality.',
  },
  {
    id: 'jujutsu-gojo',
    label: '咒术回战', labelEn: 'Jujutsu Kaisen',
    image: '/skills/jujutsu-gojo.jpg',
    prompt: 'Place me standing back-to-back with photorealistic 3D CGI Gojo Satoru from Jujutsu Kaisen on a destroyed Shibuya rooftop at night. I am on the left wearing a black leather jacket, arms crossed with a confident smirk. Gojo is on the right — tall, white spiky hair, black blindfold, dark blue high-collar uniform, one hand raised with blue Infinity sphere spinning. Purple cursed energy lightning cracks across the dark stormy sky, a dark curse silhouette lurks in the clouds. "SHIBUYA INCIDENT" text at the bottom. Movie poster composition, both figures equally prominent.',
  },
  {
    id: 'totoro-forest',
    label: '龙猫森林', labelEn: 'Totoro Forest',
    image: '/skills/totoro-forest.jpg',
    prompt: 'Put me sitting on the big furry belly of a massive photorealistic CGI Totoro in a lush ancient forest. I am leaning back against his soft grey fur, laughing with mouth wide open and pure joy. Totoro has his iconic wide toothy grin. Tiny black soot sprites (susuwatari) float all around us. The Catbus (furry cat-shaped bus with glowing eyes) peeks from between mossy tree trunks in the background. Golden sunlight streams through the giant camphor tree canopy. I am wearing a denim jacket and converse sneakers. Studio Ghibli live-action movie quality.',
  },
  {
    id: 'onepiece-gear5',
    label: '海贼王·尼卡', labelEn: 'One Piece Gear 5',
    image: '/skills/onepiece-gear5.jpg',
    prompt: 'Put me on the wooden deck bow of the Thousand Sunny pirate ship, running and laughing wildly with mouth wide open next to a photorealistic 3D CGI Luffy in Gear 5 Sun God Nika form — white rubbery cartoon-like skin, wild flowing white hair upward, huge exaggerated grin, white shirt open showing abs, purple sash. We are side by side, both mid-stride. I am wearing a black crop top with a skull-and-crossbones Straw Hat logo and denim shorts. Massive stormy ocean waves crash behind us, wind blowing our hair dramatically.',
  },
  {
    id: 'spirited-away',
    label: '千与千寻', labelEn: 'Spirited Away',
    image: '/skills/spirited-away-train.jpg',
    prompt: 'Place me standing barefoot on railway tracks that stretch across an endless calm ocean, looking back over my shoulder at camera with a gentle mysterious smile, long dark hair flowing in the wind. I am wearing a white summer dress. An old weathered red Japanese train approaches from behind in the distance, its headlights on. Shallow water covers the wooden track ties creating perfect mirror reflections of the pink and orange sunset sky. The scene is serene and dreamlike. Spirited Away sea train brought to life as a photograph. Golden hour warm lighting.',
  },
  {
    id: 'iron-throne',
    label: '铁王座', labelEn: 'Iron Throne',
    image: '/skills/iron-throne-dragon.jpg',
    prompt: 'Put me sitting on the Iron Throne from Game of Thrones — legs crossed, hands gripping the sword armrests, chin raised with a cold commanding stare directly at camera. I am wearing a red latex high-slit dress, a thin gold crown, sharp bob haircut with blunt bangs, bold red lips, gold shimmer on my cheekbones. A small dragon perches on my right shoulder breathing a burst of fire. Dark gothic stone throne room lit only by candles and fire braziers. The mood is dangerous, seductive, and regal.',
  },
  {
    id: 'titan-half-face',
    label: '巨人化', labelEn: 'Titan Transform',
    image: '/skills/titan-half-face.jpg',
    prompt: 'Extreme close-up of my face filling the entire frame — the left half is my real face with smudged dark eyeliner, a lip ring, battle scars, and an intense unblinking stare. The right half seamlessly morphs into an Attack on Titan titan form: exposed red muscles and tendons, no skin, one glowing green eye, steam rising where skin meets muscle along the center split line. "THE RUMBLING" text in large white font at the top. Warm sunset city skyline blurred in the background. Movie poster quality.',
  },
  {
    id: 'ghost-in-shell',
    label: '攻壳机动队', labelEn: 'Ghost in the Shell',
    image: '/skills/ghost-in-shell.jpg',
    prompt: 'Shot directly from above looking straight down — I am lying on my back in a shallow neon-lit puddle on a Tokyo rooftop at night. My platinum blonde hair fans out like Medusa tendrils in the dark water. I am wearing a sheer black mesh bodysuit with chrome chain harness across my chest, gripping the center ring with both hands. My eyes are wide open staring straight up at the camera with an intense provocative gaze. Neon reflections in the water — cyan, magenta, green — from surrounding signs. Holographic Japanese kanji (電脳, 攻殻) and UI overlays glow around me. Rain droplets frozen mid-air.',
  },
  {
    id: 'squid-game-vip',
    label: '鱿鱼游戏 VIP', labelEn: 'Squid Game VIP',
    image: '/skills/squid-game-vip.jpg',
    prompt: 'Put me walking down the center of a neon-lit pink corridor from Squid Game VIP area. I am wearing a perfectly tailored black suit with black shirt, a gold ornate owl mask pushed up onto my forehead, adjusting my right cufflink with a cold arrogant smirk. Flanking me on each side: a Squid Game guard in hot pink jumpsuit — left guard has a triangle mask, right guard has a circle mask, both standing at rigid attention with hands behind back. The corridor recedes behind me with repeating rectangular pink and green fluorescent light frames.',
  },
  {
    id: 'time-freeze',
    label: '时间冻结', labelEn: 'Time Freeze',
    image: '/skills/time-freeze.jpg',
    prompt: 'Transform my photo into a zero-gravity frozen moment — I am jumping mid-air in the center of a living room with a huge surprised laugh, arms and legs spread wide. Everything around me is suspended in zero gravity: a white coffee mug with brown coffee splashing out frozen mid-splash, an iPhone floating screen-on, white AirPods hovering, cereal pieces scattered like confetti, newspaper pages mid-flutter, polaroid photos floating, and an orange tabby cat mid-leap with arched back to my right. Warm morning sunlight from a large window behind me. Ultra-wide angle lens from low angle.',
  },
  {
    id: 'skyscraper-spiderman',
    label: '摩天蜘蛛侠', labelEn: 'Skyscraper Climb',
    image: '/skills/skyscraper-spiderman.jpg',
    prompt: 'Put me crouching on the vertical glass wall of a skyscraper at night, defying gravity like Spider-Man. I am wearing a dark bomber jacket and cargo pants, white sneakers planted flat against the glass. My hair falls sideways from gravity. I am looking directly at camera with a cocky confident grin. Below me (appearing as sideways) the city streets are 50+ stories down — tiny cars, neon signs, streetlights stretching into the distance. The shot is taken from a drone at the same height, creating a vertigo-inducing perspective where the building wall looks like the ground.',
  },
  {
    id: 'snow-globe',
    label: '水晶球女王', labelEn: 'Snow Globe',
    image: '/skills/snow-globe-queen.jpg',
    prompt: 'Place me inside a giant crystal snow globe installed in the middle of Times Square New York at night. I am sitting elegantly on a golden crescent moon inside the sphere, wearing a flowing red sparkly ball gown. Artificial snow swirls around me inside the glass. Outside the globe, a crowd of people in winter coats stands watching and taking photos with their phones held up — shot from behind the crowd looking in at me. The globe glows warmly from within (golden light) contrasting the cold blue LED billboards of Times Square behind.',
  },
  {
    id: 'anti-gravity',
    label: '反重力宫殿', labelEn: 'Anti-Gravity',
    image: '/skills/anti-gravity-palace.jpg',
    prompt: 'Place me sitting calmly in an ornate golden chair on the ceiling of a baroque palace room — I am upside down relative to the floor. I am wearing a tailored black suit with a loosened black tie, legs crossed casually, one hand resting on the chair arm. My hair and tie hang downward (toward the floor above me). Below me (the actual floor), crystal chandeliers hang upward as if gravity is reversed. Renaissance ceiling frescoes are behind my head. The room has teal and gold color palette. Disorienting Inception-style perspective — the viewer cannot tell which way is up.',
  },
  {
    id: 'boa-hancock',
    label: '女帝约会', labelEn: 'Boa Hancock Date',
    image: '/skills/boa-hancock-bar.jpg',
    prompt: 'Put me sitting at a dark moody bar counter, sipping whiskey from a rocks glass with a slight knowing smirk. Next to me sits a photorealistic 3D CGI Boa Hancock from One Piece — impossibly beautiful with long straight black hair, glowing pink heart-shaped eyes (her love-love beam), red silk qipao top, gold snake earrings. She is leaning toward me with an adoring expression. Warm amber tungsten bar lighting, rows of backlit whiskey bottles blurred in the bokeh background. Intimate date night atmosphere.',
  },
  {
    id: 'android18',
    label: '18号公路', labelEn: 'Android 18',
    image: '/skills/android18-desert.jpg',
    prompt: 'Place me leaning against a chrome motorcycle on an empty desert highway at golden hour. Next to me stands a photorealistic 3D CGI Android 18 from Dragon Ball Z — sharp blonde bob haircut, piercing icy blue eyes, denim vest over a striped shirt, arms crossed with her signature cold confident expression. I am wearing a black leather jacket, matching her crossed-arms cool attitude. Dusty desert road stretches to the horizon, warm golden backlight, dust particles in the air. Cinematic wide shot, both of us equally prominent.',
  },
  {
    id: 'zerotwo-selfie',
    label: '02自拍', labelEn: 'Zero Two Selfie',
    image: '/skills/zerotwo-selfie.jpg',
    prompt: 'Make it look like I am taking a selfie with photorealistic 3D CGI Zero Two from Darling in the Franxx. She has long pink hair, small red horns on a white headband, bright emerald green eyes, and is doing her playful tongue-out lick toward the camera. She wears her red and white military pilot suit (partially unzipped) and is wrapping one arm possessively around my neck, pulling me close. I am blushing and grinning. Cherry blossom trees behind us with pink petals falling everywhere. Bright spring sunlight, shallow depth of field. Selfie camera angle (slightly above, close-up).',
  },
  {
    id: 'makima-rooftop',
    label: '玛奇玛天台', labelEn: 'Makima Rooftop',
    image: '/skills/makima-rooftop.jpg',
    prompt: 'Put me sitting on a concrete rooftop ledge at night in Tokyo. Next to me crouches a photorealistic 3D CGI Makima from Chainsaw Man — she has auburn red-brown hair in long braids, distinctive yellow ringed spiral eyes that glow faintly, wearing a white dress shirt, black necktie, and dark overcoat. She is reaching toward me and holding my chin with one finger, tilting my face toward her with a cold, knowing, seductive smile. I look mesmerized and slightly nervous. Tokyo skyline glitters far below behind us. Dark moody cinematic lighting with a red color accent from a neon sign.',
  },
  {
    id: 'sunglasses-twinning',
    label: '墨镜双胞胎', labelEn: 'Sunglasses Twinning',
    image: '/skills/sunglasses-twinning.jpg',
    prompt: 'Put matching white oversized retro sunglasses on my pet, same style as mine. We are both looking at camera with the same sassy duck-face attitude. Keep the same framing, lighting, and background. The pet should look like it is posing on purpose. Fun twinning moment, bright playful energy.',
  },
  {
    id: 'holi-portrait',
    label: '洒红节', labelEn: 'Holi Festival',
    image: '/skills/holi-portrait.jpg',
    prompt: 'Cover me in vibrant Holi festival color powder — thick splashes of pink, teal green, bright orange, and yellow across my face, buzzed hair, and white linen shirt. Add a garland of pink and cream flowers draped around my neck. I look serene with a calm proud expression, chin slightly raised, looking off to the side. Dramatic warm side-lighting from the left against a deep matte purple background. The colored powder looks freshly thrown and still dusty. Editorial portrait photography quality, sharp focus on every powder grain.',
  },
  // --- Classic styles ---
  {
    id: 'night-flash',
    label: '夜拍闪光', labelEn: 'Night Flash',
    image: '/skills/night-flash.jpg',
    prompt: 'Night photography with flash, urban street style',
  },
  {
    id: 'pixel-art',
    label: '像素风', labelEn: 'Pixel Art',
    image: '/skills/pixel-art.jpg',
    prompt: 'Pixel art style retro gaming aesthetic, 16-bit detailed scene',
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
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const [inputWrapperHeight, setInputWrapperHeight] = useState(0)
  const [inputText, setInputText] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [attachedPreviews, setAttachedPreviews] = useState<(string | null)[]>([])
  const [showChangelog, setShowChangelog] = useState(false)
  const [slotDragOver, setSlotDragOver] = useState(-1)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<typeof SKILL_TEMPLATES[0] | null>(null)
  const [heroRect, setHeroRect] = useState<DOMRect | null>(null)
  const [heroExpanded, setHeroExpanded] = useState(false)
  const detailSnapRef = useRef<HTMLDivElement>(null)
  const [kbInset, setKbInset] = useState(0)
  const scrollStartY = useRef<number | null>(null)
  const inlineInputRef = useRef<HTMLDivElement>(null)
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [showFixedInput, setShowFixedInput] = useState(false)

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
      setPhotoSlotWidth(h)
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
  }, [attachedFiles.length])

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

  const removeFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, j) => j !== index))
    setAttachedPreviews(prev => prev.filter((_, j) => j !== index))
  }, [])

  const handleSlotDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files ?? []).filter(f => f.type.startsWith('image/') || isHeicFile(f))
    addFiles(files)
  }, [addFiles])

  const renderUploadSlots = useCallback((template: { imageCount?: number }, isActive: boolean) => {
    const count = template.imageCount ?? 1
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

  const renderTemplateLabel = (template: { label: string; labelEn: string }) => (
    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>
      {locale === 'zh' ? template.label : template.labelEn}
    </div>
  )

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

          {/* ── Inline Input Box (in document flow, like projects page) ── */}
          <div ref={inlineInputRef} style={{
            marginTop: '24px', width: '100%', maxWidth: '480px', padding: '0 16px',
          }}>
            <div
              className="mkr-input-box"
              onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false) } }}
              onDrop={handleDrop}
              style={{
                display: 'flex', gap: 0,
                borderRadius: 18,
                border: dragOver ? '1px solid rgba(217,70,239,0.6)' : '1px solid rgba(255,255,255,0.1)',
                background: dragOver ? 'rgba(217,70,239,0.08)' : 'rgba(255,255,255,0.03)',
                overflow: 'hidden',
                transition: 'border-color 0.2s, background 0.2s',
              }}
            >
              <div
                onClick={() => { if (!creating) fileInputRef.current?.click() }}
                style={{
                  width: 52, minHeight: 52, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: creating ? 'default' : 'pointer',
                  borderRight: '1px solid rgba(255,255,255,0.08)',
                  position: 'relative', overflow: 'hidden',
                }}
              >
                {attachedFiles.length === 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                ) : (
                  <>
                    {attachedPreviews[0] && attachedPreviews[0] !== 'heic-pending' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attachedPreviews[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Spinner size={16} />
                    )}
                    {attachedFiles.length > 1 && (
                      <div style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(217,70,239,0.85)', color: '#fff', borderRadius: 6, padding: '0 5px', fontSize: '0.55rem', fontWeight: 700 }}>
                        {attachedFiles.length}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <textarea
                  ref={inlineTextareaRef}
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
                  rows={1}
                  style={{
                    border: 'none', background: 'transparent',
                    color: 'rgba(255,255,255,0.88)', fontSize: '17px', lineHeight: 1.45,
                    padding: '12px 14px 4px',
                    outline: 'none', resize: 'none',
                    fontFamily: 'inherit',
                    caretColor: '#d946ef',
                    minHeight: 40, maxHeight: selectedDetail ? 40 : '8rem',
                    overflowY: selectedDetail ? 'hidden' : 'auto',
                    display: 'block', width: '100%',
                    ...(selectedDetail ? { textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 8px 8px' }}>
                  <button
                    className="mkr-create-btn"
                    onClick={() => { if (inputText.trim() || attachedFiles.length > 0) handleCreate(); else fileInputRef.current?.click() }}
                    disabled={creating}
                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '14px', background: 'none', border: 'none', color: 'rgba(217,70,239,0.9)', fontSize: '17px', fontWeight: 500, letterSpacing: '0.03em', cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit' }}
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
                  ...(heroRect && selectedDetail?.id === template.id ? { opacity: 0 } : {}),
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
            {/* No scrim div — boxShadow on input box handles glow */}
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
                border: dragOver ? '1px solid rgba(217,70,239,0.6)' : '1px solid rgba(255,255,255,0.18)',
                background: dragOver ? 'rgba(217,70,239,0.08)' : 'rgba(15,15,15,0.65)',
                overflow: 'hidden',
                transition: 'border-color 0.2s, background 0.2s',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                pointerEvents: 'auto',
                boxShadow: '0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.8), 0 0 60px 30px rgba(0,0,0,0.5)',
              }}
            >
              {/* Left: + button / photo slot — collapses when detail overlay open */}
              <div
                onClick={() => { if (!creating && !selectedDetail) fileInputRef.current?.click() }}
                style={{
                  width: selectedDetail ? 0 : 52,
                  minHeight: 52,
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: creating || selectedDetail ? 'default' : 'pointer',
                  borderRight: selectedDetail ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'width 0.25s cubic-bezier(0.22, 1, 0.36, 1), border-right 0.2s',
                }}
              >
                {attachedFiles.length === 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
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
                  onChange={(e) => { userTypingRef.current = true; setInputText(e.target.value) }}
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
                    border: 'none', background: 'transparent',
                    color: 'rgba(255,255,255,0.88)', fontSize: '17px', lineHeight: 1.45,
                    padding: '12px 14px 4px',
                    outline: 'none', resize: 'none',
                    fontFamily: 'inherit',
                    caretColor: '#d946ef',
                    minHeight: 40,
                    maxHeight: '8rem',
                    overflowY: 'auto',
                    display: 'block',
                    width: '100%',
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
                        fontFamily: 'inherit',
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
                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '14px', background: 'none', border: 'none', color: 'rgba(217,70,239,0.9)', fontSize: '17px', fontWeight: 500, letterSpacing: '0.03em', cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit' }}
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
