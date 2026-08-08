import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('createVideo Seedance 2.5 integration', () => {
  let image: Buffer

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const sharp = (await import('sharp')).default
    image = await sharp({
      create: { width: 1280, height: 720, channels: 4, background: '#ff00ff' },
    }).png().toBuffer()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('maps mixed timeline media and audio markers to the Seedance 2.5 reference contract', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return new Response(Uint8Array.from(image), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(image.length) },
        })
      }
      providerBody = JSON.parse(String(init.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-seedance25-reference' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Use <<<media_1>>> as mascot, <<<media_2>>> for camera rhythm, <<<media_3>>> as the editor UI, and <<<audio_1>>> for pacing.',
      images: ['https://example.com/mascot.png', '', 'https://example.com/editor.png'],
      videoUrls: ['https://example.com/motion.mp4'],
      audioUrls: ['https://example.com/music.mp3'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 1280, height: 720, fileSizeBytes: 1_000_000 }],
      duration: 30,
      videoModel: 'seedance-2.5',
      videoResolution: '720p',
    })

    expect(result).toMatchObject({
      success: true,
      providerModel: 'seedance-2.5-reference-to-video',
    })
    expect(providerBody).toMatchObject({
      model: 'seedance-2.5-reference-to-video',
      image_urls: ['https://example.com/mascot.png', 'https://example.com/editor.png'],
      video_urls: ['https://example.com/motion.mp4'],
      audio_urls: ['https://example.com/music.mp3'],
      duration: 30,
      quality: '720p',
    })
    expect(String(providerBody?.prompt)).toContain('@image1 as mascot')
    expect(String(providerBody?.prompt)).toContain('@video1 for camera rhythm')
    expect(String(providerBody?.prompt)).toContain('@image2 as the editor UI')
    expect(String(providerBody?.prompt)).toContain('@audio1 for pacing')
  })

  it('ignores failed timeline placeholders for a native text-to-video retry', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-seedance25-mature-retry' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Boudoir Editorial\nShot 1 (4s): Tasteful fashion film.\nStyle: Premium editorial lighting.',
      images: ['/video-placeholder.png'],
      duration: 4,
      aspectRatio: '16:9',
      videoModel: 'seedance-2.5',
      videoResolution: '480p',
      contentFilter: false,
    })

    expect(result).toMatchObject({
      success: true,
      providerModel: 'seedance-2.5-text-to-video',
    })
    expect(providerBody).toMatchObject({
      model: 'seedance-2.5-text-to-video',
      content_filter: false,
      quality: '480p',
      duration: 4,
    })
    expect(providerBody).not.toHaveProperty('image_urls')
  })

  it('uses the dedicated typed video-edit route with locked provider parameters', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-seedance25-edit' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Remove the cursor and preserve the page motion.',
      images: [],
      videoUrl: 'https://example.com/source.mp4',
      videoReferType: 'base',
      videoOperation: 'edit',
      referenceVideoDuration: 10,
      referenceVideoMetas: [{ width: 1280, height: 720, fileSizeBytes: 1_000_000 }],
      duration: 10,
      aspectRatio: '16:9',
      videoModel: 'seedance-2.5',
    })

    expect(result).toMatchObject({ success: true, providerModel: 'seedance-2.5-video-edit' })
    expect(providerBody).toMatchObject({
      model: 'seedance-2.5-video-edit',
      duration: -1,
      aspect_ratio: 'adaptive',
      video_urls: ['https://example.com/source.mp4'],
    })
    expect(String(providerBody?.prompt)).toBe('Edit @video1: Remove the cursor and preserve the page motion.')
  })

  it('uses the dedicated typed video-extend route and direction', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ id: 'task-unified-seedance25-extend' }), { status: 200 })
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Reveal the full Makaron wordmark.',
      images: [],
      videoUrl: 'https://example.com/source.mp4',
      videoReferType: 'base',
      videoOperation: 'extend',
      videoExtendDirection: 'backward',
      referenceVideoDuration: 10,
      referenceVideoMetas: [{ width: 1280, height: 720, fileSizeBytes: 1_000_000 }],
      duration: 12,
      videoModel: 'seedance-2.5',
    })

    expect(result).toMatchObject({ success: true, providerModel: 'seedance-2.5-video-extend' })
    expect(providerBody).toMatchObject({
      model: 'seedance-2.5-video-extend',
      duration: 12,
      aspect_ratio: 'adaptive',
    })
    expect(String(providerBody?.prompt)).toBe('Extend @video1 backward: Reveal the full Makaron wordmark.')
  })
})
