import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import { calculateMediaQuote, videoPriceId } from '@/lib/billing/media-pricing'
import { seededMediaPrices } from './helpers/media-prices'

afterEach(() => vi.unstubAllGlobals())
describe('native 4K bills final provider inputs before POST', () => {
  it.each([
    ['generate', 4, 8, 4, 8.688],
    ['edit', 4, 8, 8, 11.584],
    ['extend', 4, 8, 4, 8.688],
    ['edit', 4, 4.041667, 4.1, 5.9368],
    ['extend', 12, 8, 12, 17.376],
  ] as const)('%s ignores stale output/input estimates (%ss requested, %ss input)', async (operation, duration, source, output, cost) => {
    const post = vi.fn(); vi.stubGlobal('fetch', post)
    let quote: any
    const result = await createVideo({
      script: 'Preserve the wizard while adding gentle star sparkles.', images: [],
      videoModel: 'seedance-2.5-native', videoResolution: '4k', videoOperation: operation,
      duration, videoUrls: ['https://fixture.invalid/source.mp4'],
      referenceVideoDuration: 1, // intentionally stale UI metadata
      referenceVideoMetas: [{ durationSec: source, width: 1280, height: 720, fileSizeBytes: 2000000 }],
      onBeforeProviderSubmit: async usage => {
        const price = seededMediaPrices().find(p => p.id === videoPriceId(usage))!
        quote = calculateMediaQuote(price, usage)
        throw new Error('Quote only: paid POST forbidden in this test')
      },
    })
    expect(result.success).toBe(false)
    expect(quote).toMatchObject({ durationSec: output, referenceVideoDurationSec: source })
    expect(quote.supplierCostUsd).toBeCloseTo(cost, 6)
    expect(quote.credits).toBe(Math.ceil(cost * 200 - 1e-9))
    expect(post).not.toHaveBeenCalled()
  })
  it.each([{ duration: -1 }, { duration: 4, webSearch: true }])('blocks unpriced variable add-ons before POST: %j', async options => {
    const post = vi.fn(); vi.stubGlobal('fetch', post)
    const result = await createVideo({ script: 'A wizard', images: [], videoModel: 'seedance-2.5-native', videoResolution: '4k', ...options })
    expect(result).toMatchObject({ success: false, submissionUncertain: false, retryable: false })
    expect(post).not.toHaveBeenCalled()
  })
})
