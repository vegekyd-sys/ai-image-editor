import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Evolink Seedance 2.5 payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('submits a 30-second text-to-video task with native audio', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body).toMatchObject({
        model: 'seedance-2.5-text-to-video',
        duration: 30,
        quality: '720p',
        aspect_ratio: '16:9',
        generate_audio: true,
        content_filter: true,
        output_format: 'mp4',
      })
      expect(body).not.toHaveProperty('image_urls')
      return new Response(JSON.stringify({ id: 'task-unified-seedance25-text' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createEvolinkTask } = await import('@/lib/evolink')
    await expect(createEvolinkTask({
      prompt: 'A cinematic Makaron product film',
      images: [],
      duration: 30,
      quality: '720p',
      aspectRatio: '16:9',
      model: 'seedance-2.5-text-to-video',
    })).resolves.toBe('task-unified-seedance25-text')
  })

  it('submits reference, edit, and extend modes with their documented contracts', async () => {
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const bodies: Record<string, unknown>[] = []
    const sharp = (await import('sharp')).default
    const image = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#ff00ff' },
    }).png().toBuffer()
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return new Response(Uint8Array.from(image), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(image.length) },
        })
      }
      bodies.push(JSON.parse(String(init?.body || '{}')))
      return new Response(JSON.stringify({ id: `task-${bodies.length}` }), { status: 200 })
    }))

    const { createEvolinkTask } = await import('@/lib/evolink')
    await createEvolinkTask({
      prompt: 'Use @image1 for the mascot, @video1 for camera rhythm, and @audio1 for pacing.',
      images: ['https://example.com/mascot.png'],
      videoUrls: ['https://example.com/motion.mp4'],
      audioUrls: ['https://example.com/music.mp3'],
      duration: 30,
      quality: '480p',
      model: 'seedance-2.5-reference-to-video',
    })
    await createEvolinkTask({
      prompt: 'Edit @video1: replace the background with @image1.',
      images: ['https://example.com/background.png'],
      videoUrls: ['https://example.com/source.mp4'],
      duration: -1,
      aspectRatio: 'adaptive',
      model: 'seedance-2.5-video-edit',
    })
    await createEvolinkTask({
      prompt: 'Extend @video1 forward into the final logo reveal.',
      images: [],
      videoUrls: ['https://example.com/source.mp4'],
      duration: 12,
      aspectRatio: 'adaptive',
      model: 'seedance-2.5-video-extend',
    })

    expect(bodies[0]).toMatchObject({
      model: 'seedance-2.5-reference-to-video',
      image_urls: ['https://example.com/mascot.png'],
      video_urls: ['https://example.com/motion.mp4'],
      audio_urls: ['https://example.com/music.mp3'],
      duration: 30,
    })
    expect(bodies[1]).toMatchObject({
      model: 'seedance-2.5-video-edit',
      duration: -1,
      aspect_ratio: 'adaptive',
    })
    expect(bodies[2]).toMatchObject({
      model: 'seedance-2.5-video-extend',
      duration: 12,
      aspect_ratio: 'adaptive',
    })
  })
})
