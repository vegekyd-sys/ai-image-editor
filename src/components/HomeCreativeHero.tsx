'use client'

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { pickLocalizedValue, useLocale } from '@/lib/i18n'
import type { HomeSkill } from '@/lib/home-skills'
import { LazyVideo } from '@/components/HomeSkillMedia'
import { getThumbnailUrl } from '@/lib/supabase/storage'
import MakaronLogo from '@/components/MakaronLogo'

// Curated placement, with the live catalog retaining authority over availability and media.
const FEATURED_IDS = [
  'db0b5c25-ec77-4502-8aaf-f4bbde38e278',
  'e0b60223-480d-4428-8f8e-853b71aba6e0',
  '11d8fa9f-9c9e-4003-a604-82a10e502ff9',
  'aef03797-9d32-46f9-ba90-88b4afe9981b',
  '00ffa3a6-95bc-4b40-b303-8ace6b04ec78',
]

export function useHomeMotion() {
  // Start still on SSR; autoplay only after the system preference is known.
  const [paused, setPaused] = useState(true)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPaused(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return { paused, setPaused }
}

export default function HomeCreativeHero({ skills, paused, suspended, onSelect, children }: {
  children: ReactNode
  skills: HomeSkill[]
  paused: boolean
  suspended: boolean
  onSelect: (skill: HomeSkill, event: MouseEvent) => void
}) {
  const { t, locale } = useLocale()
  const heroRef = useRef<HTMLElement>(null)
  const featured = FEATURED_IDS.map(id => skills.find(skill => skill.id === id)).filter((skill): skill is HomeSkill => !!skill)

  useEffect(() => {
    const hero = heroRef.current
    if (!hero || paused) return
    let frame = 0
    const update = () => {
      frame = 0
      const progress = Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / hero.offsetHeight))
      hero.style.setProperty('--home-scroll', String(progress))
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      hero.style.setProperty('--home-scroll', '0')
    }
  }, [paused])

  return (
    <section className="creative-hero" data-locale={locale} id="product" ref={heroRef} aria-labelledby="creative-hero-title">
      <div className="creative-orbit">
        {featured.map((skill, index) => (
          <button type="button" key={skill.id} className={`creative-art creative-art-${index}`} onClick={event => onSelect(skill, event)} aria-label={t('homeDesign.openTemplate', pickLocalizedValue(skill.labels, locale))}>
            <div className="creative-art-frame">
              {/\.(mp4|webm)(?:[?#]|$)/i.test(skill.image) ? (
                <LazyVideo src={skill.image} eager={index < 2} suspended={suspended} paused={paused}
                  fallbackSrc={skill.before_images?.[0] ? getThumbnailUrl(skill.before_images[0], 600, 80) : undefined}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : <img src={getThumbnailUrl(skill.image, 600, 85)} alt="" loading={index < 2 ? 'eager' : 'lazy'} />}
              <span className="creative-art-caption">{pickLocalizedValue(skill.labels, locale)}<span aria-hidden="true">↗</span></span>
            </div>
          </button>
        ))}
      </div>
      <div className="creative-hero-copy">
        <div className="creative-hero-intro">
          <h1 id="creative-hero-title"><span>{t('homeDesign.title1')}</span><span>{t('homeDesign.title2')}</span></h1>
          <p>{t('homeDesign.description1')}<br />{t('homeDesign.description2')}</p>
        </div>
        <div className="creative-hero-composer" id="create">{children}</div>
        <div className="creative-actions">
          <a className="creative-text-link" href="#templates">{t('homeDesign.explore')}<span aria-hidden="true">↓</span></a>
        </div>
      </div>
    </section>
  )
}

export function HomeCreativeRibbon({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const { t } = useLocale()
  return <div className="creative-ribbon">
    <p>{t('homeDesign.ribbon')}</p>
    <button type="button" className="creative-motion-toggle" onClick={onToggle} aria-pressed={paused}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">{paused ? <path d="m5 3 8 5-8 5Z" /> : <path d="M5 2v12M11 2v12" />}</svg>{t(paused ? 'homeDesign.resume' : 'homeDesign.pause')}
    </button>
  </div>
}

export function HomeCreativeFooter() {
  const { t } = useLocale()
  return <footer className="creative-footer">
    <div className="creative-footer-bottom"><span><MakaronLogo markSize={26} /><em>{t('homeDesign.brandTagline')}</em></span><a href="/privacy">{t('homeDesign.privacy')}</a></div>
  </footer>
}
