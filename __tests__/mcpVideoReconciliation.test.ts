import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: vi.fn(), rpc: vi.fn(), rows: [] as unknown[], updates: [] as Array<{ values: unknown; filters: unknown[] }>, updateError: null as unknown }))
vi.mock('@/lib/skills/create-video', () => ({ createVideo: vi.fn() }))
vi.mock('@/lib/skills/get-video-status', () => ({ getVideoStatus: mocks.status }))
vi.mock('@/lib/grok-subscription', () => ({ isGrokSubscriptionAllowedUser: vi.fn() }))
vi.mock('@/lib/billing/media-pricing', () => ({ quoteVideo: vi.fn() }))
vi.mock('@/lib/billing/credits', () => ({ isBillingEnabled: vi.fn(), requireCredits: vi.fn(), recordSubscriptionUsage: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc, from: () => {
  const read = { select: () => read, eq: () => read, lt: () => read, order: () => read, limit: async () => ({ data: mocks.rows }) }
  return { ...read, update: (values: unknown) => {
    const update = { values, filters: [] as unknown[] }
    mocks.updates.push(update)
    const write = { eq: (...args: unknown[]) => { update.filters.push(args); return write },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: mocks.updateError }).then(resolve) }
    return write
  } }
} }) }))
import { reconcileMcpVideos } from '@/lib/billing/mcp-video'

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
  mocks.rows = [{ id: 'reservation', user_id: 'owner', task_id: 'minimax-h3-old', created_at: '2026-09-08T00:00:00Z' }]
  mocks.updates = []
  mocks.updateError = null
  mocks.rpc.mockResolvedValue({ data: null, error: null })
})
afterEach(() => vi.useRealTimers())

it('parks old unavailable lookups without refunding, dropping the receipt, or resubmitting', async () => {
  mocks.status.mockResolvedValue({ status: 'failed', queryFailed: true, queryUnavailable: true })
  expect(await reconcileMcpVideos()).toBe(0)
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(mocks.updates[0].values).toMatchObject({ status: 'uncertain' })
  expect(mocks.updates[0].values).not.toHaveProperty('task_id')
  expect(mocks.updates[0].filters).toEqual([['id', 'reservation'], ['status', 'submitted']])
})

it.each([
  { created_at: '2026-11-14T23:00:00Z', unavailable: true },
  { created_at: 'invalid-date', unavailable: true },
  { created_at: '2026-09-08T00:00:00Z', unavailable: false },
])('keeps fresh jobs and transport/auth failures retryable: %j', async ({ created_at, unavailable }) => {
  mocks.rows = [{ id: 'reservation', user_id: 'owner', task_id: 'task', created_at }]
  mocks.status.mockResolvedValue({ status: 'failed', queryFailed: true, queryUnavailable: unavailable })
  await reconcileMcpVideos()
  expect(mocks.updates[0].values).not.toHaveProperty('status')
  expect(mocks.rpc).not.toHaveBeenCalled()
})

it.each(['completed', 'failed'])('still settles confirmed provider status %s', async status => {
  mocks.status.mockResolvedValue({ status })
  expect(await reconcileMcpVideos()).toBe(1)
  expect(mocks.rpc).toHaveBeenCalledWith('settle_mcp_video', { p_user_id: 'owner', p_task_id: 'minimax-h3-old', p_failed: status === 'failed' })
  expect(mocks.updates[0].values).not.toHaveProperty('status')
})
