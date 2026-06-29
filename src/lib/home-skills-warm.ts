'use client'

import { type HomeSkill, getCachedHomeSkills, setCachedHomeSkills } from '@/lib/home-skills'
import { cacheMediaUrl } from '@/lib/imageCache'
import { readNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache'
import { getThumbnailUrl, normalizeDomain } from '@/lib/supabase/storage'

const VIDEO_RETAIN_LIMIT = 8
const warmedMedia = new Set<string>()
const retainedVideos: HTMLVideoElement[] = []
let inFlight: Promise<HomeSkill[] | null> | null = null

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function warmWhenIdle(task: () => void): void {
  if (typeof window === 'undefined') return
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(task, { timeout: 1500 })
  } else {
    globalThis.setTimeout(task, 250)
  }
}

export function warmHomeSkillMedia(skills: HomeSkill[], limit = 10): void {
  if (typeof window === 'undefined' || skills.length === 0) return

  warmWhenIdle(() => {
    const covers = skills.slice(0, limit).map((skill) => skill.image).filter(Boolean)
    const beforeImages = skills
      .slice(0, 6)
      .flatMap((skill) => (skill.before_images || []).slice(0, 2))

    for (const url of [...covers, ...beforeImages]) {
      if (warmedMedia.has(url)) continue
      warmedMedia.add(url)

      if (isVideoUrl(url)) {
        const normalizedUrl = normalizeDomain(url)
        void cacheMediaUrl(normalizedUrl).then((cachedSrc) => {
          const video = document.createElement('video')
          video.muted = true
          video.playsInline = true
          video.preload = 'auto'
          video.src = cachedSrc ?? normalizedUrl
          try {
            video.load()
          } catch {
            // Media warmup is best-effort.
          }
          retainedVideos.push(video)
          if (retainedVideos.length > VIDEO_RETAIN_LIMIT) retainedVideos.shift()
        })
        continue
      }

      const img = new Image()
      img.decoding = 'async'
      img.src = getThumbnailUrl(url, 400, 70, 533, 'cover')
    }
  })
}

export function warmHomeSkillsCache(): Promise<HomeSkill[] | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)

  const cached = readNativeJSONCache<HomeSkill[]>('/api/home-skills') ?? getCachedHomeSkills()
  if (cached.length > 0) warmHomeSkillMedia(cached)

  if (inFlight) return inFlight
  inFlight = fetch('/api/home-skills', { credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return cached.length > 0 ? cached : null
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return cached.length > 0 ? cached : null
      writeNativeJSONCache('/api/home-skills', data)
      setCachedHomeSkills(data)
      warmHomeSkillMedia(data)
      return data as HomeSkill[]
    })
    .catch(() => cached.length > 0 ? cached : null)
    .finally(() => {
      inFlight = null
    })

  return inFlight
}
