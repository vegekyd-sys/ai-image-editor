'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useLocale } from '@/lib/i18n'
import type { HomeSkill } from '@/lib/home-skills'
import { LazyVideo } from '@/components/HomeSkillMedia'

const MODES = ['image', 'video', 'design', 'music'] as const
type Mode = typeof MODES[number]
const MOODS = ['dream', 'night', 'sunrise'] as const
type Mood = typeof MOODS[number]
const TONES = ['fuchsia', 'ice', 'paper'] as const
type Tone = typeof TONES[number]
const TONE_COLORS: Record<Tone, string> = { fuchsia: '#f27635', ice: '#2469bc', paper: '#f5eedb' }
const DESIGN_ART: Record<Tone, string> = { fuchsia: '/home-studio/design-peel.webp', ice: '/home-studio/design-light.webp', paper: '/home-studio/design-flight.webp' }
const BEFORE = '/home-studio/portrait-before.webp'
const AFTER = '/home-studio/cloud-house-after.webp'

function Arrow() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14" /></svg>
}

export default function HomeCreativeStudio({ skills, paused, suspended, onUseIdea }: {
  skills: HomeSkill[]
  paused: boolean
  suspended: boolean
  onUseIdea: (prompt: string) => void
}) {
  const { t, locale } = useLocale()
  const [mode, setMode] = useState<Mode>('image')
  const [reveal, setReveal] = useState(42)
  const [tone, setTone] = useState<Tone>('fuchsia')
  const [mood, setMood] = useState<Mood>('dream')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const playRequest = useRef(0)
  const [inView, setInView] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const videoSkill = skills.find(skill => skill.id === 'aef03797-9d32-46f9-ba90-88b4afe9981b')
  const still = paused || suspended || !inView

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 })
    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  const stopMusic = () => {
    playRequest.current += 1
    audioRef.current?.pause()
    setPlaying(false)
    setLoading(false)
  }

  useEffect(() => {
    if (mode !== 'music' || suspended || !inView) {
      playRequest.current += 1
      audioRef.current?.pause()
      setPlaying(false)
      setLoading(false)
    }
  }, [mode, suspended, inView])

  useEffect(() => {
    const audio = audioRef.current
    const hide = () => { if (document.hidden) stopMusic() }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); audio?.pause() }
  }, [])

  const playMusic = (next: Mood = mood) => {
    const audio = audioRef.current
    if (!audio) return
    const request = ++playRequest.current
    if (audio.getAttribute('src') !== `/home-studio/${next}.mp3`) {
      audio.pause()
      audio.src = `/home-studio/${next}.mp3`
      setElapsed(0)
      setDuration(0)
    }
    setAudioError(false)
    setLoading(true)
    void audio.play().catch(() => {
      if (playRequest.current === request) {
        setLoading(false)
        setPlaying(false)
        setAudioError(true)
      }
    })
  }

  const selectMood = (next: Mood) => {
    if (next === mood) return
    const resume = playing || loading
    stopMusic()
    setMood(next)
    setElapsed(0)
    setDuration(0)
    setAudioError(false)
    if (audioRef.current) audioRef.current.src = `/home-studio/${next}.mp3`
    if (resume) playMusic(next)
  }
  const time = (seconds: number) => `0:${Math.floor(seconds).toString().padStart(2, '0')}`

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % MODES.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + MODES.length - 1) % MODES.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = MODES.length - 1
    else return
    event.preventDefault()
    setMode(MODES[next])
    tabRefs.current[next]?.focus()
  }

  const useIdea = () => {
    let prompt = t(`homeStudio.${mode}.prompt`)
    if (mode === 'design') prompt += ` ${t(`homeStudio.tone.${tone}`)} — ${t(`homeStudio.concept.${tone}.description`)}`
    if (mode === 'music') prompt += ` ${t(`homeStudio.mood.${mood}.description`)}`
    onUseIdea(prompt)
  }

  return <section className="creative-studio" id="studio" ref={sectionRef} aria-labelledby="creative-studio-title" data-still={still} data-mode={mode} data-locale={locale}>
    <audio ref={audioRef} preload="none"
      onPlaying={() => { setPlaying(true); setLoading(false) }}
      onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setLoading(false) }}
      onWaiting={() => { setPlaying(false); setLoading(true) }}
      onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)}
      onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
      onError={() => { setAudioError(true); setLoading(false); setPlaying(false) }} />
    <div className="creative-studio-heading">
      <h2 id="creative-studio-title">{t('homeStudio.title1')}<br /><span>{t('homeStudio.title2')}</span></h2>
      <p>{t('homeStudio.intro1')}<br />{t('homeStudio.intro2')}</p>
    </div>
    <div className="creative-studio-body">
      <div className="creative-studio-tabs" role="tablist" aria-label={t('homeStudio.modes')}>
        {MODES.map((item, index) => <button type="button" role="tab" key={item} id={`studio-tab-${item}`} aria-selected={mode === item} aria-controls="studio-panel" tabIndex={mode === item ? 0 : -1}
          ref={element => { tabRefs.current[index] = element }}
          onKeyDown={event => moveTab(event, index)} onClick={() => setMode(item)}>
          <span className="creative-studio-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span>{t(`homeStudio.${item}.label`)}</span>
          <span className="creative-studio-tab-arrow"><Arrow /></span>
        </button>)}
      </div>
      <div className="creative-studio-panel" role="tabpanel" id="studio-panel" aria-labelledby={`studio-tab-${mode}`} tabIndex={0}>
        <div className="creative-studio-stage" data-mode={mode} key={mode}>
          {mode === 'image' && <div className="studio-compare" style={{ '--reveal': `${reveal}%` } as CSSProperties}>
            <img src={AFTER} className="studio-compare-after" alt={t('homeStudio.afterAlt')} loading="lazy" />
            <img src={BEFORE} className="studio-compare-before" alt={t('homeStudio.beforeAlt')} loading="lazy" />
            <div className="studio-compare-line" aria-hidden="true"><span><svg width="24" height="20" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m8 4-6 6 6 6m8-12 6 6-6 6" /></svg></span></div>
            <div className="studio-compare-labels"><span>{t('homeStudio.before')}</span><span>{t('homeStudio.after')}</span></div>
            <input type="range" min={5} max={95} value={reveal} onChange={event => setReveal(Number(event.target.value))} aria-label={t('homeStudio.compare')} aria-valuetext={t('homeStudio.compareValue', reveal)} />
          </div>}
          {mode === 'video' && <div className="studio-video">
            {videoSkill ? <LazyVideo src={videoSkill.image} paused={paused} suspended={suspended || !inView} fallbackSrc={videoSkill.before_images?.[0]} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} /> : <img src={AFTER} alt={t('homeStudio.afterAlt')} />}
            <span className="studio-video-caption">{t('homeStudio.video.note')}</span>
          </div>}
          {mode === 'design' && <div className="studio-design" data-tone={tone} style={{ '--poster-tone': TONE_COLORS[tone] } as CSSProperties}>
            <div className="studio-poster">
              <img key={tone} src={DESIGN_ART[tone]} alt={t(`homeStudio.concept.${tone}.description`)} loading="eager" />
              <div className="studio-poster-top"><span>{t('homeStudio.poster.issue')}</span><span>{t('homeStudio.poster.studio')}</span></div>
              <p>{t(`homeStudio.concept.${tone}.title1`)}<br /><span>{t(`homeStudio.concept.${tone}.title2`)}</span></p>
              <div className="studio-poster-bottom"><span>{t(`homeStudio.concept.${tone}.caption`)}</span><Arrow /></div>
            </div>
            <div className="studio-swatches" role="group" aria-label={t('homeStudio.palette')}>
              {TONES.map(item => <button key={item} type="button" style={{ '--swatch': TONE_COLORS[item] } as CSSProperties} aria-pressed={tone === item} onClick={() => setTone(item)}><i aria-hidden="true" /><span>{t(`homeStudio.tone.${item}`)}</span></button>)}
            </div>
          </div>}
          {mode === 'music' && <div className="studio-music" data-mood={mood} data-playing={playing}>
            <img className="studio-vinyl" src="/home-studio/makaron-vinyl.webp" alt={t('homeStudio.vinylAlt')} loading="lazy" />
            <div className="studio-music-copy"><p>{t(`homeStudio.mood.${mood}.label`)}</p><span>{t(`homeStudio.mood.${mood}.description`)}</span></div>
            <div className="studio-audio-controls">
              <button type="button" onClick={() => playing || loading ? stopMusic() : playMusic()} aria-label={t(playing || loading ? 'homeStudio.music.pause' : 'homeStudio.music.play')}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">{playing || loading ? <path d="M4 3h3v12H4zm7 0h3v12h-3z" /> : <path d="m5 2 11 7-11 7z" />}</svg>
              </button>
              <span>{loading ? t('homeStudio.music.loading') : `${time(elapsed)} / ${time(duration || 8.5)}`}</span>
            </div>
            {audioError && <span className="studio-audio-error" role="alert">{t('homeStudio.music.error')}</span>}
            <div className="studio-wave" aria-hidden="true">{Array.from({ length: 36 }, (_, index) => <i key={index} style={{ '--bar': `${18 + ((index * 19 + 7) % 67)}%`, '--delay': `${index * -0.11}s` } as CSSProperties} />)}</div>
            <div className="studio-moods" role="group" aria-label={t('homeStudio.moodSelector')}>
              {MOODS.map(item => <button type="button" key={item} className="mkr-liquid-pill" aria-pressed={mood === item} onClick={() => selectMood(item)}>{t(`homeStudio.mood.${item}.label`)}</button>)}
            </div>
            <span className="studio-music-note">{t('homeStudio.music.note')}</span>
          </div>}
        </div>
        <div className="creative-studio-caption">
          <p>{t(`homeStudio.${mode}.description`)}</p>
          <button type="button" onClick={useIdea}>{t('homeStudio.useIdea')}<Arrow /></button>
        </div>
      </div>
    </div>
  </section>
}
