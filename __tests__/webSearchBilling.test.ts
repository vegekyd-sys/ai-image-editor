import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn((table: string) => {
  if (table === 'app_settings') {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { value: 'true' }, error: null }),
    };
  }
  if (table === 'credit_pricing') {
    return {
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom, rpc: mockRpc }),
}));

describe('web search billing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: 100, error: null });
    const { invalidateBillingCache } = await import('@/lib/billing/credits');
    const { invalidatePricingCache } = await import('@/lib/billing/pricing');
    invalidateBillingCache();
    invalidatePricingCache();
  });

  it('falls back to three credits per search transaction', async () => {
    const { getToolPrice } = await import('@/lib/billing/pricing');
    await expect(getToolPrice('web_search')).resolves.toEqual({ credits: 3, isFree: false });
  });

  it('charges the actual number of provider search calls', async () => {
    const { deductWebSearchCalls } = await import('@/lib/billing/credits');
    await deductWebSearchCalls('user-1', 2, 'gpt-5.6-terra');

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('deduct_and_log', expect.objectContaining({
      p_user_id: 'user-1',
      p_amount: 3,
      p_tool_name: 'web_search',
      p_model_used: 'gpt-5.6-terra',
    }));
  });
});
