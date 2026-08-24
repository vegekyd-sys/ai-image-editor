import { beforeEach, describe, expect, it, vi } from 'vitest';
import { X509Certificate } from 'node:crypto';

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockAddCredits = vi.fn();
const mockGetBalance = vi.fn();
const mockUpsertAppleSubscription = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({
    from: mockFrom,
    rpc: mockRpc,
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
    mockRpc.mockResolvedValue({ data: { granted: true, processed: true }, error: null });
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

  it('bundles the three official Apple root certificates for JWS verification', async () => {
    const { getBundledAppleRootCertificates } = await import('@/lib/billing/apple-root-certificates');
    const certificates = getBundledAppleRootCertificates().map(value => new X509Certificate(value));

    expect(certificates).toHaveLength(3);
    expect(certificates.map(certificate => certificate.subject)).toEqual(expect.arrayContaining([
      expect.stringContaining('CN=Apple Root CA'),
      expect.stringContaining('CN=Apple Root CA - G2'),
      expect.stringContaining('CN=Apple Root CA - G3'),
    ]));
    expect(certificates.every(certificate => certificate.ca)).toBe(true);
  });

  it('allows unsigned Xcode payload decoding only against an isolated loopback E2E Supabase', async () => {
    const { assertAppleIAPEnvironmentIsolation } = await import('@/lib/billing/apple');

    expect(() => assertAppleIAPEnvironmentIsolation(['Xcode'] as never, {
      MAKARON_E2E: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
    } as unknown as NodeJS.ProcessEnv)).not.toThrow();

    expect(() => assertAppleIAPEnvironmentIsolation(['Xcode'] as never, {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
    } as unknown as NodeJS.ProcessEnv)).toThrow('MAKARON_E2E=1');

    expect(() => assertAppleIAPEnvironmentIsolation(['Xcode'] as never, {
      MAKARON_E2E: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://shared-project.supabase.co',
    } as unknown as NodeJS.ProcessEnv)).toThrow('loopback-only Supabase');

    expect(() => assertAppleIAPEnvironmentIsolation(['Xcode', 'Sandbox'] as never, {
      MAKARON_E2E: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:55321',
    } as unknown as NodeJS.ProcessEnv)).toThrow('cannot be combined');
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

    expect(mockRpc).toHaveBeenCalledWith('grant_apple_credits_and_record_purchase', expect.objectContaining({
      p_source: 'topup',
      p_transaction_id: '200000000000001',
      p_product_id: 'app.makaron.ios.topup.pro',
      p_credits: 2200,
      p_amount_usd: 19.99,
    }));
    expect(result).toMatchObject({
      purchaseType: 'topup',
      credited: true,
      credits: 2200,
      amountUsd: 19.99,
      productId: 'app.makaron.ios.topup.pro',
      transactionId: '200000000000001',
      tierId: 'pro',
    });
  });

  it('does not double-credit duplicate Apple transactions', async () => {
    mockRpc.mockResolvedValueOnce({ data: { granted: false, processed: false }, error: null });
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    const result = await applyAppleTransaction({
      userId: '11111111-1111-4111-8111-111111111111',
      transaction: transaction(),
      grantCredits: true,
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
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
    expect(mockRpc).toHaveBeenCalledWith('grant_apple_credits_and_record_purchase', expect.objectContaining({
      p_source: 'subscription_annual',
      p_product_id: 'app.makaron.ios.subscription.pro.annual',
      p_credits: 36000,
      p_amount_usd: 189.99,
    }));
    expect(result).toMatchObject({
      purchaseType: 'subscription',
      credited: true,
      credits: 36000,
      amountUsd: 189.99,
      productId: 'app.makaron.ios.subscription.pro.annual',
      transactionId: '200000000000002',
      planId: 'pro',
      billingInterval: 'year',
    });
  });

  it('grants the configured 1,500-credit Basic introductory trial once', async () => {
    mockSingle.mockResolvedValueOnce({ data: { value: '1500' }, error: null });
    mockGetBalance.mockResolvedValue({ balance: 1500, lifetimePurchased: 0, lifetimeUsed: 0 });
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    const expiresDate = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const result = await applyAppleTransaction({
      userId: '11111111-1111-4111-8111-111111111111',
      transaction: transaction({
        transactionId: '200000000000003',
        originalTransactionId: '200000000000003',
        productId: 'app.makaron.ios.subscription.basic.monthly',
        offerType: 1,
        expiresDate,
      }),
      grantCredits: true,
    });

    expect(mockUpsertAppleSubscription).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'basic',
      billingInterval: 'month',
      status: 'trialing',
    }));
    expect(mockRpc).toHaveBeenCalledWith('grant_apple_credits_and_record_purchase', expect.objectContaining({
      p_source: 'trial',
      p_credits: 1500,
      p_amount_usd: 0,
      p_trial_expires_at: new Date(expiresDate).toISOString(),
    }));
    expect(result).toMatchObject({
      credited: true,
      credits: 1500,
      amountUsd: 0,
      planId: 'basic',
      billingInterval: 'month',
    });
  });

  it('keeps an accelerated Sandbox trial claim usable for three product days after signup', async () => {
    mockSingle.mockResolvedValueOnce({ data: { value: '1500' }, error: null });
    mockGetBalance.mockResolvedValue({ balance: 1500, lifetimePurchased: 0, lifetimeUsed: 0 });
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    const productExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const result = await applyAppleTransaction({
      userId: '11111111-1111-4111-8111-111111111111',
      transaction: transaction({
        transactionId: 'sandbox-expired-trial',
        originalTransactionId: 'sandbox-expired-trial',
        productId: 'app.makaron.ios.subscription.basic.monthly',
        offerType: 1,
        expiresDate: Date.now() - 20_000,
        environment: 'Sandbox',
      }),
      grantCredits: true,
      introTrialExpiresAtOverride: productExpiry,
    });

    expect(mockUpsertAppleSubscription).toHaveBeenCalledWith(expect.objectContaining({
      status: 'trialing',
      currentPeriodEnd: productExpiry,
    }));
    expect(mockRpc).toHaveBeenCalledWith('grant_apple_credits_and_record_purchase', expect.objectContaining({
      p_source: 'trial',
      p_credits: 1500,
      p_trial_expires_at: productExpiry.toISOString(),
    }));
    expect(result).toMatchObject({ credited: true, credits: 1500 });
  });

  it('accepts only an active Basic monthly introductory offer before registration', async () => {
    const { requireAppleBasicIntroTrial } = await import('@/lib/billing/apple');
    const expiresDate = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const pending = requireAppleBasicIntroTrial(transaction({
      appAccountToken: undefined,
      transactionId: 'preauth-trial',
      originalTransactionId: 'preauth-trial',
      productId: 'app.makaron.ios.subscription.basic.monthly',
      offerType: 1,
      expiresDate,
    }));

    expect(pending).toMatchObject({
      productId: 'app.makaron.ios.subscription.basic.monthly',
      transactionId: 'preauth-trial',
      originalTransactionId: 'preauth-trial',
    });
    expect(pending.expiresAt.toISOString()).toBe(new Date(expiresDate).toISOString());

    expect(() => requireAppleBasicIntroTrial(transaction({
      appAccountToken: undefined,
      productId: 'app.makaron.ios.subscription.basic.monthly',
      expiresDate,
      offerType: undefined,
    }))).toThrow('introductory trial');
  });

  it('rejects a transaction whose appAccountToken belongs to a different user', async () => {
    const { applyAppleTransaction } = await import('@/lib/billing/apple');
    await expect(applyAppleTransaction({
      userId: '22222222-2222-4222-8222-222222222222',
      transaction: transaction(),
      grantCredits: true,
    })).rejects.toThrow('account token does not match');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
