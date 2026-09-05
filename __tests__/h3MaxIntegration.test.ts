import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVideo } from '@/lib/skills/create-video'
import { getDefaultVideoModelId, normalizeVideoResolution, resolveAgentVideoSelection, normalizeVideoModelId, resolveVideoImageWorkflow, resolveVideoProviderModel, validateVideoModelRequest } from '@/lib/video-model-capabilities'
import { calculateMediaQuote } from '@/lib/billing/media-pricing'
import { seededMediaPrices } from './helpers/media-prices'
const { prepare, submit } = vi.hoisted(() => ({ prepare: vi.fn(), submit: vi.fn() }))
vi.mock('@/lib/h3-reference-preflight', () => ({ prepareH3ReferenceMedia: prepare, H3ReferenceInputError: class extends Error {} }))
vi.mock('@/lib/fal-h3-max-reference-video', () => ({ createFalH3MaxReferenceVideoTask: submit }))
beforeEach(() => {
  vi.clearAllMocks()
  prepare.mockResolvedValue({ videos: [], audios: [], referenceImagePixels: 1024 * 1024, referenceVideoDurationSec: 0, referenceAudioDurationSec: 0 })
  submit.mockImplementation(async input => { await input.onBeforeSubmit?.(); return 'fal-h3max-reference-integration' })
})
describe('FAL H3 Max product integration', () => {
  it.each(['minimax-h3-max', 'h3 max', 'H3 Max Turbo', 'fal H3 Turbo'])('keeps explicit Turbo selector %s on Turbo', alias => {
    expect(normalizeVideoModelId(alias)).toBe('minimax-h3-max')
    expect(resolveVideoProviderModel({ model: alias, imageReferenceCount: 1 })).toBe('minimax/h3-max-turbo/image-to-video')
  })
  it('defaults an unspecified request to Max 768p while respecting explicit selections', async () => {
    expect(getDefaultVideoModelId()).toBe('fal-h3-max')
    expect(normalizeVideoResolution(undefined, 'auto')).toBe('768p')
    expect(resolveAgentVideoSelection({})).toEqual({ model: 'fal-h3-max', resolution: 'auto', locked: false })
    expect(resolveAgentVideoSelection({ toolModel: 'minimax-h3-max' })).toMatchObject({ model: 'minimax-h3-max', locked: false })
    expect(resolveAgentVideoSelection({ appModel: 'seedance-fast', appAuto: false, toolModel: 'fal-h3-max' })).toMatchObject({ model: 'seedance-fast', locked: true })
    const result = await createVideo({ script: 'A red book slowly opens', images: [], duration: 5 })
    expect(result).toMatchObject({ success: true, videoModel: 'fal-h3-max', providerModel: 'minimax/h3-max/text-to-video' })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ resolution: '768p', duration: 5 }))
  })
  it('gives the new Max an independent selector and reference contract', () => {
    expect(normalizeVideoModelId('FAL H3 Max')).toBe('fal-h3-max')
    expect(resolveVideoImageWorkflow({ model: 'fal-h3-max', imageReferenceCount: 1 })).toBe('reference-to-video')
    expect(resolveVideoProviderModel({ model: 'fal-h3-max', imageReferenceCount: 1 })).toBe('minimax/h3-max/reference-to-video')
    expect(resolveVideoProviderModel({ model: 'fal-h3-max' })).toBe('minimax/h3-max/text-to-video')
    expect(validateVideoModelRequest({ model: 'fal-h3-max', outputDuration: 7, imageReferenceCount: 9, videoReferenceCount: 3 })).toBeNull()
    expect(validateVideoModelRequest({ model: 'fal-h3-max', operation: 'extend' })).toBeTruthy()
  })
  it('sends a selected single image as a reference and bills measured pixels before submission', async () => {
    const reserve = vi.fn()
    const result = await createVideo({ videoModel: 'fal-h3-max', script: '<<<media_2>>> in a new room', images: ['https://example.com/unused.jpg', 'https://example.com/selected.jpg'], duration: 7, onBeforeProviderSubmit: reserve })
    expect(result).toMatchObject({ success: true, videoModel: 'fal-h3-max', providerModel: 'minimax/h3-max/reference-to-video' })
    expect(prepare).toHaveBeenCalledWith(['https://example.com/selected.jpg'], [], [])
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Image 1 in a new room', images: ['https://example.com/selected.jpg'], duration: 7 }))
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ model: 'fal-h3-max', durationSec: 7, imageCount: 1, referenceImagePixels: 1048576 }))
  })
  it('does not submit when the final measured quote cannot be reserved', async () => {
    submit.mockImplementation(async input => { await input.onBeforeSubmit?.(); throw new Error('must not reach provider') })
    const result = await createVideo({ videoModel: 'fal-h3-max', script: '<<<media_1>>>', images: ['https://example.com/image.jpg'], duration: 5, onBeforeProviderSubmit: async () => { throw new Error('Insufficient credits') } })
    expect(result.success).toBe(false)
    expect(result.message).toContain('Insufficient credits')
  })
  it('pools image, video and audio tokens once and rounds final credits once', () => {
    const price = seededMediaPrices().find(row => row.id === 'video:fal-h3-max:768p:generate')!
    expect(calculateMediaQuote(price, { durationSec: 5, imageCount: 2, referenceImagePixels: 2 * 1024 * 1024, referenceVideoDurationSec: 5 })).toMatchObject({ credits: 221, referenceTokens: 39344, billableReferenceTokens: 35248 })
    expect(calculateMediaQuote(price, { durationSec: 5, imageCount: 1, referenceImagePixels: 2048 * 2048, referenceAudioDurationSec: 3 }).credits).toBe(81)
    expect(() => calculateMediaQuote(price, { durationSec: 5, referenceImagePixels: NaN })).toThrow()
  })
})
