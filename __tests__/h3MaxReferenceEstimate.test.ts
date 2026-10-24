import { describe, expect, it } from 'vitest'
import { estimateH3MaxReferenceCost } from '@/lib/fal-h3-max-reference-video'
import { estimateVideoCredits, estimateVideoProviderCostUsd } from '@/lib/video-model-capabilities'

describe('H3 Max research and seed estimates', () => {
  it.each([
    ['480p', 0.25, 16718, 0.25244, 0.50244, 101],
    ['768p', 0.4, 39584, 0.70976, 1.10976, 222],
    ['1080p', 0.8, 39584, 0.70976, 1.50976, 302],
  ] as const)('keeps measured mixed-reference estimates at %s', (resolution, outputUsd, referenceTokens, referenceUsd, totalUsd, credits) => {
    const research = estimateH3MaxReferenceCost({ duration: 5, resolution, images: [{ width: 1024, height: 1024 }, { width: 1024, height: 1024 }], videoSeconds: 5, audioSeconds: 3 })
    expect(research).toEqual({ outputUsd, referenceTokens, referenceUsd, totalUsd, estimatedCreditsAt2x: credits })
    const seed = { model: 'fal-h3-max', resolution, durationSec: 5, referenceImagePixels: 2 * 1024 * 1024, referenceVideoDurationSec: 5, referenceAudioDurationSec: 3 }
    expect(estimateVideoProviderCostUsd(seed)).toBe(totalUsd)
    expect(estimateVideoCredits(seed)).toBe(credits)
  })

  it.each([
    [0, 0, 0, 0],
    [1024, 0, 1024, 0],
    [4096, 0, 4096, 0],
    [4096, 1, 4176, 0.0016],
  ])('pools one allowance for %s image tokens and %s audio seconds', (imageTokens, audioSeconds, referenceTokens, referenceUsd) => {
    const images = imageTokens ? [{ width: 1024, height: imageTokens }] : []
    const research = estimateH3MaxReferenceCost({ duration: 5, resolution: '768p', images, videoSeconds: 0, audioSeconds })
    expect(research.referenceTokens).toBe(referenceTokens)
    expect(research.referenceUsd).toBe(referenceUsd)
    expect(estimateVideoProviderCostUsd({ model: 'fal-h3-max', resolution: '768p', durationSec: 5, referenceImagePixels: imageTokens * 1024, referenceAudioDurationSec: audioSeconds })).toBe(research.totalUsd)
  })

  it.each([
    { duration: 0 }, { duration: NaN }, { videoSeconds: -1 }, { audioSeconds: Infinity },
    { images: [{ width: 0, height: 1024 }] }, { images: [{ width: NaN, height: 1024 }] },
  ])('preserves research validation for %j', invalid => {
    expect(() => estimateH3MaxReferenceCost({ duration: 5, resolution: '768p', images: [], videoSeconds: 0, audioSeconds: 0, ...invalid }))
      .toThrow('Cost estimate requires measured positive dimensions and nonnegative durations.')
  })
})
