import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase before importing billing modules
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSupabaseAdmin = {
  from: mockFrom,
  rpc: mockRpc,
};

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => mockSupabaseAdmin,
}));

// Default: billing enabled for all tests
const billingSettingsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { value: 'true' }, error: null }),
};

// Helper to set up chain mocking for Supabase queries
function mockQuery(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockResolvedValue({ data: data ?? [], error }),
  };
  return chain;
}

// ─── token-rates.ts tests ───────────────────────────────────────

// Wrap mockFrom to always handle app_settings (billing enabled)
const originalMockFrom = mockFrom;
function setupBillingMock() {
  const prevImpl = originalMockFrom.getMockImplementation();
  mockFrom.mockImplementation((table: string) => {
    if (table === 'app_settings') return billingSettingsChain;
    if (prevImpl) return prevImpl(table);
    return mockQuery(null);
  });
}

describe('token-rates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupBillingMock();
  });

  it('tokensToCredits computes correctly for Opus', async () => {
    const { tokensToCredits } = await import('@/lib/billing/token-rates');
    const rate = {
      model_id: 'us.anthropic.claude-opus-4-6-v1',
      display_name: 'Claude Opus 4.6',
      input_per_1m: 15,
      output_per_1m: 75,
      markup: 2.0,
      is_active: true,
    };

    // 15K input + 1K output
    // Cost = (15000/1M * 15) + (1000/1M * 75) = 0.225 + 0.075 = 0.30
    // Credits = ceil(0.30 * 2.0 / 0.01) = ceil(60) = 60
    const credits = tokensToCredits(rate, 15000, 1000);
    expect(credits).toBe(60);
  });

  it('tokensToCredits computes correctly for Gemini Flash (cheap)', async () => {
    const { tokensToCredits } = await import('@/lib/billing/token-rates');
    const rate = {
      model_id: 'gemini-3.1-flash-image-preview',
      display_name: 'Gemini 3.1 Flash',
      input_per_1m: 0.10,
      output_per_1m: 0.40,
      markup: 2.0,
      is_active: true,
    };

    // 3K input + 1K output (typical tips call)
    // Cost = (3000/1M * 0.10) + (1000/1M * 0.40) = 0.0003 + 0.0004 = 0.0007
    // Credits = ceil(0.0007 * 2.0 / 0.01) = ceil(0.14) = 1
    const credits = tokensToCredits(rate, 3000, 1000);
    expect(credits).toBe(1);
  });

  it('tokensToCredits returns minimum 1 for non-zero usage', async () => {
    const { tokensToCredits } = await import('@/lib/billing/token-rates');
    const rate = {
      model_id: 'test',
      display_name: 'Test',
      input_per_1m: 0.01,
      output_per_1m: 0.01,
      markup: 1.0,
      is_active: true,
    };

    // Very tiny usage → cost rounds to 0, but should be minimum 1
    const credits = tokensToCredits(rate, 1, 1);
    expect(credits).toBe(1);
  });

  it('tokensToCredits returns 0 for zero tokens', async () => {
    const { tokensToCredits } = await import('@/lib/billing/token-rates');
    const rate = {
      model_id: 'test',
      display_name: 'Test',
      input_per_1m: 15,
      output_per_1m: 75,
      markup: 2.0,
      is_active: true,
    };

    const credits = tokensToCredits(rate, 0, 0);
    expect(credits).toBe(0);
  });

  it('tokensToCredits respects custom markup', async () => {
    const { tokensToCredits } = await import('@/lib/billing/token-rates');
    const rate = {
      model_id: 'test',
      display_name: 'Test',
      input_per_1m: 10,
      output_per_1m: 50,
      markup: 3.0, // 3x markup
      is_active: true,
    };

    // 10K input + 2K output
    // Cost = (10000/1M * 10) + (2000/1M * 50) = 0.1 + 0.1 = 0.2
    // Cost = (10000/1M * 10) + (2000/1M * 50) = 0.1 + 0.1 = 0.2
    // Credits = ceil(0.2 * 3.0 / 0.01) = ~60 (may be 60 or 61 due to fp)
    const credits = tokensToCredits(rate, 10000, 2000);
    expect(credits).toBeGreaterThanOrEqual(60);
    expect(credits).toBeLessThanOrEqual(61);
  });

  it('getTokenRate returns null for unknown model', async () => {
    const chain = mockQuery([]);
    mockFrom.mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: [], error: null });

    const { getTokenRate, invalidateTokenRateCache } = await import('@/lib/billing/token-rates');
    invalidateTokenRateCache();

    const rate = await getTokenRate('nonexistent-model');
    expect(rate).toBeNull();
  });

  it('getTokenRate finds exact match', async () => {
    const rates = [
      { model_id: 'us.anthropic.claude-opus-4-6-v1', display_name: 'Opus', input_per_1m: 15, output_per_1m: 75, markup: 2, is_active: true },
    ];
    const chain = mockQuery(rates);
    mockFrom.mockReturnValue(chain);
    chain.order = vi.fn().mockResolvedValue({ data: rates, error: null });

    const { getTokenRate, invalidateTokenRateCache } = await import('@/lib/billing/token-rates');
    invalidateTokenRateCache();

    const rate = await getTokenRate('us.anthropic.claude-opus-4-6-v1');
    expect(rate).not.toBeNull();
    expect(rate!.display_name).toBe('Opus');
  });
});

