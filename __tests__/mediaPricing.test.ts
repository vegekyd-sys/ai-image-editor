import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seededMediaPrices } from './helpers/media-prices'
import { calculateMediaQuote, quoteSeedAudio, quoteVideo } from '@/lib/billing/media-pricing'
import { estimateVideoCredits, listVideoModelCapabilities, type VideoResolution } from '@/lib/video-model-capabilities'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ order: query }) }) }) }))

beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue({ data: seededMediaPrices(), error: null }) })

describe('database-backed media quotes', () => {
  it('seeds every registered model/resolution and preserves existing tariffs', async () => {
    for (const model of listVideoModelCapabilities()) for (const resolution of model.supportedResolutions ?? [model.defaultResolution!]) {
      const input = { model: model.id, resolution, durationSec: 5, imageCount: 1, referenceVideoDurationSec: 3 }
      expect((await quoteVideo(input)).credits, `${model.id}/${resolution}`).toBe(estimateVideoCredits(input))
    }
  })
  it('uses new Admin rates on the next quote and never changes an existing quote', async () => {
    const input = { model: 'wan-3.0-prime', resolution: '480p' as VideoResolution, durationSec: 5 }
    const original = await quoteVideo(input)
    const prices = seededMediaPrices()
    const row = prices.find(p => p.id === original.priceId)!
    row.output_usd_per_second = 0.02
    row.updated_at = 'new-version'
    query.mockResolvedValueOnce({ data: prices, error: null })
    expect(await quoteVideo(input)).toMatchObject({ credits: 20, priceVersion: 'new-version' })
    expect(original).toMatchObject({ credits: 48, priceVersion: '2026-09-03T00:00:00Z' })
  })
  it('keeps Grok edit input pricing and Seedance surcharge explicit in DB', async () => {
    expect((await quoteVideo({ model: 'grok', operation: 'edit', resolution: '720p', durationSec: 5, referenceVideoDurationSec: 5 })).credits).toBe(80)
    const input = { model: 'seedance-2.5', durationSec: 10 }
    expect((await quoteVideo({ ...input, contentFilter: false })).credits).toBe(estimateVideoCredits({ ...input, contentFilter: false }))
  })
  it('quotes Seedance 480p standard output and floors video input at output duration', async () => {
    const input = { model: 'seedance-2.5', resolution: '480p' as const, durationSec: 10 }
    const standard = await quoteVideo(input)
    expect(standard.supplierCostUsd).toBeCloseTo(1.38)
    expect(standard.credits).toBe(276)
    for (const [referenceVideoDurationSec, cost] of [[3, 1.68], [10, 1.68], [15, 2.1]]) {
      const quote = await quoteVideo({ ...input, referenceVideoDurationSec })
      expect(quote.supplierCostUsd).toBeCloseTo(cost)
      expect(quote.referenceVideoDurationSec).toBe(referenceVideoDurationSec)
    }
    expect((await quoteVideo({ ...input, referenceVideoDurationSec: 3, contentFilter: false })).supplierCostUsd).toBeCloseTo(1.848)
    const prices = seededMediaPrices()
    const price = prices.find(p => p.id === 'video:seedance-2.5:480p:generate')!
    price.output_usd_per_second = 0.2
    price.video_reference_usd_per_second = 0.1
    query.mockResolvedValue({ data: prices, error: null })
    expect((await quoteVideo(input)).supplierCostUsd).toBe(2)
    expect((await quoteVideo({ ...input, referenceVideoDurationSec: 3 })).supplierCostUsd).toBe(2)
    // A custom/old row without the new tariff retains its legacy quote.
    delete price.video_reference_usd_per_second
    expect((await quoteVideo({ ...input, referenceVideoDurationSec: 3 })).supplierCostUsd).toBe(2)
  })
  it('bills audio from the same USD rate for supplier credits and measured seconds', async () => {
    expect((await quoteSeedAudio({ durationSeconds: 8 })).credits).toBe(4)
    expect((await quoteSeedAudio({ providerCreditsUsed: 1.36 })).credits).toBe(4)
  })
  it('composes Eco from live base and enhancement tariffs with separate rounding', async () => {
    const prices = seededMediaPrices()
    prices.find(p => p.id === 'video:seedance-2.5:480p:generate')!.output_usd_per_second = .2
    prices.find(p => p.id === 'video:bytedance-video-upscale:4k:generate')!.output_usd_per_second = .03
    query.mockResolvedValue({ data: prices, error: null })
    const input = { durationSec: 10, resolution: '4k' as const }
    const eco = await quoteVideo({ ...input, model: 'seedance-2.5-eco' })
    expect(eco).toMatchObject({ baseCredits: 400, upscaleCredits: 60, credits: 460 })
    expect(eco.supplierCostUsd).toBeCloseTo(2.3)
  })
  it('charges the published 60fps band without granting a guessed 24fps discount', async () => {
    const input = { model: 'bytedance-video-upscale', durationSec: 10, resolution: '4k' as const }
    const thirty = await quoteVideo({ ...input, outputFps: 30 })
    expect((await quoteVideo({ ...input, outputFps: 24 })).credits).toBe(thirty.credits)
    expect((await quoteVideo({ ...input, outputFps: 60 })).supplierCostUsd).toBeCloseTo(thirty.supplierCostUsd * 2)
    await expect(quoteVideo({ ...input, outputFps: 61 })).rejects.toThrow('frame rate')
  })
  it('rejects missing, disabled, invalid and unreachable pricing', async () => {
    await expect(quoteVideo({ model: 'not-configured', durationSec: 5 })).rejects.toThrow('not configured')
    const row = seededMediaPrices()[0]
    expect(() => calculateMediaQuote({ ...row, is_active: false }, { durationSec: 5 })).toThrow('disabled')
    for (const durationSec of [-1, 0, NaN, Infinity]) expect(() => calculateMediaQuote(row, { durationSec })).toThrow()
    expect(() => calculateMediaQuote({ ...row, output_usd_per_second: 1e20 }, { durationSec: 5 })).toThrow('credit range')
    query.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    await expect(quoteVideo({ model: 'wan-3.0', durationSec: 5 })).rejects.toThrow('unavailable')
    expect((await quoteVideo({ model: 'wan-3.0', durationSec: 5 })).credits).toBe(120)
  })
})
