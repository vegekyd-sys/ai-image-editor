import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { seededMediaPrices } from './helpers/media-prices'
import { calculateMediaQuote, videoPriceId } from '@/lib/billing/media-pricing'
const mock = vi.hoisted(() => ({ create: vi.fn(), reserve: vi.fn(), refund: vi.fn(), rpc: vi.fn(), insert: vi.fn(), db: {} as any }))
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: async () => ({ auth: { userId: 'owner', supabase: mock.db } }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mock.db }))
vi.mock('@/lib/skills/create-video', () => ({ createVideo: mock.create }))
vi.mock('@/lib/grok-subscription', () => ({ isGrokSubscriptionAllowedUser: async () => false }))
vi.mock('@/lib/billing/credits', () => ({
  reserveFixedCredits: mock.reserve, deductFixedCredits: mock.reserve, refundCredits: mock.refund,
  requireCredits: async () => ({ ok: true }), recordSubscriptionUsage: vi.fn(),
  isInsufficientCreditsError: () => false, InsufficientCreditsError: class extends Error {},
}))
vi.mock('@/lib/billing/media-pricing', async importOriginal => {
  const mod = await importOriginal<typeof import('@/lib/billing/media-pricing')>()
  return { ...mod, quoteVideo: async (input: any) => calculateMediaQuote(seededMediaPrices().find(p => p.id === videoPriceId(input))!, input) }
})
import { POST as snapshot } from '@/app/api/video-snapshot/route'
import { POST as animate } from '@/app/api/animate/route'
beforeEach(() => {
  vi.clearAllMocks()
  mock.reserve.mockImplementation(async (_u, credits) => ({ charged: credits }))
  mock.rpc.mockResolvedValue({ data: 0, error: null })
  mock.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'saved-animation' }, error: null }) }), error: null })
  mock.db = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) }, rpc: mock.rpc,
    from: (table: string) => {
      const response = { data: table === 'projects' ? { id: 'project', user_id: 'owner' } : [], error: null }
      const chain: any = { select: () => chain, eq: () => chain, single: async () => response, maybeSingle: async () => response, order: async () => response, insert: mock.insert }
      return chain
    },
  }
  mock.create.mockImplementation(async input => {
    try { await input.onBeforeProviderSubmit?.({ model: input.videoModel, resolution: input.videoResolution, durationSec: 4, operation: 'generate' }) }
    catch (e) { return { success: false, submissionUncertain: false, message: String(e) } }
    return { success: true, taskId: 'native4k-http-fixture' }
  })
})
const request = (maxCredits?: number) => new NextRequest('http://localhost/api/fixture', { method: 'POST', body: JSON.stringify({ projectId: 'project', prompt: 'A small wizard waves', imageUrls: [], videoModel: 'seedance-2.5-native', videoResolution: '4k', duration: 4, maxCredits }) })
describe.each([['snapshot', snapshot], ['legacy animation', animate]] as const)('native 4K %s admission', (_name, post) => {
  it('returns total quote without debit when the ceiling is missing or insufficient', async () => {
    for (const ceiling of [undefined, 900]) {
      const r = await post(request(ceiling))
      expect(r.status).toBe(409)
      expect(await r.json()).toMatchObject({ errorCode: 'NATIVE_4K_COST_DISCLOSURE_REQUIRED', costQuote: { credits: 946 } })
    }
    expect(mock.reserve).not.toHaveBeenCalled()
    expect(mock.refund).not.toHaveBeenCalled()
  })
  it('reserves the final quote and keeps unknown submission outcomes reserved', async () => {
    mock.create.mockImplementationOnce(async input => {
      await input.onBeforeProviderSubmit({ model: input.videoModel, resolution: input.videoResolution, durationSec: 4 })
      return { success: false, submissionUncertain: true, message: 'Transport timeout' }
    })
    const r = await post(request(946))
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ code: 'SUBMISSION_UNCERTAIN', retryable: false })
    expect(mock.reserve).toHaveBeenCalledWith('owner', 946, 'create_video', 'seedance-2.5', undefined)
    expect(mock.refund).not.toHaveBeenCalled()
  })
  it('refunds one definite rejected submission', async () => {
    mock.create.mockImplementationOnce(async input => {
      await input.onBeforeProviderSubmit({ model: input.videoModel, resolution: input.videoResolution, durationSec: 4 })
      return { success: false, submissionUncertain: false, message: 'HTTP 400' }
    })
    await post(request(946))
    expect(mock.refund).toHaveBeenCalledTimes(1)
    expect(mock.refund).toHaveBeenCalledWith('owner', 946, 'create_video')
  })
})

it('reserves the measured H3 frame quote once before submission and persists the actual charge', async () => {
  mock.create.mockImplementationOnce(async input => {
    expect(mock.reserve).not.toHaveBeenCalled()
    await input.onBeforeProviderSubmit({ model: 'minimax-h3-max', resolution: '768p', h3Operation: 'turbo-generation', durationSec: 5 })
    expect(mock.reserve).toHaveBeenCalledWith('owner', 40, 'create_video', 'minimax-h3-max', undefined)
    return { success: true, taskId: 'fal-h3max-turbo-frame-fixture' }
  })
  const h3Controls = { kind: 'turbo-generation', frames: 'last' }
  const response = await snapshot(new NextRequest('http://localhost/api/video-snapshot', { method: 'POST', body: JSON.stringify({
    projectId: 'project', prompt: 'End on the reference.', videoModel: 'minimax-h3-max',
    duration: 5, videoResolution: '768p', imageUrls: ['https://example.com/end.png'], h3Controls,
  }) }))
  expect(response.status).toBe(200)
  expect((await response.json()).videoMeta).toMatchObject({ creditsCharged: 40, h3Controls })
  expect(mock.reserve).toHaveBeenCalledTimes(1)
})
