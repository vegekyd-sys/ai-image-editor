import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), insert: vi.fn(), scopes: [] as unknown[] }))
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  from: (table: string) => {
    if (table === 'app_settings') {
      const q = { select: () => q, eq: () => q, single: async () => ({ data: { value: 'true' }, error: null }) }
      return q
    }
    if (table === 'usage_logs') return { insert: h.insert }
    const q = { select: (fields: string) => { h.scopes.push(fields); return q },
      eq: (key: string, value: unknown) => { h.scopes.push([key, value]); return q }, order: h.read }
    return q
  }, rpc: h.rpc,
}) }))
import { getAllTokenRates, getTokenRate } from '@/lib/billing/token-rates'
import { deductByTokens, invalidateBillingCache } from '@/lib/billing/credits'

const rate = { model_id: 'google/gemini-nano-banana-2.1:text', display_name: 'Tips',
  input_per_1m: 1.5, output_per_1m: 7.5, markup: 2, is_active: true }

beforeEach(() => {
  vi.resetAllMocks(); h.scopes.length = 0; invalidateBillingCache()
  h.rpc.mockResolvedValue({ data: 99, error: null })
  h.insert.mockResolvedValue({ error: null })
})
afterEach(() => vi.useRealTimers())

describe('token pricing read recovery', () => {
  it('recovers a timed-out read before debiting exactly once at the authoritative rate', async () => {
    h.read.mockResolvedValueOnce({ data: null, error: { code: '57014' } })
      .mockResolvedValueOnce({ data: [rate], error: null })
    const result = await deductByTokens('user-1', 'tips', rate.model_id, 1000, 100)
    expect(result.charged).toBe(1)
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.scopes).toEqual(['*', ['is_active', true], '*', ['is_active', true]])
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('deduct_and_log', expect.objectContaining({ p_amount: 1, p_model_used: rate.model_id }))
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('bounds persistent transient reads and does not debit or log guessed usage', async () => {
    h.read.mockResolvedValue({ data: null, error: { code: '57014', message: 'private db details' } })
    await expect(deductByTokens('user-1', 'tips', rate.model_id, 1000, 100))
      .rejects.toMatchObject({ name: 'PricingUnavailableError', code: '57014', attempts: 2,
        message: 'Token pricing unavailable. Please retry.' })
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })

  it.each(['42501', '42P01', '42703', 'PGRST301'])('does not retry permanent error %s', async code => {
    h.read.mockResolvedValue({ data: null, error: { code, message: 'network policy denied' } })
    await expect(getAllTokenRates()).rejects.toMatchObject({ code, attempts: 1 })
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the read after a thrown network error', async () => {
    h.read.mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ data: [rate], error: null })
    expect(await getTokenRate(rate.model_id)).toEqual(rate)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('does not cache prior prices or retry an empty active catalog', async () => {
    h.read.mockResolvedValueOnce({ data: [rate], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    expect(await getTokenRate(rate.model_id)).toEqual(rate)
    expect(await getTokenRate(rate.model_id)).toBeNull()
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('does not retry an uncertain debit after a successful price read', async () => {
    h.read.mockResolvedValue({ data: [rate], error: null })
    h.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } })
    await expect(deductByTokens('user-1', 'tips', rate.model_id, 1000, 100)).rejects.toThrow()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })
})
