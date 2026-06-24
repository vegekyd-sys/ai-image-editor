import { describe, expect, it } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import { estimateVideoCredits, getDefaultVideoModelId, getVideoModelCapability, normalizeVideoModelId, normalizeVideoResolution, resolveAgentVideoSelection, resolveVideoGenerationRoute, resolveVideoProviderAspectRatio } from '@/lib/video-model-capabilities'

describe('video model reference limits', () => {
  it('defaults video generation to SeeDance 2.0 Fast', () => {
    expect(getDefaultVideoModelId()).toBe('seedance-fast')
    expect(normalizeVideoModelId()).toBe('seedance-fast')
    expect(normalizeVideoModelId('seedance')).toBe('seedance')
    expect(normalizeVideoModelId('seedance-fast')).toBe('seedance-fast')
    expect(normalizeVideoResolution('seedance-fast', 'auto')).toBe('720p')
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
      referenceVideoMetas: [{ width: 320, height: 320 }],
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
      referenceVideoMetas: [{ width: 720, height: 1280 }],
      duration: 8,
      videoModel: 'seedance',
    })

    expect(result.success).toBe(false)
    expect(result.message).not.toContain('reference video size')
    expect(result.message).toContain('EVOLINK_API_KEY')
  })

  it('does not invent a Kling reference-video lower resolution limit', async () => {
    const result = await createVideo({
      script: 'Tiny Kling reference\n\nRestyle <<<media_1>>>.',
      images: [],
      videoUrls: ['https://example.com/tiny.mp4'],
      referenceVideoDuration: 8,
      referenceVideoMetas: [{ width: 320, height: 320 }],
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
      referenceVideoMetas: [{ width: 2560, height: 1440 }],
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
