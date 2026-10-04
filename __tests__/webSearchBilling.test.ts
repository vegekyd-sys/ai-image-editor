import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockPricingSelect = vi.fn();
const mockUsageInsert = vi.fn();
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
      select: mockPricingSelect,
    };
  }
  if (table === 'usage_logs') return { insert: mockUsageInsert };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom, rpc: mockRpc }),
}));

describe('web search billing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: 100, error: null });
    mockUsageInsert.mockResolvedValue({ error: null });
    mockPricingSelect.mockResolvedValue({
      data: [{ tool_name: 'web_search', supplier_cost: 0.014, credits: 3, is_free: false }],
      error: null,
    });
    const { invalidateBillingCache } = await import('@/lib/billing/credits');
    const { invalidatePricingCache } = await import('@/lib/billing/pricing');
    invalidateBillingCache();
    invalidatePricingCache();
  });

  it('reads the configured price for each search transaction', async () => {
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
  it('rejects a missing search SKU instead of using a hidden fallback', async () => {
    mockPricingSelect.mockResolvedValue({ data: [], error: null });
    const { deductWebSearchCalls } = await import('@/lib/billing/credits');
    await expect(deductWebSearchCalls('user-1', 1, 'gpt-6-sol')).rejects.toThrow('not configured');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records Codex searches at zero credits without an API pricing lookup or deduction', async () => {
    const { deductWebSearchCalls } = await import('@/lib/billing/credits');
    await deductWebSearchCalls('owner', 2, 'gpt-6-luna', 'codex-subscription');
    expect(mockUsageInsert).toHaveBeenCalledTimes(2);
    expect(mockUsageInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'owner',
      tool_name: 'web_search',
      model_used: 'gpt-6-luna:codex-subscription',
      credits_charged: 0,
    }));
    expect(mockPricingSelect).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
