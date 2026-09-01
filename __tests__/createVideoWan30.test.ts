import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function taskCreated(id: string) {
  return new Response(JSON.stringify({
    task_info: {
      id,
      status: 'pending',
      created_at: '2026-08-31T00:00:00Z',
      updated_at: '2026-08-31T00:00:00Z',
    },
  }), { status: 200 })
}

describe('Wan 3.0 MuleRouter integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('MULEROUTER_API_KEY', 'test-mulerouter-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('registers Standard and Pro aliases, limits, resolutions, and provider routes', async () => {
    const {
      getVideoModelCapability,
      normalizeVideoModelId,
      resolveVideoProviderModel,
      validateVideoModelRequest,
    } = await import('@/lib/video-model-capabilities')

    expect(normalizeVideoModelId('wan3.0')).toBe('wan-3.0')
    expect(normalizeVideoModelId('berry-1.0-pro')).toBe('wan-3.0-pro')
    expect(getVideoModelCapability('wan-3.0')).toMatchObject({
      provider: 'mulerouter',
      minOutputDuration: 2,
      maxOutputDuration: 30,
      maxReferenceVideoDuration: 15,
      maxCombinedReferenceAndOutputDuration: 30,
      maxImageReferences: 10,
      maxVideoReferences: 5,
      maxAudioReferences: 5,
      defaultResolution: '1080p',
      supportedResolutions: ['480p', '720p', '1080p'],
    })
    expect(getVideoModelCapability('wan-3.0-pro')).toMatchObject({
      provider: 'mulerouter',
      defaultResolution: '1080p',
      supportedResolutions: ['1080p', '2k', '4k'],
    })
    expect(resolveVideoProviderModel({ model: 'wan-3.0' })).toBe('carrothub/w3.0-video')
    expect(resolveVideoProviderModel({ model: 'wan-3.0-pro' })).toBe('carrothub/berry-1.0-pro')
    expect(validateVideoModelRequest({ model: 'wan-3.0', outputDuration: 1 })).toContain('2 seconds or more')
    expect(validateVideoModelRequest({ model: 'wan-3.0-pro', resolution: '720p' })).toContain('does not support 720p')
    expect(validateVideoModelRequest({ model: 'wan-3.0-pro', operation: 'edit' })).toContain('does not expose typed video edit')
  })

  it('rejects Wan reference-plus-output requests before calling MuleRouter', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Thirty Second Continuation\nShot 1 (30s): Continue the reference performance.',
      images: [''],
      videoUrls: ['https://example.com/source.mp4'],
      referenceVideoDuration: 5.04,
      duration: 30,
      videoModel: 'wan-3.0',
      videoResolution: '1080p',
    })

    expect(result).toMatchObject({ success: false })
    expect(result.message).toContain('5.04s reference + 30s output = 35.04s')
    expect(result.message).toContain('duration=24')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits Standard native text-to-video with the official MuleRouter field names', async () => {
    let providerUrl = ''
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      providerUrl = String(url)
      providerBody = JSON.parse(String(init?.body || '{}'))
      return taskCreated('11111111-1111-4111-8111-111111111111')
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Quiet Orbit\nShot 1 (2s): A paper planet turns under soft studio light.',
      images: [],
      duration: 2,
      aspectRatio: '1:1',
      videoModel: 'wan-3.0',
      videoResolution: '480p',
      generateAudio: false,
    })

    expect(result).toMatchObject({
      success: true,
      taskId: 'mr-wan30-11111111-1111-4111-8111-111111111111',
      providerModel: 'carrothub/w3.0-video',
    })
    expect(providerUrl).toBe('https://api.mulerouter.ai/vendors/carrothub/v1/w3.0-video/generation')
    expect(providerBody).toMatchObject({
      prompt: expect.stringContaining('paper planet'),
      duration: 2,
      resolution: '480p',
      ratio: '1:1',
      audio: false,
      prompt_extend: true,
    })
    expect(providerBody).not.toHaveProperty('content_filter')
    expect(providerBody).not.toHaveProperty('model')
  })

  it('submits Pro 4K through berry-1.0-pro and preserves a distinct task prefix', async () => {
    let providerUrl = ''
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      providerUrl = String(url)
      providerBody = JSON.parse(String(init?.body || '{}'))
      return taskCreated('22222222-2222-4222-8222-222222222222')
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'Crystal City\nShot 1 (3s): A crystalline city glows at blue hour.',
      images: [],
      duration: 3,
      videoModel: 'wan-3.0-pro',
      videoResolution: '4k',
    })

    expect(result).toMatchObject({
      success: true,
      taskId: 'mr-wan30-pro-22222222-2222-4222-8222-222222222222',
      providerModel: 'carrothub/berry-1.0-pro',
    })
    expect(providerUrl).toBe('https://api.mulerouter.ai/vendors/carrothub/v1/berry-1.0-pro/generation')
    expect(providerBody).toMatchObject({ resolution: '4k', duration: 3 })
  })

  it('rejects an attempted provider-specific content-filter flag', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { createVideo } = await import('@/lib/skills/create-video')
    const result = await createVideo({
      script: 'No Hidden Toggle\nShot 1 (2s): A studio light turns on.',
      images: [],
      duration: 2,
      videoModel: 'wan-3.0-pro',
      contentFilter: false,
    })
    expect(result).toMatchObject({ success: false })
    expect(result.message).toContain('does not expose a content-filter switch through MuleRouter')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses reference mode for one image and mixed media on Standard and Pro', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') return new Response(new Uint8Array(), { status: 200 })
      bodies.push(JSON.parse(String(init.body || '{}')))
      return taskCreated(`33333333-3333-4333-8333-33333333333${bodies.length}`)
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const imageResult = await createVideo({
      script: 'Portrait Drift\nShot 1 (4s): <<<media_1>>> slowly comes alive.',
      images: ['https://example.com/portrait.jpg'],
      duration: 4,
      videoModel: 'wan-3.0',
    })
    expect(imageResult.success).toBe(true)
    expect(bodies[0]).toMatchObject({
      reference_images: ['https://example.com/portrait.jpg'],
      resolution: '1080p',
    })
    expect(bodies[0]).not.toHaveProperty('first_frame')
    expect(String(bodies[0].prompt)).toContain('Image 1 slowly comes alive')

    const mixedResult = await createVideo({
      script: 'Mixed Motion\nUse <<<media_1>>> as the subject, <<<media_2>>> for motion, and <<<audio_1>>> for pacing.',
      images: ['https://example.com/subject.jpg', ''],
      videoUrls: ['https://example.com/motion.mp4'],
      audioUrls: ['https://example.com/beat.mp3'],
      referenceVideoDuration: 5,
      duration: 6,
      videoModel: 'wan-3.0',
      videoResolution: '1080p',
    })
    expect(mixedResult.success).toBe(true)
    expect(bodies[1]).toMatchObject({
      reference_images: ['https://example.com/subject.jpg'],
      reference_videos: ['https://example.com/motion.mp4'],
      reference_audios: ['https://example.com/beat.mp3'],
      resolution: '1080p',
    })
    expect(String(bodies[1].prompt)).toContain('Image 1 as the subject')
    expect(String(bodies[1].prompt)).toContain('Video 1 for motion')
    expect(String(bodies[1].prompt)).toContain('Audio 1 for pacing')

    const proImageResult = await createVideo({
      script: 'Pro Portrait\nShot 1 (4s): <<<media_1>>> turns toward the light.',
      images: ['https://example.com/pro-portrait.jpg'],
      duration: 4,
      videoModel: 'wan-3.0-pro',
      videoResolution: '4k',
    })
    expect(proImageResult.success).toBe(true)
    expect(bodies[2]).toMatchObject({
      reference_images: ['https://example.com/pro-portrait.jpg'],
      resolution: '4k',
    })
    expect(bodies[2]).not.toHaveProperty('first_frame')
  })

  it('uses the existing post-selection harness when the timeline exceeds the model limit', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || '{}')))
      const suffix = String(bodies.length).padStart(12, '0')
      return taskCreated(`44444444-4444-4444-8444-${suffix}`)
    }))

    const { createVideo } = await import('@/lib/skills/create-video')
    const imageSlots = Array.from({ length: 11 }, () => '')
    imageSlots[3] = 'https://example.com/original-media-4.jpg'

    const imageOnly = await createVideo({
      script: 'Selected Still\nShot 1 (4s): Animate <<<media_4>>> only.',
      images: imageSlots,
      duration: 4,
      videoModel: 'wan-3.0',
    })
    expect(imageOnly.success).toBe(true)
    expect(bodies[0]).toMatchObject({
      reference_images: ['https://example.com/original-media-4.jpg'],
    })
    expect(bodies[0]).not.toHaveProperty('reference_videos')
  })

  it('polls Standard and Pro task ids against their matching endpoint', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(JSON.stringify({
        task_info: { id: 'x', status: 'completed', created_at: 'x', updated_at: 'x' },
        videos: ['https://cdn.example.com/result.mp4'],
      }), { status: 200 })
    }))
    const { getMuleRouterVideoTask } = await import('@/lib/mulerouter-video')
    await expect(getMuleRouterVideoTask('mr-wan30-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).resolves.toMatchObject({ status: 'completed' })
    await expect(getMuleRouterVideoTask('mr-wan30-pro-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).resolves.toMatchObject({ status: 'completed' })
    expect(urls[0]).toContain('/w3.0-video/generation/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(urls[1]).toContain('/berry-1.0-pro/generation/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })
})