// ─── credits.ts tests ───────────────────────────────────────────

describe('credits', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupBillingMock();
  });

  describe('requireCredits', () => {
    it('returns ok when balance is sufficient', async () => {
      const chain = mockQuery({ balance: 100 });
      mockFrom.mockImplementation((t: string) => t === 'app_settings' ? billingSettingsChain : chain);

      const { requireCredits } = await import('@/lib/billing/credits');
      const result = await requireCredits('user-1', 5);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.balance).toBe(100);
      }
    });

    it('returns 402 response when balance is insufficient', async () => {
      const chain = mockQuery({ balance: 2 });
      mockFrom.mockImplementation((t: string) => t === 'app_settings' ? billingSettingsChain : chain);

      const { requireCredits } = await import('@/lib/billing/credits');
      const result = await requireCredits('user-1', 5);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.balance).toBe(2);
        expect(result.response.status).toBe(402);
        const body = await result.response.json();
        expect(body.error).toBe('insufficient_credits');
        expect(body.balance).toBe(2);
        expect(body.needed).toBe(5);
      }
    });

    it('treats missing balance as 0', async () => {
      const chain = mockQuery(null);
      mockFrom.mockImplementation((t: string) => t === 'app_settings' ? billingSettingsChain : chain);

      const { requireCredits } = await import('@/lib/billing/credits');
      const result = await requireCredits('user-1', 1);
      expect(result.ok).toBe(false);
    });
  });

  describe('deductByTokens', () => {
    it('uses fallback rate when no token rate found', async () => {
      const ratesChain = mockQuery([]);
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const usageChain = { insert: insertFn };

      mockRpc.mockResolvedValue({ data: 50, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'app_settings') return billingSettingsChain;
        if (table === 'token_rates') return ratesChain;
        if (table === 'usage_logs') return usageChain;
        return mockQuery(null);
      });
      ratesChain.order = vi.fn().mockResolvedValue({ data: [], error: null });

      const { deductByTokens } = await import('@/lib/billing/credits');
      const { invalidateTokenRateCache } = await import('@/lib/billing/token-rates');
      invalidateTokenRateCache();

      const result = await deductByTokens('user-1', 'agent', 'unknown-model', 1000, 500);
      // Fallback rate: $5/$25 per 1M, 2x markup
      // (1000/1M * 5 + 500/1M * 25) * 2 / 0.01 = (0.005 + 0.0125) * 2 / 0.01 = 3.5
      expect(result.charged).toBeGreaterThan(0);
      // Verify model logged as unknown:
      expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
        model_used: 'unknown:unknown-model',
      }));
    });

    it('deducts correct credits and logs usage with tokens', async () => {
      const rates = [
        { model_id: 'us.anthropic.claude-opus-4-6-v1', display_name: 'Opus', input_per_1m: 15, output_per_1m: 75, markup: 2, is_active: true },
      ];
      const ratesChain = mockQuery(rates);
      ratesChain.order = vi.fn().mockResolvedValue({ data: rates, error: null });

      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const usageChain = { insert: insertFn };

      mockRpc.mockResolvedValue({ data: 40, error: null }); // remaining = 40

      mockFrom.mockImplementation((table: string) => {
        if (table === 'app_settings') return billingSettingsChain;
        if (table === 'token_rates') return ratesChain;
        if (table === 'usage_logs') return usageChain;
        return mockQuery(null);
      });

      const { deductByTokens } = await import('@/lib/billing/credits');
      const { invalidateTokenRateCache } = await import('@/lib/billing/token-rates');
      invalidateTokenRateCache();

      // 15K input + 1K output on Opus = 60 credits (see tokensToCredits test above)
      const result = await deductByTokens('user-1', 'agent', 'us.anthropic.claude-opus-4-6-v1', 15000, 1000);
      expect(result.charged).toBe(60);
      expect(result.remaining).toBe(40);

      // Verify RPC was called with correct amount
      expect(mockRpc).toHaveBeenCalledWith('deduct_credits', {
        p_user_id: 'user-1',
        p_amount: 60,
      });

      // Verify usage_logs insert includes token data
      expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        tool_name: 'agent',
        model_used: 'us.anthropic.claude-opus-4-6-v1',
        credits_charged: 60,
        input_tokens: 15000,
        output_tokens: 1000,
        source: 'app',
      }));
    });
  });

  describe('deductCredits with null apiKeyId', () => {
    it('works for App users without API key', async () => {
      const insertFn = vi.fn().mockResolvedValue({ data: null, error: null });
      const usageChain = { insert: insertFn };

      // credit_pricing chain: getAllPricing() does from('credit_pricing').select('*')
      // select('*') must resolve directly (no .order() chaining)
      const pricingData = [{ tool_name: 'create_video', supplier_cost: 0.56, credits: 112, is_free: false }];
      const pricingChain = {
        select: vi.fn().mockResolvedValue({ data: pricingData, error: null }),
      };

      mockRpc.mockResolvedValue({ data: 888, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'app_settings') return billingSettingsChain;
        if (table === 'credit_pricing') return pricingChain;
        if (table === 'usage_logs') return usageChain;
        return mockQuery(null);
      });

      // Must invalidate pricing cache BEFORE importing credits
      // (since pricing.ts caches at module scope)
      const { invalidatePricingCache, getToolPrice } = await import('@/lib/billing/pricing');
      invalidatePricingCache();

      // Verify pricing lookup works with our mock
      const price = await getToolPrice('create_video');
      expect(price).not.toBeNull();
      expect(price!.credits).toBe(112);

      const { deductCredits } = await import('@/lib/billing/credits');

      const result = await deductCredits('user-1', null, 'create_video');
      expect(result.charged).toBe(112);
      expect(result.remaining).toBe(888);

      // Verify api_key_id is null in usage log
      expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
        api_key_id: null,
        source: 'app',
      }));
    });
  });

  describe('billing kill switch', () => {
    const billingDisabledChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { value: 'false' }, error: null }),
    };

    it('requireCredits passes when billing is off, even with 0 balance', async () => {
      const chain = mockQuery({ balance: 0 });
      mockFrom.mockImplementation((t: string) => t === 'app_settings' ? billingDisabledChain : chain);

      const { requireCredits } = await import('@/lib/billing/credits');
      const result = await requireCredits('user-1', 100);
      expect(result.ok).toBe(true);
    });

    it('deductByTokens returns 0 charged when billing is off', async () => {
      const rates = [
        { model_id: 'us.anthropic.claude-opus-4-6-v1', display_name: 'Opus', input_per_1m: 15, output_per_1m: 75, markup: 2, is_active: true },
      ];
      const ratesChain = mockQuery(rates);
      ratesChain.order = vi.fn().mockResolvedValue({ data: rates, error: null });

      mockFrom.mockImplementation((t: string) => {
        if (t === 'app_settings') return billingDisabledChain;
        if (t === 'token_rates') return ratesChain;
        return mockQuery(null);
      });

      const { deductByTokens } = await import('@/lib/billing/credits');
      const result = await deductByTokens('user-1', 'agent', 'us.anthropic.claude-opus-4-6-v1', 15000, 1000);
      expect(result.charged).toBe(0);
      expect(result.remaining).toBe(0);
      // RPC should NOT have been called
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('deductCredits returns 0 charged when billing is off', async () => {
      mockFrom.mockImplementation((t: string) => {
        if (t === 'app_settings') return billingDisabledChain;
        return mockQuery(null);
      });

      const { deductCredits } = await import('@/lib/billing/credits');
      const result = await deductCredits('user-1', null, 'create_video');
      expect(result.charged).toBe(0);
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });
});
