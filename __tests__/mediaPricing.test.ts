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
  it('bills audio from the same USD rate for supplier credits and measured seconds', async () => {
    expect((await quoteSeedAudio({ durationSeconds: 8 })).credits).toBe(4)
    expect((await quoteSeedAudio({ providerCreditsUsed: 1.36 })).credits).toBe(4)
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
