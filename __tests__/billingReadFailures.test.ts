import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => mock }))
beforeEach(() => { vi.resetModules(); vi.resetAllMocks() })

it('never treats a settings outage as billing disabled', async () => {
  const single = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'offline' } }).mockResolvedValueOnce({ data: { value: 'true' }, error: null })
  mock.from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) })
  const { isBillingEnabled } = await import('@/lib/billing/credits')
  await expect(isBillingEnabled()).rejects.toThrow('unavailable')
  expect(await isBillingEnabled()).toBe(true)
})
it('rejects a tool table read failure without caching an empty price list', async () => {
  const select = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    .mockResolvedValueOnce({ data: [{ tool_name: 'rotate_camera', credits: 2, is_free: false }], error: null })
  mock.from.mockReturnValue({ select })
  const { getToolPrice } = await import('@/lib/billing/pricing')
  await expect(getToolPrice('rotate_camera')).rejects.toThrow('unavailable')
  expect(await getToolPrice('rotate_camera')).toEqual({ credits: 2, isFree: false })
})
it('rejects unknown tool preflight instead of implicitly granting free access', async () => {
  mock.from.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })
  const { checkBalance } = await import('@/lib/billing/credits')
  await expect(checkBalance('user', 'forgotten-tool')).rejects.toThrow('not configured')
  expect(mock.rpc).not.toHaveBeenCalled()
})
it('reads the merged Gemini 3.8 price from the database without a hidden default', async () => {
  const rate = { model_id: 'gemini-3.8-flash', display_name: 'Gemini 3.8 Flash', input_per_1m: 0.75, output_per_1m: 3.75, markup: 2, is_active: true }
  const order = vi.fn().mockResolvedValueOnce({ data: [rate], error: null })
    .mockResolvedValueOnce({ data: [], error: null })
  mock.from.mockReturnValue({ select: () => ({ eq: () => ({ order }) }) })
  const { getTokenRate, tokensToCredits } = await import('@/lib/billing/token-rates')
  expect(await getTokenRate('gemini-3.8-flash')).toEqual(rate)
  expect(tokensToCredits(rate, 1000, 1000)).toBe(1)
  expect(await getTokenRate('gemini-3.8-flash')).toBeNull()
})
