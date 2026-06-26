import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockAddCredits = vi.fn();
const mockGetBalance = vi.fn();
const mockUpsertAppleSubscription = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
  }),
}));

vi.mock('@/lib/billing/credits', () => ({
  addCredits: mockAddCredits,
  getBalance: mockGetBalance,
}));

vi.mock('@/lib/billing/subscription', () => ({
  upsertAppleSubscription: mockUpsertAppleSubscription,
}));

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: '200000000000001',
    originalTransactionId: '200000000000001',
    productId: 'app.makaron.ios.topup.pro',
    purchaseDate: Date.now(),
    environment: 'Xcode',
    appAccountToken: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

describe('Apple billing integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'credit_purchases') return { insert: mockInsert };
      if (table === 'subscriptions') return { select: mockSelect };
      return { insert: mockInsert, select: mockSelect };
    });
    mockGetBalance.mockResolvedValue({ balance: 2200, lifetimePurchased: 2200, lifetimeUsed: 0 });
  });

  it('exposes all App Store products with Apple tier pricing isolated from Stripe pricing', async () => {
    const { getConfiguredAppleProducts } = await import('@/lib/billing/apple');
    const products = getConfiguredAppleProducts();

    expect(products).toHaveLength(11);
    expect(products.map(product => product.productId).sort()).toEqual([
      'app.makaron.ios.subscription.basic.annual',
      'app.makaron.ios.subscription.basic.monthly',
      'app.makaron.ios.subscription.business.annual',
      'app.makaron.ios.subscription.business.monthly',
      'app.makaron.ios.subscription.pro.annual',
      'app.makaron.ios.subscription.pro.monthly',
      'app.makaron.ios.topup.enterprise',
      'app.makaron.ios.topup.pro',
      'app.makaron.ios.topup.starter',
      'app.makaron.ios.topup.studio',
      'app.makaron.ios.topup.team',
    ]);
    expect(products.find(product => product.productId === 'app.makaron.ios.topup.pro')).toMatchObject({
      kind: 'topup',
      credits: 2200,
      price: 1999,
    });
    expect(products.find(product => product.productId === 'app.makaron.ios.subscription.pro.annual')).toMatchObject({
      kind: 'subscription',
      credits: 36000,
      price: 18999,
      interval: 'year',
    });
  });

  it('credits a consumable top-up exactly once', async () => {
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    const result = await applyAppleTransaction({
      userId: '11111111-1111-4111-8111-111111111111',
      transaction: transaction(),
      grantCredits: true,
    });

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'apple',
      source: 'topup',
      apple_transaction_id: '200000000000001',
      apple_product_id: 'app.makaron.ios.topup.pro',
      credits: 2200,
      amount_usd: 19.99,
    }));
    expect(mockAddCredits).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 2200);
    expect(result).toMatchObject({ purchaseType: 'topup', credited: true, credits: 2200 });
  });

  it('does not double-credit duplicate Apple transactions', async () => {
    mockInsert.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } });
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    const result = await applyAppleTransaction({
      userId: '11111111-1111-4111-8111-111111111111',
      transaction: transaction(),
      grantCredits: true,
    });

    expect(mockAddCredits).not.toHaveBeenCalled();
    expect(result).toMatchObject({ purchaseType: 'topup', credited: false, credits: 0 });
  });

  it('records annual subscriptions and grants annual credits', async () => {
    mockGetBalance.mockResolvedValue({ balance: 36000, lifetimePurchased: 36000, lifetimeUsed: 0 });
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    const result = await applyAppleTransaction({
      userId: '11111111-1111-4111-8111-111111111111',
      transaction: transaction({
        transactionId: '200000000000002',
        originalTransactionId: '200000000000002',
        productId: 'app.makaron.ios.subscription.pro.annual',
        expiresDate: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }),
      grantCredits: true,
    });

    expect(mockUpsertAppleSubscription).toHaveBeenCalledWith(expect.objectContaining({
      userId: '11111111-1111-4111-8111-111111111111',
      originalTransactionId: '200000000000002',
      transactionId: '200000000000002',
      productId: 'app.makaron.ios.subscription.pro.annual',
      planId: 'pro',
      billingInterval: 'year',
      status: 'active',
      appAccountToken: '11111111-1111-4111-8111-111111111111',
      environment: 'Xcode',
    }));
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'apple',
      source: 'subscription',
      apple_product_id: 'app.makaron.ios.subscription.pro.annual',
      credits: 36000,
      amount_usd: 189.99,
    }));
    expect(mockAddCredits).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 36000);
    expect(result).toMatchObject({ purchaseType: 'subscription', credited: true, credits: 36000 });
  });

  it('rejects a transaction whose appAccountToken belongs to a different user', async () => {
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    await expect(applyAppleTransaction({
      userId: '22222222-2222-4222-8222-222222222222',
      transaction: transaction(),
      grantCredits: true,
    })).rejects.toThrow('account token does not match');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockAddCredits).not.toHaveBeenCalled();
  });
});
