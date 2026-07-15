'use client'

import { cacheMediaBlob, getCachedMediaObjectUrl } from '@/lib/imageCache'
import { normalizeDomain } from '@/lib/supabase/storage'
import { useEffect, useState } from 'react'

const POSTER_PREFIX = 'media:home-video-poster:'
const POSTER_TIMEOUT_MS = 4500
const POSTER_MAX_WIDTH = 480

const posterCache = new Map<string, string | null>()
const posterInFlight = new Map<string, Promise<string | null>>()
let posterQueue: Promise<unknown> = Promise.resolve()

function posterStorageKey(src: string): string {
  return `${POSTER_PREFIX}${src}`
}

function readMemoryPoster(src: string): string | null | undefined {
  if (posterCache.has(src)) return posterCache.get(src) ?? null
  return undefined
}

function storeMemoryPoster(src: string, poster: string | null): void {
  posterCache.set(src, poster)
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72)
  })
}

function capturePosterFrame(videoSrc: string): Promise<Blob | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const video = document.createElement('video')
    let settled = false
    let timeoutId = 0

    const finish = (poster: Blob | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      video.pause()
      video.removeAttribute('src')
      try {
        video.load()
      } catch {}
      resolve(poster)
    }

    const draw = async () => {
      const width = video.videoWidth
      const height = video.videoHeight
      if (!width || !height) {
        finish(null)
        return
      }

      try {
        const scale = Math.min(1, POSTER_MAX_WIDTH / width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          finish(null)
          return
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(await canvasToJpegBlob(canvas))
      } catch {
        finish(null)
      }
    }

    timeoutId = window.setTimeout(() => finish(null), POSTER_TIMEOUT_MS)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.addEventListener('loadeddata', draw, { once: true })
    video.addEventListener('error', () => finish(null), { once: true })
    video.src = videoSrc
    try {
      video.load()
    } catch {
      finish(null)
    }
  })
}

export function getCachedHomeVideoPoster(src: string): string | null {
  const normalizedSrc = normalizeDomain(src)
  return readMemoryPoster(normalizedSrc) ?? null
}

export function warmHomeVideoPoster(src: string): Promise<string | null> {
  const normalizedSrc = normalizeDomain(src)
  const cached = readMemoryPoster(normalizedSrc)
  if (cached !== undefined) return Promise.resolve(cached)

  const inFlight = posterInFlight.get(normalizedSrc)
  if (inFlight) return inFlight

  const task = posterQueue
    .catch(() => undefined)
    .then(async () => {
      const posterKey = posterStorageKey(normalizedSrc)
      const cachedPoster = await getCachedMediaObjectUrl(posterKey)
      if (cachedPoster) {
        storeMemoryPoster(normalizedSrc, cachedPoster)
        return cachedPoster
      }

      // Let the media element issue a range/stream request. Fetching the whole
      // MP4 into a Blob here made Safari download tens of megabytes at startup.
      const posterBlob = await capturePosterFrame(normalizedSrc)
      const poster = posterBlob
        ? await cacheMediaBlob(posterKey, posterBlob, 'image/jpeg')
        : null
      storeMemoryPoster(normalizedSrc, poster)
      return poster
    })
    .finally(() => {
      posterInFlight.delete(normalizedSrc)
    })

  posterInFlight.set(normalizedSrc, task)
  posterQueue = task
  return task
}

export function useHomeVideoPoster(src: string, enabled: boolean): string | null {
  const normalizedSrc = normalizeDomain(src)
  const [poster, setPoster] = useState<string | null>(() => getCachedHomeVideoPoster(normalizedSrc))

  useEffect(() => {
    let cancelled = false
    setPoster(getCachedHomeVideoPoster(normalizedSrc))
    if (!enabled) return

    warmHomeVideoPoster(normalizedSrc).then((nextPoster) => {
      if (!cancelled && nextPoster) setPoster(nextPoster)
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [enabled, normalizedSrc])

  return poster
}
