import { describe, expect, it } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import { getDefaultVideoModelId, getVideoModelCapability, normalizeVideoModelId } from '@/lib/video-model-capabilities'

describe('video model reference limits', () => {
  it('defaults video generation to SeeDance', () => {
    expect(getDefaultVideoModelId()).toBe('seedance')
    expect(normalizeVideoModelId()).toBe('seedance')
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
})
