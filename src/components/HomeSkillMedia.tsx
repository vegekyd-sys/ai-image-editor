'use client'

import {
  cacheHomeVideoPosterFromElement,
  useHomeVideoPoster,
} from '@/lib/home-video-poster'
import { normalizeDomain } from '@/lib/supabase/storage'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

function canCaptureVideoPoster(src: string): boolean {
  try {
    const isRelativeAppAsset = src.startsWith('/') && !src.startsWith('//')
    const url = new URL(src, 'https://www.makaron.app/')
    return url.protocol === 'blob:'
      || url.protocol === 'data:'
      || isRelativeAppAsset
      || url.hostname === 'makaron.app'
      || url.hostname === 'www.makaron.app'
      || url.hostname === 'cdn.makaron.app'
      || url.hostname.endsWith('.supabase.co')
  } catch {
    return false
  }
}

export function LazyVideo({
  src,
  style,
  fallbackSrc,
  eager = false,
  suspended = false,
}: {
  src: string
  style: CSSProperties
  fallbackSrc?: string
  eager?: boolean
  suspended?: boolean
}) {
  const observerRef = useRef<HTMLSpanElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureStartedForSrcRef = useRef<string | null>(null)
  const captureGenerationRef = useRef(0)
  const [isNearViewport, setIsNearViewport] = useState(eager)
  const [isVisible, setIsVisible] = useState(eager)
  const [videoReady, setVideoReady] = useState(false)
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null)
  const resolvedSrc = normalizeDomain(src)
  const shouldAttach = isNearViewport && !suspended
  const canCapturePoster = canCaptureVideoPoster(resolvedSrc)

  // Restore an already-generated poster near the viewport, but never launch a
  // second hidden video pipeline. The live card video captures its own first
  // frame after loadeddata instead.
  const cachedPoster = useHomeVideoPoster(resolvedSrc, shouldAttach, false)
  const poster = capturedPoster ?? cachedPoster

  useEffect(() => {
    const el = observerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true)
      setIsVisible(true)
      return
    }
    const nearObserver = new IntersectionObserver(([entry]) => {
      setIsNearViewport(entry.isIntersecting)
    }, { rootMargin: '60px 0px', threshold: [0, 0.05] })
    const visibleObserver = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting && entry.intersectionRatio > 0.15)
    }, { threshold: [0, 0.15] })
    nearObserver.observe(el)
    visibleObserver.observe(el)
    return () => {
      nearObserver.disconnect()
      visibleObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.playsInline = true

    if (!isVisible) {
      video.pause()
      return
    }

    const raf = window.requestAnimationFrame(() => {
      void video.play().catch(() => undefined)
    })
    return () => {
      window.cancelAnimationFrame(raf)
      video.pause()
    }
  }, [isVisible, resolvedSrc, shouldAttach, suspended])

  useEffect(() => {
    captureGenerationRef.current += 1
    setVideoReady(false)
    setCapturedPoster(null)
    captureStartedForSrcRef.current = null
  }, [resolvedSrc])

  useEffect(() => {
    if (!shouldAttach) setVideoReady(false)
  }, [shouldAttach])

  const handleVideoReady = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setVideoReady(true)
    if (!canCapturePoster || poster || captureStartedForSrcRef.current === resolvedSrc) return

    const captureGeneration = ++captureGenerationRef.current
    captureStartedForSrcRef.current = resolvedSrc
    void cacheHomeVideoPosterFromElement(resolvedSrc, video).then((nextPoster) => {
      if (
        captureGenerationRef.current !== captureGeneration
        || captureStartedForSrcRef.current !== resolvedSrc
      ) return
      if (nextPoster) {
        setCapturedPoster(nextPoster)
      } else {
        captureStartedForSrcRef.current = null
      }
    }).catch(() => {
      if (
        captureGenerationRef.current !== captureGeneration
        || captureStartedForSrcRef.current !== resolvedSrc
      ) return
      captureStartedForSrcRef.current = null
    })
  }, [canCapturePoster, poster, resolvedSrc])

  return (
    <span ref={observerRef} style={{ ...style, display: 'block', overflow: 'hidden' }}>
      <span
        aria-hidden="true"
        data-home-video-fallback="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          background: 'radial-gradient(circle at 50% 36%, rgba(255,255,255,0.12), rgba(255,255,255,0.025) 48%, rgba(0,0,0,0.18))',
        }}
      />
      {fallbackSrc && (
        <img
          src={fallbackSrc}
          alt=""
          aria-hidden="true"
          data-home-video-static-fallback="true"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'auto' : 'low'}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: 0.82,
            filter: 'blur(2px) saturate(0.82)',
            transform: 'scale(1.02)',
          }}
        />
      )}
      {poster && (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          data-home-video-poster="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {shouldAttach && (
        <video
          ref={videoRef}
          src={resolvedSrc}
          crossOrigin={canCapturePoster ? 'anonymous' : undefined}
          loop
          muted
          playsInline
          preload="metadata"
          onLoadedData={handleVideoReady}
          onCanPlay={handleVideoReady}
          onError={() => setVideoReady(false)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', opacity: videoReady ? 1 : 0, transition: 'opacity 120ms ease-out' }}
        />
      )}
    </span>
  )
}

export function SkillVideo({
  src,
  style,
  eager = false,
  active = true,
}: {
  src: string
  style: CSSProperties
  eager?: boolean
  active?: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [videoReady, setVideoReady] = useState(false)
  const resolvedSrc = normalizeDomain(src)
  const shouldAttach = eager || active
  const poster = useHomeVideoPoster(resolvedSrc, shouldAttach)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    video.playsInline = true
    if (!shouldAttach) {
      setVideoReady(false)
      video.pause()
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        // Releasing a detached Safari media pipeline is best-effort.
      }
      return
    }
    if (!active) {
      video.pause()
      return
    }
    if (eager || video.readyState === 0) video.load()
    const play = () => {
      void video.play().catch(() => {
        window.setTimeout(() => {
          video.muted = true
          void video.play().catch(() => undefined)
        }, 80)
      })
    }
    const raf = window.requestAnimationFrame(play)
    return () => window.cancelAnimationFrame(raf)
  }, [active, eager, resolvedSrc, shouldAttach])

  useEffect(() => {
    setVideoReady(false)
  }, [resolvedSrc])

  return (
    <>
      {poster && !videoReady && (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          style={{ ...style, display: 'block' }}
        />
      )}
      <video
        ref={ref}
        src={shouldAttach ? resolvedSrc : undefined}
        loop
        muted
        playsInline
        preload={shouldAttach ? (eager ? 'auto' : 'metadata') : 'none'}
        onLoadedData={() => setVideoReady(true)}
        onCanPlay={() => setVideoReady(true)}
        onError={() => setVideoReady(false)}
        style={{ ...style, opacity: videoReady ? 1 : 0, transition: 'opacity 120ms ease-out' }}
      />
    </>
  )
}
