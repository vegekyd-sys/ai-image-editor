import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAnimationHarness } from './helpers/generateAnimationHarness'
import { getVideoModelCapability, resolveAgentVideoSelection } from '@/lib/video-model-capabilities'

const input = { model: 'seedance-2.5-native', story_prompt: 'A small purple wizard waves.', duration: 4, video_resolution: '4k', aspect_ratio: '16:9' }
function harness() {
  const h = generateAnimationHarness()
  h.ctx.snapshotImages = []
  h.ctx.videoModel = 'kling-4-flash'
  return h
}
const run = (h: ReturnType<typeof harness>, args = input as any) => h.tool.execute(args, { messages: [] })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('native 4K Agent cost admission and receipts', () => {
  it('publishes a scoped opt-in policy, preserving automatic and Eco routes', () => {
    expect(getVideoModelCapability('seedance-2.5-native')).toMatchObject({ highCostResolutions: ['4k'], usagePolicy: expect.stringContaining('high cost') })
    expect(getVideoModelCapability('seedance-2.5-eco').highCostResolutions).toBeUndefined()
    expect(resolveAgentVideoSelection({ appAuto: true })).toMatchObject({ model: 'kling-4-flash' })
    expect(resolveAgentVideoSelection({ toolModel: 'seedance-2.5', toolResolution: '4k' })).toMatchObject({ model: 'seedance-2.5-eco' })
  })
  it('first returns a complete no-charge quote even if the Agent guesses a ceiling', async () => {
    const h = harness()
    const r = await run(h, { ...input, max_credits: 99999 })
    expect(r).toMatchObject({ success: false, errorCode: 'NATIVE_4K_COST_DISCLOSURE_REQUIRED' })
    expect(r.costQuote).toEqual({ credits: 946, durationSec: 4, imageCount: 1, referenceVideoDurationSec: 0 })
    expect(Object.keys(r.userMessage)).toEqual(['en', 'zh', 'zh-Hant', 'ja'])
    expect(h.deductFixedCredits).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it('submits after disclosure, persists the actual quote and replays the receipt without another charge', async () => {
    const h = harness()
    await run(h)
    const r = await run(h, { ...input, max_credits: 946 })
    expect(r.success).toBe(true)
    expect(h.deductFixedCredits).toHaveBeenCalledTimes(1)
    expect(h.deductFixedCredits.mock.calls[0][1]).toBe(946)
    expect(h.insert.mock.calls[0][0].video_meta).toMatchObject({ resolution: '4k', creditsCharged: 946, billingQuote: { supplierCostUsd: 4.728, credits: 946 } })
    expect(await run(h, { ...input, max_credits: 946 })).toEqual(r)
    expect(h.createVideo).toHaveBeenCalledTimes(2) // quote + one paid admission
    expect(h.deductFixedCredits).toHaveBeenCalledTimes(1)
  })
  it('a changed duration needs a fresh disclosed quote before any charge', async () => {
    const h = harness()
    await run(h)
    expect(await run(h, { ...input, duration: 8, max_credits: 946 })).toMatchObject({ costQuote: { credits: 1892 } })
    expect(h.deductFixedCredits).not.toHaveBeenCalled()
  })
  it.each([false, true])('handles definite rejection versus unknown submission (%s)', async uncertain => {
    const h = harness()
    await run(h)
    h.createVideo.mockImplementationOnce(async i => {
      await i.onBeforeProviderSubmit({ model: i.videoModel, resolution: i.videoResolution, durationSec: 4 })
      return { success: false, submissionUncertain: uncertain, message: uncertain ? 'Timeout' : 'HTTP 400' }
    })
    const r = await run(h, { ...input, max_credits: 946 })
    expect(r.success).toBe(false)
    expect(h.deductFixedCredits).toHaveBeenCalledTimes(1)
    expect(h.refundCredits).toHaveBeenCalledTimes(uncertain ? 0 : 1)
    if (uncertain) {
      expect(r).toMatchObject({ errorCode: 'SUBMISSION_UNCERTAIN', retryable: false })
      expect(await run(h, { ...input, max_credits: 946 })).toEqual(r)
      expect(h.createVideo).toHaveBeenCalledTimes(2)
    }
  })
  it('keeps the paid receipt on snapshot persistence failure', async () => {
    const h = harness()
    await run(h)
    h.insert.mockResolvedValueOnce({ error: { message: 'Fixture disk unavailable' } })
    const r = await run(h, { ...input, max_credits: 946 })
    expect(r).toMatchObject({ errorCode: 'PERSISTENCE_RECONCILIATION_REQUIRED', retryable: false, taskId: 'fal-h3max-turbo-test' })
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(await run(h, { ...input, max_credits: 946 })).toEqual(r)
    expect(h.deductFixedCredits).toHaveBeenCalledTimes(1)
  })
})
