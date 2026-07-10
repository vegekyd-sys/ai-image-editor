import { describe, expect, it, vi } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import { estimateVideoCredits, getDefaultVideoModelId, getVideoModelCapability, normalizeVideoModelId, normalizeVideoResolution, resolveAgentVideoSelection, resolveClosestSupportedAspectRatio, resolveVideoGenerationRoute, resolveVideoProviderAspectRatio, resolveVideoProviderModel } from '@/lib/video-model-capabilities'

describe('video model reference limits', () => {
  it('defaults video generation to SeeDance 2.0 Fast', () => {
    expect(getDefaultVideoModelId()).toBe('seedance-fast')
    expect(normalizeVideoModelId()).toBe('seedance-fast')
    expect(normalizeVideoModelId('seedance')).toBe('seedance')
    expect(normalizeVideoModelId('seedance-fast')).toBe('seedance-fast')
    expect(normalizeVideoModelId('seedance-2.0-mini')).toBe('seedance-mini')
    expect(normalizeVideoResolution('seedance-fast', 'auto')).toBe('720p')
  })

  it('routes Seedance Mini as its own Evolink provider model', () => {
    expect(normalizeVideoResolution('seedance-mini', 'auto')).toBe('480p')
    expect(resolveVideoGenerationRoute({ model: 'seedance-mini', resolution: 'auto' })).toMatchObject({
      model: 'seedance-mini',
      label: 'SeeDance 2.0 Mini',
      provider: 'seedance',
      providerModel: 'seedance-2.0-mini-reference-to-video',
      resolution: '480p',
    })
    expect(resolveVideoGenerationRoute({ model: 'seedance-mini', resolution: '720p' })).toMatchObject({
      providerModel: 'seedance-2.0-mini-reference-to-video',
      resolution: '720p',
    })
    expect(estimateVideoCredits({ model: 'seedance-mini', resolution: '480p', durationSec: 15, imageCount: 2 })).toBe(168)
    expect(estimateVideoCredits({ model: 'seedance-mini', resolution: '720p', durationSec: 15, imageCount: 2 })).toBe(360)
    expect(resolveVideoProviderModel({ model: 'seedance-fast', imageReferenceCount: 0 })).toBe('seedance-2.0-fast-text-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-mini', imageReferenceCount: 0 })).toBe('seedance-2.0-mini-text-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance', imageReferenceCount: 0 })).toBe('seedance-2.0-text-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-fast', imageReferenceCount: 1 })).toBe('seedance-2.0-fast-reference-to-video')
  })

  it('maps non-standard vertical reference videos to supported Seedance aspect ratios', () => {
    expect(resolveClosestSupportedAspectRatio('seedance-mini', 496, 864)).toBe('9:16')
    expect(resolveClosestSupportedAspectRatio('seedance-fast', 1920, 1080)).toBe('16:9')
  })

  it('fails fast before calling Kling with a reference video longer than 10s', async () => {
    const result = await createVideo({
      script: 'Cyberpunk restyle\n\nRestyle <<<media_1>>> with neon cyberpunk lighting.',
      images: [],
      videoUrls: ['https://example.com/long.mp4'],
      referenceVideoDuration: 38.8,
      duration: 10,
      videoModel: 'kling',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Kling reference video duration')
    expect(result.message).toContain('split')
    expect(result.message).toContain('FFmpeg')
  })

  it('allows Kling output duration up to 15s', async () => {
    const result = await createVideo({
      script: 'Cyberpunk restyle\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/short.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 720, height: 1280, fileSizeBytes: 1_000_000 }],
      duration: 15,
      videoModel: 'kling',
    })

    expect(result.success).toBe(false)
    expect(result.message).not.toContain('Kling duration must be 10 seconds or less')
    expect(result.message).toContain('KLING_ACCESS_KEY')
  })

  it('fails fast before calling SeeDance with reference videos below the frame-pixel minimum', async () => {
    const result = await createVideo({
      script: 'Tiny reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/tiny.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 320, height: 320, fileSizeBytes: 1_000_000 }],
      duration: 8,
      videoModel: 'seedance',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('SeeDance 2.0 reference video size')
    expect(result.message).toContain('320x320')
    expect(result.message).toContain('409,600-2,086,876')
    expect(result.message).toContain('resize/pad')
  })

  it('allows valid SeeDance reference video dimensions before provider submission', async () => {
    const result = await createVideo({
      script: 'Valid reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/valid.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 720, height: 1280, fileSizeBytes: 1_000_000 }],
      duration: 8,
      videoModel: 'seedance',
    })

    expect(result.success).toBe(false)
    expect(result.message).not.toContain('reference video size')
    expect(result.message).toContain('EVOLINK_API_KEY')
  })

  it('requires audio refs to be explicitly referenced in the story prompt', async () => {
    const missing = await createVideo({
      script: 'Beat synced mascot\n\nAnimate <<<media_1>>> to the uploaded music.',
      images: ['https://example.com/image.jpg'],
      audioUrls: ['https://example.com/beat.mp3'],
      duration: 15,
      videoModel: 'seedance-mini',
    })

    expect(missing.success).toBe(false)
    expect(missing.message).toContain('Reference audio was passed but not referenced in story_prompt')
    expect(missing.message).toContain('<<<audio_1>>>')

    const referenced = await createVideo({
      script: 'Beat synced mascot\n\nUse <<<audio_1>>> as the soundtrack and rhythm reference. Animate <<<media_1>>> on the beat.',
      images: ['https://example.com/image.jpg'],
      audioUrls: ['https://example.com/beat.mp3'],
      duration: 15,
      videoModel: 'seedance-mini',
    })

    expect(referenced.success).toBe(false)
    expect(referenced.message).not.toContain('Reference audio was passed')
    expect(referenced.message).toContain('EVOLINK_API_KEY')
  })

  it('keeps Seedance Mini video references on Mini guardrails', async () => {
    const tiny = await createVideo({
      script: 'Mini tiny reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/tiny.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 320, height: 320, fileSizeBytes: 1_000_000 }],
      duration: 8,
      videoModel: 'seedance-mini',
    })

    expect(tiny.success).toBe(false)
    expect(tiny.message).toContain('SeeDance 2.0 Mini reference video size')
    expect(tiny.message).toContain('409,600-2,086,876')

    const valid = await createVideo({
      script: 'Mini valid reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/valid.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 720, height: 1280, fileSizeBytes: 1_000_000 }],
      duration: 8,
      videoModel: 'seedance-mini',
    })

    expect(valid.success).toBe(false)
    expect(valid.message).not.toContain('reference video size')
    expect(valid.message).toContain('EVOLINK_API_KEY')
  })

  it('submits single-image Seedance Fast through the reference-to-video provider model', async () => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.model).toBe('seedance-2.0-fast-reference-to-video')
      expect(body.image_urls).toEqual(['https://example.com/image.jpg'])
      return new Response(JSON.stringify({ id: 'task-test-seedance-reference' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const { createVideo: createVideoFresh } = await import('@/lib/skills/create-video')
      const result = await createVideoFresh({
        script: 'Single image reference\n\nAnimate <<<media_1>>> with a gentle camera push.',
        images: ['https://example.com/image.jpg'],
        duration: 5,
        videoModel: 'seedance-fast',
        videoResolution: '480p',
      })

      expect(result.success).toBe(true)
      expect(result.providerModel).toBe('seedance-2.0-fast-reference-to-video')
      expect(result.taskId).toBe('task-test-seedance-reference')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('submits zero-media Seedance Fast through the native text-to-video provider model', async () => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.model).toBe('seedance-2.0-fast-text-to-video')
      expect(body).not.toHaveProperty('image_urls')
      expect(body).not.toHaveProperty('video_urls')
      return new Response(JSON.stringify({ id: 'task-test-seedance-text' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const { createVideo: createVideoFresh } = await import('@/lib/skills/create-video')
      const result = await createVideoFresh({
        script: 'Neon city awakening\n\nA cinematic neon city wakes at dawn with slow aerial camera movement.',
        images: [],
        duration: 5,
        videoModel: 'seedance-fast',
        videoResolution: '720p',
      })

      expect(result.success).toBe(true)
      expect(result.providerModel).toBe('seedance-2.0-fast-text-to-video')
      expect(result.taskId).toBe('task-test-seedance-text')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('still rejects zero-media generation for providers without text-to-video support', async () => {
    const result = await createVideo({
      script: 'Neon city awakening\n\nA cinematic neon city wakes at dawn.',
      images: [],
      duration: 5,
      videoModel: 'grok',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('requires an image or video reference')
  })

  it('does not invent a Kling reference-video lower resolution limit', async () => {
    const result = await createVideo({
      script: 'Tiny Kling reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/tiny.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 320, height: 320, fileSizeBytes: 1_000_000 }],
      duration: 8,
      videoModel: 'kling',
    })

    expect(result.success).toBe(false)
    expect(result.message).not.toContain('reference video size')
    expect(result.message).toContain('KLING_ACCESS_KEY')
  })

  it('rejects Kling reference videos above the documented 2K limit', async () => {
    const result = await createVideo({
      script: 'Large Kling reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/large.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 2560, height: 1440, fileSizeBytes: 1_000_000 }],
      duration: 8,
      videoModel: 'kling',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Kling reference video size')
    expect(result.message).toContain('outside provider limits')
    expect(result.message).toContain('<=200MB, resolution <=2K')
  })

  it('allows SeeDance reference durations up to the 15s range before provider submission', async () => {
    const result = await createVideo({
      script: 'Cyberpunk restyle\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/too-long-for-seedance.mp4'],
      referenceVideoDuration: 16,
      duration: 15,
      videoModel: 'seedance',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('reference video duration')
    expect(result.message).toContain('15.5')
  })

  it('does not silently treat unknown future models as Kling', async () => {
    const capability = getVideoModelCapability('future-video-model')
    expect(capability.id).toBe('future-video-model')
    expect(capability.maxReferenceVideoDuration).toBeGreaterThan(0)

    const result = await createVideo({
      script: 'Future model test\n\nAnimate <<<media_1>>>.',
      images: ['https://example.com/image.jpg'],
      duration: 5,
      videoModel: 'future-video-model',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('No video provider adapter')
    expect(result.message).toContain('future-video-model')
  })

  it('estimates Grok credits without floating-point overcharging', () => {
    expect(normalizeVideoResolution('grok', 'auto')).toBe('480p')
    expect(estimateVideoCredits({ model: 'grok', durationSec: 1, imageCount: 1 })).toBe(18)
    expect(estimateVideoCredits({ model: 'grok', durationSec: 4, imageCount: 1 })).toBe(66)
    expect(estimateVideoCredits({ model: 'grok', resolution: '480p', durationSec: 1, imageCount: 1 })).toBe(18)
    expect(estimateVideoCredits({ model: 'grok', resolution: '720p', durationSec: 1, imageCount: 1 })).toBe(30)
  })

  it('models Gemini Omni as a fast 720p image and video edit provider', () => {
    expect(normalizeVideoResolution('google-omni', 'auto')).toBe('720p')
    expect(resolveVideoGenerationRoute({ model: 'google-omni', resolution: 'auto' })).toMatchObject({
      model: 'google-omni',
      resolution: '720p',
      provider: 'google-omni',
      providerModel: 'gemini-omni-flash-preview',
    })
    expect(getVideoModelCapability('google-omni')).toMatchObject({
      minOutputDuration: 3,
      maxOutputDuration: 10,
      supportsVideoReference: true,
      supportsBaseVideoEdit: true,
      maxReferenceVideoDuration: 10.5,
      maxImageReferences: 6,
    })
    expect(estimateVideoCredits({ model: 'google-omni', durationSec: 5, imageCount: 1 })).toBe(100)
  })

  it('fails fast before calling Google Omni with more than six image references', async () => {
    const result = await createVideo({
      script: 'Omni too many images\n\nAnimate <<<media_1>>>, <<<media_2>>>, <<<media_3>>>, <<<media_4>>>, <<<media_5>>>, <<<media_6>>>, and <<<media_7>>> together.',
      images: [
        'https://example.com/one.jpg',
        'https://example.com/two.jpg',
        'https://example.com/three.jpg',
        'https://example.com/four.jpg',
        'https://example.com/five.jpg',
        'https://example.com/six.jpg',
        'https://example.com/seven.jpg',
      ],
      duration: 5,
      videoModel: 'google-omni',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Gemini Omni Flash supports at most 6 reference images per request')
  })

  it('locks explicit app video model and resolution over agent tool guesses', () => {
    const selection = resolveAgentVideoSelection({
      appModel: 'seedance',
      appResolution: '1080p',
      toolModel: 'kling',
      toolResolution: '4k',
    })

    expect(selection).toEqual({ model: 'seedance', resolution: '1080p', locked: true })
    expect(resolveVideoGenerationRoute({ model: selection.model, resolution: selection.resolution })).toMatchObject({
      model: 'seedance',
      resolution: '1080p',
      provider: 'seedance',
    })
  })

  it('allows tool routing only when the app video selector is still on default auto', () => {
    expect(resolveAgentVideoSelection({
      appModel: 'seedance-fast',
      appResolution: 'auto',
      appAuto: true,
      toolModel: 'grok',
      toolResolution: '480p',
    })).toEqual({ model: 'grok', resolution: '480p', locked: false })

    expect(resolveAgentVideoSelection({
      appModel: 'seedance-fast',
      appResolution: '720p',
      appAuto: false,
      toolModel: 'grok',
      toolResolution: '480p',
    })).toEqual({ model: 'seedance-fast', resolution: '720p', locked: true })
  })

  it('distinguishes video auto from explicit default SeedDance Fast 720p', () => {
    expect(resolveAgentVideoSelection({
      appModel: 'seedance-fast',
      appResolution: 'auto',
      appAuto: true,
      toolModel: 'kling',
      toolResolution: '4k',
    })).toEqual({ model: 'kling', resolution: '4k', locked: false })

    expect(resolveAgentVideoSelection({
      appModel: 'seedance-fast',
      appResolution: '720p',
      appAuto: false,
      toolModel: 'kling',
      toolResolution: '4k',
    })).toEqual({ model: 'seedance-fast', resolution: '720p', locked: true })
  })

  it('routes provider-specific video aspect ratio defaults', () => {
    expect(resolveVideoProviderAspectRatio('seedance', 'auto')).toBe('adaptive')
    expect(resolveVideoProviderAspectRatio('seedance', '21:9')).toBe('21:9')
    expect(resolveVideoProviderAspectRatio('grok', 'auto')).toBeUndefined()
    expect(resolveVideoProviderAspectRatio('grok', '3:2')).toBeUndefined()
    expect(resolveVideoProviderAspectRatio('kling', 'auto')).toBeUndefined()
    expect(resolveVideoProviderAspectRatio('google-omni', '9:16')).toBe('9:16')
    expect(resolveVideoProviderAspectRatio('google-omni', '1:1')).toBe('1:1')
  })

  it('validates model-specific video aspect ratios before provider submission', async () => {
    const unsupported = await createVideo({
      script: 'Wide Grok\n\nAnimate <<<media_1>>>.',
      images: ['https://example.com/image.jpg'],
      duration: 4,
      videoModel: 'grok',
      aspectRatio: '21:9',
    })
    expect(unsupported.success).toBe(false)
    expect(unsupported.message).toContain('Grok Video 1.5 does not support 21:9')

    const supported = await createVideo({
      script: 'Wide Seedance\n\nAnimate <<<media_1>>>.',
      images: ['https://example.com/image.jpg'],
      duration: 4,
      videoModel: 'seedance',
      aspectRatio: '21:9',
    })
    expect(supported.success).toBe(false)
    expect(supported.message).not.toContain('does not support 21:9')
    expect(supported.message).toContain('EVOLINK_API_KEY')
  })
})
