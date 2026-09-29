'use client'

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { pickLocalizedValue, useLocale } from '@/lib/i18n'
import type { HomeSkill } from '@/lib/home-skills'
import { LazyVideo } from '@/components/HomeSkillMedia'
import { getThumbnailUrl } from '@/lib/supabase/storage'
import MakaronLogo from '@/components/MakaronLogo'
import heroPreviews from '@/lib/home-hero-previews.json'

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

export default function HomeCreativeHero({ skills, paused, suspended, activeSkillId, onSelect, children }: {
  activeSkillId?: string
  children: ReactNode
  skills: HomeSkill[]
  paused: boolean
  suspended: boolean
  onSelect: (skill: HomeSkill, event: MouseEvent) => void
}) {
  const { t, locale } = useLocale()
  const heroRef = useRef<HTMLElement>(null)
  const [mobileComposition, setMobileComposition] = useState(false)
  const [viewportReady, setViewportReady] = useState(false)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    const hero = heroRef.current
    if (!hero) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.01 })
    observer.observe(hero)
    const visibility = () => setPageVisible(!document.hidden)
    const focus = () => setEditing(Boolean(hero.querySelector('input:focus, textarea:focus, [contenteditable="true"]:focus')))
    visibility()
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', focus)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', focus)
    }
  }, [])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => { setMobileComposition(query.matches); setViewportReady(true) }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const still = paused || suspended || !inView || !pageVisible || editing
  // Reserve bandwidth and compositor capacity for controls and route chunks.
  const canPreview = (index: number) => index === 4 || (!mobileComposition && index === 0)
  const previewFor = (skill: HomeSkill) => {
    const preview = heroPreviews[skill.id as keyof typeof heroPreviews]
    // Catalog changes invalidate the baked preview; details always retain the original.
    return preview?.source === skill.image ? preview.preview : skill.image
  }
  const posterFor = (skill: HomeSkill) => {
    const preview = heroPreviews[skill.id as keyof typeof heroPreviews]
    return preview?.source === skill.image ? preview.poster : undefined
  }
  const featured = FEATURED_IDS.map(id => skills.find(skill => skill.id === id)).filter((skill): skill is HomeSkill => !!skill)


  return (
    <section className="creative-hero creative-hero-orbital" data-locale={locale} data-still={still} id="product" ref={heroRef} aria-labelledby="creative-hero-title">
      <div className="creative-orbit">
        {featured.map((skill, index) => (
          <button type="button" key={skill.id} className={`creative-art creative-art-${index}`} style={activeSkillId === skill.id ? { opacity: 0 } : undefined} inert={mobileComposition && index === 3 ? true : undefined} onClick={event => onSelect(skill, event)} aria-label={t('homeDesign.openTemplate', pickLocalizedValue(skill.labels, locale))}>
            <div className="creative-art-frame">
              {/\.(mp4|webm)(?:[?#]|$)/i.test(skill.image) ? (
                <LazyVideo src={previewFor(skill)} eager={index === 0} suspended={suspended || !viewportReady || !canPreview(index)} paused={still}
                  posterSrc={posterFor(skill)}
                  fallbackSrc={skill.before_images?.[0] ? getThumbnailUrl(skill.before_images[0], 600, 80) : undefined}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : <img src={getThumbnailUrl(skill.image, 600, 85)} alt="" loading={index < 2 ? 'eager' : 'lazy'} />}
              <span className="creative-art-caption">{pickLocalizedValue(skill.labels, locale)}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="creative-hero-copy">
        <div className="creative-hero-intro">
          <h1 id="creative-hero-title"><span>{t('homeOrbit.title1')}</span><span>{t('homeOrbit.title2')}</span></h1>
          <p>{t('homeOrbit.description1')}<br /><span className="creative-description-desktop">{t('homeOrbit.description2')}</span><span className="creative-description-mobile">{t('homeOrbit.mobileDescription')}</span></p>
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
  return <div className="creative-ribbon creative-ribbon-compact">
    <button type="button" className="creative-motion-toggle mkr-liquid-pill" onClick={onToggle} aria-pressed={paused}>
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
