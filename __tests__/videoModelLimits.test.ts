import { describe, expect, it, vi } from 'vitest'
import { createVideo, prepareSeedance20References } from '@/lib/skills/create-video'
import { DEFAULT_VIDEO_REPLICATION_MODEL_ID, estimateVideoCredits, estimateVideoProviderCostUsd, getDefaultVideoModelId, getRequiredVideoCredits, getVideoModelCapability, listVideoModelCapabilities, normalizeVideoModelId, normalizeVideoResolution, resolveAgentVideoSelection, resolveClosestSupportedAspectRatio, resolvePersistedVideoDuration, resolveVideoGenerationRoute, resolveVideoImageWorkflow, resolveVideoOutputDuration, resolveVideoProviderAspectRatio, resolveVideoProviderModel, resolveVideoReplicationModelId, supportsNativeTextToVideo, validateVideoImageWorkflowRequest, validateVideoModelRequest, validateVideoResolutionRequest } from '@/lib/video-model-capabilities'

describe('video model reference limits', () => {
  it('maps mixed timeline image/video indices to Seedance 2.0 provider markers', () => {
    const prepared = prepareSeedance20References({
      prompt: 'Use <<<media_4>>> for motion, replace actors with <<<media_5>>> and <<<media_6>>>, background <<<media_7>>>.',
      images: [
        'https://example.com/original-a.webp',
        'https://example.com/original-b.webp',
        'https://example.com/original-bg.webp',
        '',
        'https://example.com/prepared-a.png',
        'https://example.com/prepared-b.png',
        'https://example.com/prepared-bg.png',
      ],
      videoUrls: ['https://example.com/source.mp4'],
    })

    expect(prepared.images).toEqual([
      'https://example.com/prepared-a.png',
      'https://example.com/prepared-b.png',
      'https://example.com/prepared-bg.png',
    ])
    expect(prepared.prompt).toContain('@video1 for motion')
    expect(prepared.prompt).toContain('@image1 and @image2')
    expect(prepared.prompt).toContain('background @image3')
    expect(prepared.prompt).not.toContain('<<<media_')
  })

  it('defaults every image-capable provider to reference-to-video', () => {
    const imageCapableModels = listVideoModelCapabilities()
      .filter(capability => capability.maxImageReferences !== 0)

    expect(imageCapableModels.length).toBeGreaterThan(0)
    for (const capability of imageCapableModels) {
      expect(capability.defaultImageWorkflow, capability.id).toBe('reference-to-video')
      expect(resolveVideoImageWorkflow({
        model: capability.id,
        imageReferenceCount: 1,
      }), capability.id).toBe('reference-to-video')
    }
  })

  it('keeps unknown future providers on reference-to-video and rejects implicit first-frame mode', () => {
    expect(resolveVideoImageWorkflow({
      model: 'future-video-provider',
      imageReferenceCount: 1,
    })).toBe('reference-to-video')
    expect(resolveVideoImageWorkflow({
      model: 'future-video-provider',
      imageReferenceCount: 7,
    })).toBe('reference-to-video')
    expect(validateVideoImageWorkflowRequest({
      model: 'future-video-provider',
      imageReferenceCount: 1,
      requestedWorkflow: 'image-to-video',
    })).toContain('does not expose an explicit image-to-video/first-frame workflow')
  })

  it('fails closed in create_video when a caller requests undeclared first-frame mode', async () => {
    const result = await createVideo({
      script: 'Shot 1 (5s): <<<media_1>>> walks through a sunlit room.',
      images: ['https://example.com/subject.jpg'],
      duration: 5,
      videoModel: 'wan-3.0',
      imageWorkflow: 'image-to-video',
    })

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('does not expose an explicit image-to-video/first-frame workflow'),
    })
  })

  it('rejects image references for models that explicitly declare no image workflow', () => {
    expect(validateVideoImageWorkflowRequest({
      model: 'sync-lipsync-v3',
      imageReferenceCount: 1,
    })).toBe('Sync Lipsync v3 does not support image references.')
  })

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
    expect(resolveVideoProviderModel({ model: 'seedance-mini', imageReferenceCount: 1 })).toBe('seedance-2.0-mini-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance', imageReferenceCount: 1 })).toBe('seedance-2.0-reference-to-video')
  })

  it('registers MiniMax H3 with public 768p and 2K production routes', () => {
    expect(normalizeVideoModelId('minimax')).toBe('minimax-h3')
    expect(normalizeVideoModelId('MiniMax-H3')).toBe('minimax-h3')
    expect(normalizeVideoResolution('minimax-h3', 'auto')).toBe('768p')
    expect(resolveVideoGenerationRoute({ model: 'minimax-h3', resolution: '768p' })).toMatchObject({
      model: 'minimax-h3',
      label: 'MiniMax H3',
      provider: 'minimax',
      providerModel: 'MiniMax-H3',
      resolution: '768p',
    })
    expect(getVideoModelCapability('minimax-h3')).toMatchObject({
      supportedResolutions: ['768p', '2k'],
      defaultResolution: '768p',
    })
    expect(estimateVideoProviderCostUsd({ model: 'minimax-h3', resolution: '768p', durationSec: 4 })).toBeCloseTo(0.28)
    expect(estimateVideoProviderCostUsd({ model: 'minimax-h3', resolution: '2k', durationSec: 4 })).toBeCloseTo(0.448)
    expect(estimateVideoCredits({ model: 'minimax-h3', resolution: '768p', durationSec: 4 })).toBe(56)
    expect(estimateVideoCredits({ model: 'minimax-h3', resolution: '2k', durationSec: 4 })).toBe(90)
    expect(estimateVideoCredits({
      model: 'minimax-h3',
      resolution: '768p',
      durationSec: 4,
      referenceVideoDurationSec: 4,
    })).toBe(112)
    expect(estimateVideoCredits({ model: 'minimax-h3', resolution: '768p', durationSec: 15 })).toBe(210)
    expect(estimateVideoCredits({ model: 'minimax-h3', resolution: '2k', durationSec: 15 })).toBe(336)
    expect(estimateVideoCredits({ model: 'minimax-h3', resolution: '2k', durationSec: 15, imageCount: 5 })).toBe(336)
    expect(estimateVideoCredits({ model: 'minimax-h3', resolution: '2k', durationSec: 15, imageCount: 6 })).toBe(342)
    expect(estimateVideoCredits({
      model: 'minimax-h3',
      resolution: '2k',
      durationSec: 15,
      imageCount: 5,
      referenceVideoDurationSec: 15,
    })).toBe(672)
  })

  it('accepts MiniMax H3 768p without a server-side preview gate', () => {
    expect(validateVideoResolutionRequest({ model: 'minimax-h3', resolution: '768p' })).toBeNull()
  })

  it('models Seedance 2.5 as an explicit 30-second Evolink route', () => {
    expect(normalizeVideoModelId('seedance-2.5')).toBe('seedance-2.5')
    expect(normalizeVideoModelId('seedance25')).toBe('seedance-2.5')
    expect(normalizeVideoResolution('seedance-2.5', 'auto')).toBe('720p')
    expect(resolveVideoGenerationRoute({ model: 'seedance-2.5', resolution: '480p' })).toMatchObject({
      model: 'seedance-2.5',
      label: 'Seedance 2.5',
      provider: 'seedance',
      providerModel: 'seedance-2.5-reference-to-video',
      resolution: '480p',
    })
    expect(getVideoModelCapability('seedance-2.5')).toMatchObject({
      minOutputDuration: 4,
      maxOutputDuration: 30,
      maxReferenceVideoDuration: 30,
      referenceVideoDurationTolerance: 0.5,
      maxImageReferences: 30,
      maxVideoReferences: 10,
      maxAudioReferences: 10,
      maxTotalReferences: 50,
      supportsVideoReference: true,
      supportsBaseVideoEdit: true,
      supportsVideoExtend: true,
      supportedResolutions: ['480p', '720p'],
    })
  })

  it('registers Sync Lipsync v3 as exact one-video plus one-audio processing', () => {
    expect(normalizeVideoModelId('lipsync')).toBe('sync-lipsync-v3')
    expect(resolveVideoGenerationRoute({ model: 'sync-lipsync-v3', resolution: 'auto' })).toMatchObject({
      model: 'sync-lipsync-v3',
      provider: 'fal-sync',
      providerModel: 'fal-ai/sync-lipsync/v3',
      resolution: '1080p',
    })
    expect(getVideoModelCapability('sync-lipsync-v3')).toMatchObject({
      minOutputDuration: 2,
      maxOutputDuration: 60,
      maxReferenceVideoDuration: 60,
      maxImageReferences: 0,
      maxVideoReferences: 1,
      maxAudioReferences: 1,
      supportsVideoReference: true,
      supportsBaseVideoEdit: true,
    })
    expect(estimateVideoProviderCostUsd({ model: 'sync-lipsync-v3', durationSec: 12 })).toBeCloseTo(1.6)
    expect(estimateVideoCredits({ model: 'sync-lipsync-v3', durationSec: 12 })).toBe(320)
    expect(resolveVideoProviderAspectRatio('sync-lipsync-v3', '9:16')).toBeUndefined()
  })

  it('rejects an incomplete Sync Lipsync request before provider submission', async () => {
    const result = await createVideo({
      script: 'Translated mouth alignment',
      images: [],
      videoUrls: ['https://example.com/source.mp4'],
      referenceVideoMetas: [{ width: 1080, height: 1920, fileSizeBytes: 1_000_000 }],
      duration: 12,
      videoModel: 'sync-lipsync-v3',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('exactly one source video')
    expect(result.message).toContain('exactly one reference audio')
  })

  it('accepts normal tail-frame metadata on a 30 second Seedance 2.5 edit', () => {
    const editRequest = {
      model: 'seedance-2.5',
      operation: 'edit' as const,
      outputDuration: -1,
      hasVideoReference: true,
      videoReferenceCount: 1,
    }

    expect(validateVideoModelRequest({ ...editRequest, referenceVideoDuration: 30.08 })).toBeNull()
    expect(validateVideoModelRequest({ ...editRequest, referenceVideoDuration: 30.5 })).toBeNull()
    expect(validateVideoModelRequest({ ...editRequest, referenceVideoDuration: 30.51 })).toContain('30 seconds or less')
  })

  it('adds the provider 10% surcharge only when Seedance 2.5 Mature Mode is selected', () => {
    const standardCost = estimateVideoCredits({
      model: 'seedance-2.5',
      resolution: '480p',
      durationSec: 4,
      contentFilter: true,
    })
    const defaultCost = estimateVideoCredits({
      model: 'seedance-2.5',
      resolution: '480p',
      durationSec: 4,
    })
    const matureCost = estimateVideoCredits({
      model: 'seedance-2.5',
      resolution: '480p',
      durationSec: 4,
      contentFilter: false,
    })

    expect(defaultCost).toBe(standardCost)
    expect(matureCost).toBe(Math.ceil(standardCost! * 1.1 - 1e-9))
    expect(estimateVideoCredits({
      model: 'seedance-fast',
      resolution: '480p',
      durationSec: 4,
      contentFilter: false,
    })).toBe(estimateVideoCredits({
      model: 'seedance-fast',
      resolution: '480p',
      durationSec: 4,
    }))
  })

  it('selects the right Seedance 2.5 provider mode from typed operation and references', () => {
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 0 })).toBe('seedance-2.5-text-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 1 })).toBe('seedance-2.5-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 2 })).toBe('seedance-2.5-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 1, aspectRatio: '9:16' })).toBe('seedance-2.5-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 2, aspectRatio: '16:9' })).toBe('seedance-2.5-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 3 })).toBe('seedance-2.5-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', imageReferenceCount: 1, hasVideoReference: true })).toBe('seedance-2.5-reference-to-video')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', hasVideoReference: true, operation: 'edit' })).toBe('seedance-2.5-video-edit')
    expect(resolveVideoProviderModel({ model: 'seedance-2.5', hasVideoReference: true, operation: 'extend' })).toBe('seedance-2.5-video-extend')
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
    const sharp = (await import('sharp')).default
    const validImage = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#ff00ff' },
    }).png().toBuffer()
    const validImageBody = new Uint8Array(validImage.length)
    validImageBody.set(validImage)
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return new Response(validImageBody, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(validImage.length) },
        })
      }
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
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('rejects a tiny Seedance image before provider submission and marks it non-retryable', async () => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const sharp = (await import('sharp')).default
    const tinyImage = await sharp({
      create: { width: 91, height: 91, channels: 4, background: '#ffffff' },
    }).png().toBuffer()
    const tinyImageBody = new Uint8Array(tinyImage.length)
    tinyImageBody.set(tinyImage)
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).not.toBe('POST')
      return new Response(tinyImageBody, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(tinyImage.length) },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const { createVideo: createVideoFresh } = await import('@/lib/skills/create-video')
      const result = await createVideoFresh({
        script: 'Tiny mascot\n\nAnimate <<<media_1>>> waving to camera.',
        images: ['https://example.com/tiny.png'],
        duration: 5,
        videoModel: 'seedance-fast',
        videoResolution: '480p',
      })

      expect(result).toMatchObject({
        success: false,
        retryable: false,
        repairable: true,
        terminal: false,
        errorCode: 'seedance_reference_image_too_small',
        errorReason: 'too_small',
      })
      expect(result.message).toContain('91x91px')
      expect(result.errorDetails).toMatchObject({
        imageIndex: 1,
        actual: { width: 91, height: 91 },
        limits: { minSide: 300, maxSide: 6000 },
      })
      expect(result.userMessage?.zh).toContain('参考图过小')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('distinguishes oversized Seedance images from undersized images', async () => {
    vi.resetModules()
    vi.stubEnv('EVOLINK_API_KEY', 'test-evolink-key')
    const sharp = (await import('sharp')).default
    const oversizedImage = await sharp({
      create: { width: 6001, height: 600, channels: 3, background: '#ffffff' },
    }).jpeg().toBuffer()
    const oversizedImageBody = new Uint8Array(oversizedImage.length)
    oversizedImageBody.set(oversizedImage)
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).not.toBe('POST')
      return new Response(oversizedImageBody, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(oversizedImage.length) },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const { createVideo: createVideoFresh } = await import('@/lib/skills/create-video')
      const result = await createVideoFresh({
        script: 'Oversized reference\n\nAnimate <<<media_1>>>.',
        images: ['https://example.com/oversized.jpg'],
        duration: 5,
        videoModel: 'seedance-fast',
      })

      expect(result).toMatchObject({
        success: false,
        retryable: false,
        repairable: true,
        terminal: false,
        errorCode: 'seedance_reference_image_too_large',
        errorReason: 'too_large',
        errorDetails: {
          imageIndex: 1,
          actual: { width: 6001, height: 600 },
        },
      })
      expect(result.userMessage?.zh).toContain('参考图过大')
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

  it('recognizes Grok 1.5 native text-to-video without requiring source media', () => {
    expect(supportsNativeTextToVideo('grok')).toBe(true)
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
    expect(estimateVideoCredits({ model: 'grok', resolution: '1080p', durationSec: 1 })).toBe(50)
    expect(estimateVideoCredits({
      model: 'grok',
      operation: 'edit',
      durationSec: 5,
      referenceVideoDurationSec: 5,
    })).toBe(80)
    expect(estimateVideoCredits({
      model: 'grok',
      operation: 'extend',
      durationSec: 6,
      referenceVideoDurationSec: 5,
    })).toBe(94)
  })

  it('models the current split Grok generation/edit/extend contract', () => {
    expect(getVideoModelCapability('grok')).toMatchObject({
      label: 'Grok Imagine Video',
      supportsVideoReference: true,
      supportsBaseVideoEdit: true,
      supportsVideoExtend: true,
      maxImageReferences: 7,
      maxVideoReferences: 1,
      maxReferenceVideoDuration: 15,
      supportedResolutions: ['480p', '720p', '1080p'],
    })
    expect(resolveVideoProviderModel({ model: 'grok', operation: 'generate' })).toBe('grok-imagine-video-1.5')
    expect(resolveVideoProviderModel({ model: 'grok', operation: 'edit', hasVideoReference: true })).toBe('grok-imagine-video')
    expect(resolveVideoProviderModel({ model: 'grok', operation: 'extend', hasVideoReference: true })).toBe('grok-imagine-video')
    expect(resolveVideoOutputDuration({
      model: 'grok',
      operation: 'edit',
      requestedDuration: 3,
      referenceVideoDuration: 8.2,
    })).toBe(8.2)
    expect(resolveVideoOutputDuration({ model: 'grok', operation: 'extend', referenceVideoDuration: 5 })).toBe(6)
    expect(resolvePersistedVideoDuration({
      model: 'grok',
      operation: 'extend',
      referenceVideoDuration: 5,
      outputDuration: 6,
    })).toBe(11)
    expect(validateVideoModelRequest({
      model: 'grok',
      operation: 'edit',
      hasVideoReference: true,
      videoReferenceCount: 1,
      referenceVideoDuration: 8.7,
    })).toBeNull()
    expect(validateVideoModelRequest({
      model: 'grok',
      operation: 'edit',
      hasVideoReference: true,
      videoReferenceCount: 1,
      referenceVideoDuration: 8.8,
    })).toContain('up to 8.7 seconds')
    expect(validateVideoModelRequest({
      model: 'grok',
      operation: 'extend',
      hasVideoReference: true,
      videoReferenceCount: 1,
      referenceVideoDuration: 15,
      outputDuration: 10,
    })).toBeNull()
    expect(validateVideoModelRequest({
      model: 'grok',
      operation: 'extend',
      hasVideoReference: true,
      videoReferenceCount: 1,
      referenceVideoDuration: 15,
      outputDuration: 11,
    })).toContain('between 2 and 10 seconds')
    expect(validateVideoModelRequest({
      model: 'grok',
      operation: 'generate',
      imageReferenceCount: 1,
      resolution: '1080p',
    })).toContain('reference-to-video is capped at 720p')
    expect(validateVideoModelRequest({
      model: 'grok',
      operation: 'generate',
      voiceReferenceCount: 1,
      resolution: '1080p',
    })).toContain('reference-to-video is capped at 720p')
  })

  it('enforces the Wan reference-plus-output 30-second budget', () => {
    const request = {
      model: 'wan-3.0',
      operation: 'generate' as const,
      hasVideoReference: true,
      videoReferenceCount: 1,
      referenceVideoDuration: 5.04,
    }

    expect(validateVideoModelRequest({ ...request, outputDuration: 24 })).toBeNull()
    expect(validateVideoModelRequest({ ...request, outputDuration: 25 })).toContain('30 seconds or less')
    expect(validateVideoModelRequest({ ...request, outputDuration: 30 })).toContain('duration=24')
  })

  it('charges Wan 3.0 from MuleRouter resolution pricing with the standard 2x markup', () => {
    expect(estimateVideoCredits({ model: 'wan-3.0', resolution: '480p', durationSec: 5 })).toBe(50)
    expect(estimateVideoCredits({ model: 'wan-3.0', resolution: '720p', durationSec: 5 })).toBe(100)
    expect(estimateVideoCredits({ model: 'wan-3.0', resolution: '1080p', durationSec: 5 })).toBe(200)
    expect(estimateVideoCredits({ model: 'wan-3.0', resolution: '2k', durationSec: 5 })).toBe(200)
    expect(estimateVideoCredits({ model: 'wan-3.0', resolution: '4k', durationSec: 5 })).toBe(230)
    expect(estimateVideoCredits({ model: 'wan-3.0-prime', resolution: '480p', durationSec: 5 })).toBe(68)
    expect(estimateVideoCredits({ model: 'wan-3.0-prime', resolution: '720p', durationSec: 5 })).toBe(140)
    expect(estimateVideoCredits({ model: 'wan-3.0-prime', resolution: '1080p', durationSec: 5 })).toBe(280)
    expect(estimateVideoCredits({ model: 'wan-3.0-prime', resolution: '2k', durationSec: 5 })).toBe(280)
    expect(estimateVideoCredits({ model: 'wan-3.0-prime', resolution: '4k', durationSec: 5 })).toBe(310)
  })

  it('requires explicit provider pricing for every registered video model', () => {
    for (const capability of listVideoModelCapabilities()) {
      const hasProviderPrice = capability.estimatedCostPerSecondUsd != null
        || capability.estimatedCostPerSecondUsdByResolution != null
      expect(hasProviderPrice, `${capability.id} must declare provider pricing`).toBe(true)
    }
    expect(() => getRequiredVideoCredits({
      model: 'unpriced-video-model',
      resolution: '720p',
      durationSec: 5,
    })).toThrow('Generation is blocked to prevent incorrect billing')
  })

  it('models Gemini Omni 1.1 as a fast multi-resolution generation, edit, and reference-video extension provider', () => {
    expect(normalizeVideoResolution('google-omni', 'auto')).toBe('720p')
    expect(resolveVideoGenerationRoute({ model: 'google-omni', resolution: 'auto' })).toMatchObject({
      model: 'google-omni',
      resolution: '720p',
      provider: 'google-omni',
      providerModel: 'gemini-omni-1.1-flash',
    })
    expect(getVideoModelCapability('google-omni')).toMatchObject({
      minOutputDuration: 3,
      maxOutputDuration: 10,
      supportsVideoReference: true,
      supportsBaseVideoEdit: true,
      supportsVideoExtend: true,
      maxVideoReferences: 1,
      supportedResolutions: ['360p', '720p', '1080p', '4k'],
      maxReferenceVideoDuration: 10.5,
      maxImageReferences: 6,
    })
    expect(estimateVideoCredits({ model: 'google-omni', durationSec: 5, imageCount: 1 })).toBe(102)
    expect(estimateVideoCredits({ model: 'google-omni', resolution: '360p', durationSec: 5, imageCount: 1 })).toBe(34)
    expect(estimateVideoCredits({ model: 'google-omni', resolution: '4k', durationSec: 5, imageCount: 1 })).toBe(305)
    expect(estimateVideoProviderCostUsd({
      model: 'google-omni',
      durationSec: 10,
      referenceVideoDurationSec: 5,
    })).toBeCloseTo(1.0552517055)
    expect(estimateVideoCredits({
      model: 'google-omni',
      durationSec: 10,
      referenceVideoDurationSec: 5,
    })).toBe(212)
    expect(estimateVideoCredits({
      model: 'google-omni',
      durationSec: 10,
      referenceVideoDurationSec: 10,
    })).toBe(220)
    expect(supportsNativeTextToVideo('google-omni')).toBe(true)
    expect(resolveVideoOutputDuration({
      model: 'google-omni',
      operation: 'extend',
      referenceVideoDuration: 5,
    })).toBe(10)
    expect(resolvePersistedVideoDuration({
      model: 'google-omni',
      operation: 'extend',
      referenceVideoDuration: 5.013,
      outputDuration: 10,
    })).toBeCloseTo(15.013)
    expect(validateVideoModelRequest({
      model: 'google-omni',
      operation: 'extend',
      hasVideoReference: true,
      videoReferenceCount: 1,
      referenceVideoDuration: 10,
      outputDuration: 10,
    })).toBeNull()
    expect(validateVideoModelRequest({
      model: 'google-omni',
      operation: 'extend',
      hasVideoReference: true,
      videoReferenceCount: 2,
      referenceVideoDuration: 10,
      outputDuration: 10,
    })).toContain('at most 1 reference video')
  })

  it('caps stateful Google Omni continuation at 40 seconds cumulatively', async () => {
    const result = await createVideo({
      script: 'Continue the final scene.',
      images: [],
      duration: 10,
      referenceVideoDuration: 40,
      videoModel: 'google-omni',
      videoOperation: 'extend',
      previousInteractionId: 'v1_previous',
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('maximum cumulative duration of 40 seconds')
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
    expect(result.message).toContain('Gemini Omni 1.1 Flash supports at most 6 reference images per request')
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

  it('defaults replication to Wan 3.0 Prime without overriding explicit model choices', () => {
    expect(DEFAULT_VIDEO_REPLICATION_MODEL_ID).toBe('wan-3.0-prime')
    expect(resolveVideoReplicationModelId()).toBe('wan-3.0-prime')
    expect(resolveVideoReplicationModelId('seedance-fast')).toBe('seedance-fast')

    expect(resolveAgentVideoSelection({
      appModel: 'seedance-fast',
      appResolution: 'auto',
      appAuto: true,
      toolModel: resolveVideoReplicationModelId(),
    })).toEqual({ model: 'wan-3.0-prime', resolution: 'auto', locked: false })

    expect(resolveAgentVideoSelection({
      appModel: 'seedance',
      appResolution: '1080p',
      appAuto: false,
      toolModel: resolveVideoReplicationModelId(),
    })).toEqual({ model: 'seedance', resolution: '1080p', locked: true })
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
    expect(resolveVideoProviderAspectRatio('grok', '3:2')).toBe('3:2')
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
    expect(unsupported.message).toContain('Grok Imagine Video does not support 21:9')

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
