import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), quote: vi.fn(), allowed: vi.fn(), balance: vi.fn(), enabled: vi.fn(), log: vi.fn(), previous: vi.fn() }))
vi.mock('@/lib/skills/create-video', () => ({ createVideo: mocks.create }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.previous }
  return query
} }) }))
vi.mock('@/lib/grok-subscription', () => ({ isGrokSubscriptionAllowedUser: mocks.allowed }))
vi.mock('@/lib/billing/media-pricing', () => ({ quoteVideo: mocks.quote }))
vi.mock('@/lib/billing/credits', () => ({ isBillingEnabled: mocks.enabled, requireCredits: mocks.balance, recordSubscriptionUsage: mocks.log }))
import { submitMcpVideo, settleMcpVideoStatus } from '@/lib/billing/mcp-video'

const input = { script: 'A landscape', images: [], videoModel: 'wan-3.0', duration: 5 }
const owner = { userId: 'owner', apiKeyId: 'key', toolName: 'makaron_create_video' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.allowed.mockResolvedValue(false)
  mocks.enabled.mockResolvedValue(true)
  mocks.balance.mockResolvedValue({ ok: true })
  mocks.quote.mockResolvedValue({ credits: 30, priceId: 'rate', priceVersion: 'v1' })
  mocks.rpc.mockResolvedValue({ data: { created: true }, error: null })
  mocks.create.mockImplementation(async args => {
    try {
      await args.onBeforeProviderSubmit({ model: args.videoModel, durationSec: 5, imageCount: 0 })
      return { success: true, taskId: 'task', message: 'created' }
    } catch (e) { return { success: false, message: String(e), submissionUncertain: true } }
  })
})
it('reserves before provider creation and does not post-charge again', async () => {
  const result = await submitMcpVideo(input, owner)
  expect(result.success).toBe(true)
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['reserve_mcp_video', 'finish_mcp_video_submission'])
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_user_id: 'owner', p_quote: { credits: 30 } })
})
it('does not submit or reserve when balance is insufficient', async () => {
  mocks.balance.mockResolvedValue({ ok: false, balance: 2 })
  expect((await submitMcpVideo(input, owner)).success).toBe(false)
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('isolates concurrent reservations', async () => {
  await Promise.all([submitMcpVideo(input, owner), submitMcpVideo(input, owner)])
  const ids = mocks.rpc.mock.calls.filter(call => call[0] === 'reserve_mcp_video').map(call => call[1].p_id)
  expect(new Set(ids).size).toBe(2)
})
it('returns an existing task on idempotent replay', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { created: false, task_id: 'prior', status: 'submitted' }, error: null })
  expect(await submitMcpVideo(input, owner)).toMatchObject({ success: true, taskId: 'prior' })
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
it('replays a returned ID after an initial call without an explicit ID, even after prices change', async () => {
  await submitMcpVideo(input, owner)
  const reservation = mocks.rpc.mock.calls[0][1]
  mocks.previous.mockResolvedValue({ data: { fingerprint: reservation.p_fingerprint, task_id: 'task', status: 'submitted' } })
  mocks.quote.mockRejectedValue(new Error('Pricing subsequently unavailable'))
  mocks.create.mockClear()
  const result = await submitMcpVideo({ billingRequestId: reservation.p_id, ...input }, owner)
  expect(result).toMatchObject({ success: true, taskId: 'task', retryable: false })
  expect(mocks.create).not.toHaveBeenCalled()
  await expect(submitMcpVideo({ ...input, duration: 10, billingRequestId: reservation.p_id }, owner)).rejects.toThrow('parameters changed')
})
it('holds uncertain submissions and refunds only definite rejection', async () => {
  for (const uncertain of [true, false]) {
    mocks.create.mockImplementationOnce(async args => {
      await args.onBeforeProviderSubmit({ model: 'wan-3.0', durationSec: 5 })
      return { success: false, message: 'error', submissionUncertain: uncertain }
    })
    const result = await submitMcpVideo(input, owner)
    if (uncertain) expect(result).toMatchObject({ retryable: false, errorCode: 'SUBMISSION_UNCERTAIN' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_mcp_video_submission', expect.objectContaining({ p_state: uncertain ? 'uncertain' : 'refunded' }))
  }
})
it('does not refund on poll transport errors', async () => {
  await settleMcpVideoStatus('owner', 'task', 'failed', true)
  expect(mocks.rpc).not.toHaveBeenCalled()
  await settleMcpVideoStatus('owner', 'task', 'failed')
  expect(mocks.rpc).toHaveBeenCalledWith('settle_mcp_video', { p_user_id: 'owner', p_task_id: 'task', p_failed: true })
})
it('keeps subscription free but reserves before a paid fallback', async () => {
  mocks.allowed.mockResolvedValue(true)
  mocks.create.mockImplementationOnce(async args => {
    await args.onBeforeProviderSubmit({ model: 'grok', durationSec: 5 })
    expect(mocks.rpc).not.toHaveBeenCalled()
    await args.onBeforeGrokApiFallback()
    return { success: true, taskId: 'paid-fallback', provider: 'xai', message: 'created' }
  })
  await submitMcpVideo({ ...input, videoModel: 'grok' }, owner)
  expect(mocks.rpc).toHaveBeenCalledWith('reserve_mcp_video', expect.any(Object))
  expect(mocks.log).not.toHaveBeenCalled()
})
it('marks synchronous completed videos terminal without polling an unrecoverable task ID', async () => {
  mocks.create.mockImplementationOnce(async args => {
    await args.onBeforeProviderSubmit({ model: 'google-omni', durationSec: 5 })
    return { success: true, taskId: 'google-omni-task', status: 'completed', videoUrl: 'https://example.com/video.mp4', message: 'completed' }
  })
  expect((await submitMcpVideo({ ...input, videoModel: 'google-omni' }, owner)).success).toBe(true)
  expect(mocks.rpc).toHaveBeenLastCalledWith('finish_mcp_video_submission', expect.objectContaining({ p_state: 'completed' }))
})
