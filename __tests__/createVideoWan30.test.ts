import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Wan 3.0 video integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('registers aliases, limits, resolution pricing, and provider routes', async () => {
    const {
      estimateVideoCredits,
      getVideoModelCapability,
      normalizeVideoModelId,
      resolveVideoProviderModel,
      validateVideoModelRequest,
    } = await import('@/lib/video-model-capabilities')

    expect(normalizeVideoModelId('wan3.0')).toBe('wan-3.0')
    expect(getVideoModelCapability('wan-3.0')).toMatchObject({
      provider: 'wan',
      minOutputDuration: 2,
      maxOutputDuration: 30,
      maxImageReferences: 10,
      maxVideoReferences: 5,
      maxAudioReferences: 5,
      defaultResolution: '720p',
    })
    expect(resolveVideoProviderModel({ model: 'wan-3.0' })).toBe('wan3.0-text-to-video')
    expect(resolveVideoProviderModel({ model: 'wan-3.0', imageReferenceCount: 1 })).toBe('wan3.0-image-to-video')
    expect(resolveVideoProviderModel({ model: 'wan-3.0', imageReferenceCount: 2 })).toBe('wan3.0-reference-video')
    expect(estimateVideoCredits({ model: 'wan-3.0', durationSec: 2, resolution: '480p' })).toBe(15)
    expect(validateVideoModelRequest({ model: 'wan-3.0', outputDuration: 1 })).toContain('2 seconds or more')
    expect(validateVideoModelRequest({ model: 'wan-3.0', operation: 'edit' })).toContain('does not expose typed video edit')
  })

  it('routes native text-to-video without undocumented filter fields', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-wan30-text' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Quiet Orbit\nShot 1 (2s): A paper planet turns under soft studio light.\nStyle: tactile miniature cinema.',
      images: [],
      duration: 2,
      aspectRatio: '1:1',
      videoModel: 'wan-3.0',
      videoResolution: '480p',
      generateAudio: false,
    })

    expect(result).toMatchObject({ success: true, providerModel: 'wan3.0-text-to-video' })
    expect(providerBody).toMatchObject({
      model: 'wan3.0-text-to-video',
      duration: 2,
      quality: '480p',
      aspect_ratio: '1:1',
      generate_audio: false,
    })
    expect(providerBody).not.toHaveProperty('content_filter')
  })

  it('rejects an attempted Seedance content-filter flag instead of silently claiming support', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'No Hidden Toggle\nShot 1 (2s): A studio light turns on.',
      images: [],
      duration: 2,
      videoModel: 'wan-3.0',
      contentFilter: false,
    })

    expect(result).toMatchObject({ success: false })
    expect(result.message).toContain('does not expose a content-filter switch')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes one image to image-to-video and translates the marker', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-wan30-image' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Portrait Drift\nShot 1 (4s): <<<media_1>>> slowly comes alive as the camera pushes in.',
      images: ['https://example.com/portrait.jpg'],
      duration: 4,
      videoModel: 'wan-3.0',
    })

    expect(result).toMatchObject({ success: true, providerModel: 'wan3.0-image-to-video' })
    expect(providerBody).toMatchObject({
      model: 'wan3.0-image-to-video',
      image_urls: ['https://example.com/portrait.jpg'],
      duration: 4,
      quality: '720p',
    })
    expect(String(providerBody?.prompt)).toContain('Image 1 slowly comes alive')
  })

  it('maps mixed image, timeline-video, and audio references to Wan numbering', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return new Response(new Uint8Array(), { status: 200 })
      }
      providerBody = JSON.parse(String(init.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-wan30-reference' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Mixed Motion\nUse <<<media_1>>> as the subject, <<<media_2>>> for motion, and <<<audio_1>>> for pacing.',
      images: ['https://example.com/subject.jpg', ''],
      videoUrls: ['https://example.com/motion.mp4'],
      audioUrls: ['https://example.com/beat.mp3'],
      referenceVideoDuration: 5,
      duration: 6,
      videoModel: 'wan-3.0',
      videoResolution: '1080p',
    })

    expect(result).toMatchObject({ success: true, providerModel: 'wan3.0-reference-video' })
    expect(providerBody).toMatchObject({
      model: 'wan3.0-reference-video',
      image_urls: ['https://example.com/subject.jpg'],
      video_urls: ['https://example.com/motion.mp4'],
      audio_urls: ['https://example.com/beat.mp3'],
      quality: '1080p',
    })
    expect(String(providerBody?.prompt)).toContain('Image 1 as the subject')
    expect(String(providerBody?.prompt)).toContain('Video 1 for motion')
    expect(String(providerBody?.prompt)).toContain('Audio 1 for pacing')
  })
})
