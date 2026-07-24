import React from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const posterMocks = vi.hoisted(() => ({
  capture: vi.fn<(src: string, video: HTMLVideoElement) => Promise<string | null>>(
    () => Promise.resolve('blob:captured-poster'),
  ),
  poster: 'blob:restored-poster' as string | null,
}))

vi.mock('@/lib/home-video-poster', () => ({
  cacheHomeVideoPosterFromElement: posterMocks.capture,
  useHomeVideoPoster: () => posterMocks.poster,
}))

vi.mock('@/lib/supabase/storage', () => ({
  normalizeDomain: (src: string) => src,
}))

import { LazyVideo } from '@/components/HomeSkillMedia'

type ObserverEntry = Pick<IntersectionObserverEntry, 'isIntersecting' | 'intersectionRatio'>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly callback: IntersectionObserverCallback
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = '0px'
  thresholds = [0]

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  trigger(entry: ObserverEntry) {
    this.callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

describe('home skill video lifecycle', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = []
    posterMocks.poster = 'blob:restored-poster'
    posterMocks.capture.mockClear()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  })

  it('keeps a poster visible while a detached video re-enters and reloads', async () => {
    const { container } = render(
      <LazyVideo
        src="https://cdn.makaron.app/cover.mp4"
        style={{ position: 'absolute', inset: 0 }}
      />,
    )

    expect(MockIntersectionObserver.instances).toHaveLength(2)
    expect(container.querySelector('video')).toBeNull()

    act(() => {
      MockIntersectionObserver.instances[0].trigger({ isIntersecting: true, intersectionRatio: 1 })
      MockIntersectionObserver.instances[1].trigger({ isIntersecting: true, intersectionRatio: 1 })
    })

    let video = container.querySelector('video') as HTMLVideoElement
    expect(video).toBeTruthy()
    expect(video.style.opacity).toBe('0')
    expect(container.querySelector('[data-home-video-poster="true"]')).toBeTruthy()

    fireEvent.loadedData(video)
    expect(video.style.opacity).toBe('1')

    act(() => {
      MockIntersectionObserver.instances[0].trigger({ isIntersecting: false, intersectionRatio: 0 })
      MockIntersectionObserver.instances[1].trigger({ isIntersecting: false, intersectionRatio: 0 })
    })

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('[data-home-video-poster="true"]')).toBeTruthy()

    act(() => {
      MockIntersectionObserver.instances[0].trigger({ isIntersecting: true, intersectionRatio: 1 })
      MockIntersectionObserver.instances[1].trigger({ isIntersecting: true, intersectionRatio: 1 })
    })

    video = container.querySelector('video') as HTMLVideoElement
    expect(video).toBeTruthy()
    expect(video.style.opacity).toBe('0')
    expect(container.querySelector('[data-home-video-poster="true"]')).toBeTruthy()

    fireEvent.error(video)
    expect(video.style.opacity).toBe('0')

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
  })

  it('captures from the already-loaded card video instead of starting a second pipeline', async () => {
    posterMocks.poster = null
    const { container } = render(
      <LazyVideo
        src="https://cdn.makaron.app/new-cover.mp4"
        style={{ position: 'absolute', inset: 0 }}
        eager
      />,
    )

    const video = container.querySelector('video') as HTMLVideoElement
    fireEvent.loadedData(video)

    await waitFor(() => {
      expect(posterMocks.capture).toHaveBeenCalledTimes(1)
      expect(container.querySelector('[data-home-video-poster="true"]')).toBeTruthy()
    })
    expect(posterMocks.capture).toHaveBeenCalledWith('https://cdn.makaron.app/new-cover.mp4', video)
  })

  it('ignores an older poster capture that resolves after the video src changes', async () => {
    posterMocks.poster = null
    const oldCapture = deferred<string | null>()
    const newCapture = deferred<string | null>()
    posterMocks.capture
      .mockImplementationOnce(() => oldCapture.promise)
      .mockImplementationOnce(() => newCapture.promise)

    const view = render(
      <LazyVideo
        src="https://cdn.makaron.app/old-cover.mp4"
        style={{ position: 'absolute', inset: 0 }}
        eager
      />,
    )
    fireEvent.loadedData(view.container.querySelector('video') as HTMLVideoElement)

    view.rerender(
      <LazyVideo
        src="https://cdn.makaron.app/new-cover.mp4"
        style={{ position: 'absolute', inset: 0 }}
        eager
      />,
    )
    fireEvent.loadedData(view.container.querySelector('video') as HTMLVideoElement)
    expect(posterMocks.capture).toHaveBeenCalledTimes(2)

    await act(async () => newCapture.resolve('blob:new-poster'))
    expect(view.container.querySelector<HTMLImageElement>('[data-home-video-poster="true"]')?.src).toContain('blob:new-poster')

    await act(async () => oldCapture.resolve('blob:old-poster'))
    expect(view.container.querySelector<HTMLImageElement>('[data-home-video-poster="true"]')?.src).toContain('blob:new-poster')
  })

  it('keeps a stable fallback through detach, re-entry, and poster capture failure', async () => {
    posterMocks.poster = null
    const capture = deferred<string | null>()
    posterMocks.capture.mockImplementationOnce(() => capture.promise)
    const { container } = render(
      <LazyVideo
        src="https://cdn.makaron.app/failing-poster.mp4"
        style={{ position: 'absolute', inset: 0 }}
      />,
    )

    act(() => {
      MockIntersectionObserver.instances[0].trigger({ isIntersecting: true, intersectionRatio: 1 })
      MockIntersectionObserver.instances[1].trigger({ isIntersecting: true, intersectionRatio: 1 })
    })
    fireEvent.loadedData(container.querySelector('video') as HTMLVideoElement)

    act(() => {
      MockIntersectionObserver.instances[0].trigger({ isIntersecting: false, intersectionRatio: 0 })
      MockIntersectionObserver.instances[1].trigger({ isIntersecting: false, intersectionRatio: 0 })
    })
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('[data-home-video-fallback="true"]')).toBeTruthy()

    act(() => {
      MockIntersectionObserver.instances[0].trigger({ isIntersecting: true, intersectionRatio: 1 })
      MockIntersectionObserver.instances[1].trigger({ isIntersecting: true, intersectionRatio: 1 })
    })
    expect((container.querySelector('video') as HTMLVideoElement).style.opacity).toBe('0')
    expect(container.querySelector('[data-home-video-fallback="true"]')).toBeTruthy()

    await act(async () => capture.reject(new Error('tainted canvas')))
    expect(container.querySelector('[data-home-video-fallback="true"]')).toBeTruthy()
  })

  it('does not require CORS or poster capture for an arbitrary third-party video', () => {
    posterMocks.poster = null
    const { container } = render(
      <LazyVideo
        src="https://third-party.example/video.mp4"
        style={{ position: 'absolute', inset: 0 }}
        eager
      />,
    )

    const video = container.querySelector('video') as HTMLVideoElement
    expect(video.getAttribute('crossorigin')).toBeNull()
    fireEvent.loadedData(video)
    expect(video.style.opacity).toBe('1')
    expect(posterMocks.capture).not.toHaveBeenCalled()
  })

  it('shows a low-priority static fallback before a cold video has a poster', () => {
    posterMocks.poster = null
    const { container } = render(
      <LazyVideo
        src="https://cdn.makaron.app/cold-cover.mp4"
        fallbackSrc="https://cdn.makaron.app/cold-fallback.jpg"
        style={{ position: 'absolute', inset: 0 }}
      />,
    )

    const fallback = container.querySelector<HTMLImageElement>('[data-home-video-static-fallback="true"]')
    expect(fallback?.src).toContain('cold-fallback.jpg')
    expect(fallback?.loading).toBe('lazy')
    expect(fallback?.getAttribute('fetchpriority')).toBe('low')
    expect(container.querySelector('video')).toBeNull()
  })
})
