import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreditPopup from '@/components/CreditPopup';

const mocks = vi.hoisted(() => ({
  getNativeAppleProducts: vi.fn(),
  purchaseNativeAppleProduct: vi.fn(),
  purchaseNativeAppleSubscription: vi.fn(),
  finishNativeAppleTransaction: vi.fn(),
  restoreNativeApplePurchases: vi.fn(),
  writeNativeJSONCache: vi.fn(),
  trackCheckoutStart: vi.fn(),
  suppressWebBilling: false,
}));

vi.mock('@/lib/i18n', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'billing.getMoreCredits': 'Get more credits',
      'billing.topUp': 'Top Up',
      'billing.credits': 'credits',
      'billing.creditsPerMonth': 'credits/month',
      'billing.perMonth': '/mo',
      'billing.subscribeTo': 'Subscribe to',
      'billing.upgradeTo': 'Upgrade to',
      'billing.current': 'Current',
      'billing.close': 'Close',
      'billing.processingPayment': 'Processing payment',
      'billing.usuallyFewSeconds': 'Usually takes a few seconds',
      'billing.creditsAdded': 'Credits added',
      'billing.balanceUpdated': 'Balance updated',
      'billing.creditsAvailable': 'credits available',
      'billing.continueCreating': 'Continue creating',
      'billing.paymentPending': 'Payment pending',
      'billing.paymentPendingDesc': 'Payment is still being processed',
      'billing.iosUnavailableTitle': 'Purchases unavailable',
      'billing.iosUnavailableDesc': 'Purchases are unavailable',
      'billing.appleTrialBadge': '3-day free trial',
      'billing.appleTrialToday': 'Free today',
      'billing.appleTrialThen': 'then',
      'billing.appleTrialCredits': 'trial credits',
      'billing.appleTrialStart': 'Start 3-day free trial',
      'billing.appleTrialDisclosure': 'Free today, auto-renews in 3 days at',
      'billing.trial.loadingOffer': 'Checking your Apple offer...',
      'billing.trial.firstCreationComplete': '3-DAY FREE TRIAL',
      'billing.trial.nextSkillTitle': 'Create without limits.',
      'billing.trial.nextSkillSubtitle': 'Start with 1,500 trial credits.',
      'billing.trial.galleryLabel': 'What you can create',
      'billing.trial.offerTitle': '3-day free trial',
      'billing.trial.offerRenewalPrefix': 'then',
      'billing.trial.offerToday': '$0 today',
      'billing.trial.close': 'Close trial offer',
      'billing.trial.creation1': 'Selfie to poster',
      'billing.trial.creation2': 'Image to video',
      'billing.trial.creation3': 'Creative Agent',
      'billing.trial.creationAlt1': 'Selfie poster',
      'billing.trial.creationAlt2': 'Image video',
      'billing.trial.creationAlt3': 'Agent variations',
      'billing.trial.benefitCredits': '1,500 credits during your trial',
      'billing.trial.benefitSkills': 'Every image and video Skill',
      'billing.trial.benefitAgent': 'Your creative Agent',
      'billing.trial.perMonth': '/month',
      'billing.trial.cta': 'Start 3-day free trial',
      'billing.trial.confirming': 'Confirming with Apple...',
      'billing.trial.legal': 'Renews automatically unless canceled.',
      'billing.trial.restore': 'Restore Apple purchase',
      'billing.trial.restoring': 'Restoring...',
      'billing.trial.verificationPending': 'Subscription complete. Tap Restore Apple purchase to continue.',
    }[key] || key),
  }),
}));

vi.mock('@/lib/native-app', () => ({
  shouldSuppressWebBilling: () => mocks.suppressWebBilling,
}));

vi.mock('@/lib/native-app-cache', () => ({
  writeNativeJSONCache: mocks.writeNativeJSONCache,
}));

vi.mock('@/lib/marketing/attribution', () => ({
  getAttributionForRequest: () => ({}),
}));

vi.mock('@/lib/marketing/meta-pixel', () => ({
  trackCheckoutStart: mocks.trackCheckoutStart,
  trackCheckoutSuccessFromUrl: vi.fn(),
}));

vi.mock('@/lib/native-purchases', () => ({
  isNativeApplePurchaseAvailable: () => true,
  getNativeAppleProducts: mocks.getNativeAppleProducts,
  purchaseNativeAppleProduct: mocks.purchaseNativeAppleProduct,
  purchaseNativeAppleSubscription: mocks.purchaseNativeAppleSubscription,
  finishNativeAppleTransaction: mocks.finishNativeAppleTransaction,
  restoreNativeApplePurchases: mocks.restoreNativeApplePurchases,
  isNativeApplePurchaseCancellation: () => false,
  getNativeApplePurchaseErrorMessage: (error: unknown, fallback: string) => (
    error instanceof Error ? error.message : fallback
  ),
}));

const appleProducts = [
  { kind: 'subscription', planId: 'basic', name: 'Basic', interval: 'month', productId: 'app.makaron.ios.subscription.basic.monthly', credits: 1200, price: 999, introTrial: { days: 3, credits: 1500 } },
  { kind: 'subscription', planId: 'basic', name: 'Basic', interval: 'year', productId: 'app.makaron.ios.subscription.basic.annual', credits: 14400, price: 9499 },
  { kind: 'subscription', planId: 'pro', name: 'Pro', interval: 'month', productId: 'app.makaron.ios.subscription.pro.monthly', credits: 3000, price: 1999 },
  { kind: 'subscription', planId: 'pro', name: 'Pro', interval: 'year', productId: 'app.makaron.ios.subscription.pro.annual', credits: 36000, price: 18999 },
  { kind: 'topup', tierId: 'pro', name: 'Pro', productId: 'app.makaron.ios.topup.pro', credits: 2200, price: 1999 },
];

const nativeProducts = appleProducts.map(product => ({
  productId: product.productId,
  displayName: product.name,
  description: product.name,
  displayPrice: product.productId.includes('annual') ? '$189.99' : product.productId.includes('topup') ? '$19.99' : '$19.99',
  type: product.kind,
}));

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/billing/apple/products') {
      return {
        ok: true,
        json: async () => ({ appAccountToken: '11111111-1111-4111-8111-111111111111', products: appleProducts }),
      } as Response;
    }
    if (url === '/api/billing/apple/verify') {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.intent === 'preauth_trial') {
        return {
          ok: true,
          json: async () => ({ ok: true, pendingClaim: true }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          purchaseType: 'subscription',
          credited: true,
          credits: 36000,
          balance: 36120,
          subscription: { provider: 'apple', planId: 'pro', status: 'active', billingInterval: 'year' },
        }),
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('CreditPopup Apple purchase flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.suppressWebBilling = false;
    mocks.getNativeAppleProducts.mockResolvedValue(nativeProducts);
    mocks.purchaseNativeAppleProduct.mockResolvedValue({
      productId: 'app.makaron.ios.topup.pro',
      transactionId: 'topup-tx',
      originalTransactionId: 'topup-tx',
      signedTransactionInfo: 'signed-topup',
    });
    mocks.purchaseNativeAppleSubscription.mockResolvedValue({
      productId: 'app.makaron.ios.subscription.pro.annual',
      transactionId: 'sub-tx',
      originalTransactionId: 'sub-tx',
      signedTransactionInfo: 'signed-sub',
    });
    mocks.finishNativeAppleTransaction.mockResolvedValue(undefined);
    mocks.trackCheckoutStart.mockReturnValue('meta-event-id');
    vi.stubGlobal('fetch', mockFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('buys the selected annual subscription through Apple and verifies it server-side', async () => {
    const onBalanceUpdate = vi.fn();
    render(<CreditPopup open onClose={vi.fn()} balance={120} subscription={null} onBalanceUpdate={onBalanceUpdate} />);

    await waitFor(() => expect(mocks.getNativeAppleProducts).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Upgrade'));
    fireEvent.click(screen.getByText('Annual'));
    fireEvent.click(screen.getByText('Pro'));
    fireEvent.click(await screen.findByText('Subscribe · $189.99'));

    await waitFor(() => expect(mocks.purchaseNativeAppleSubscription).toHaveBeenCalledWith(
      'app.makaron.ios.subscription.pro.annual',
      '11111111-1111-4111-8111-111111111111',
    ));
    expect(fetch).toHaveBeenCalledWith('/api/billing/apple/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ signedTransactionInfo: 'signed-sub', metaEventId: 'meta-event-id', attribution: {} }),
    }));
    expect(mocks.trackCheckoutStart).toHaveBeenCalledWith('subscription', {
      content_name: 'pro',
      content_id: 'app.makaron.ios.subscription.pro.annual',
      billing_interval: 'year',
      value: 189.99,
      currency: 'USD',
    });
    await waitFor(() => expect(mocks.finishNativeAppleTransaction).toHaveBeenCalledWith('sub-tx'));
    expect(mocks.writeNativeJSONCache).toHaveBeenCalledWith('/api/billing/credits', expect.objectContaining({ balance: 36120 }));
    expect(onBalanceUpdate).toHaveBeenCalledWith(36120, expect.objectContaining({ provider: 'apple', planId: 'pro' }));
  });

  it('buys a consumable credit top-up through Apple and verifies it server-side', async () => {
    render(<CreditPopup open onClose={vi.fn()} balance={120} subscription={null} />);

    await waitFor(() => expect(mocks.getNativeAppleProducts).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Top Up 2,200 credits'));

    await waitFor(() => expect(mocks.purchaseNativeAppleProduct).toHaveBeenCalledWith(
      'app.makaron.ios.topup.pro',
      '11111111-1111-4111-8111-111111111111',
    ));
    expect(fetch).toHaveBeenCalledWith('/api/billing/apple/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ signedTransactionInfo: 'signed-topup', metaEventId: 'meta-event-id', attribution: {} }),
    }));
    expect(mocks.trackCheckoutStart).toHaveBeenCalledWith('topup', {
      content_name: 'pro',
      content_id: 'app.makaron.ios.topup.pro',
      value: 19.99,
      currency: 'USD',
    });
    await waitFor(() => expect(mocks.finishNativeAppleTransaction).toHaveBeenCalledWith('topup-tx'));
  });

  it('leads iOS onboarding with the verified 3-day Basic trial and 1,500 credits', async () => {
    mocks.suppressWebBilling = true;
    mocks.getNativeAppleProducts.mockResolvedValue(nativeProducts.map(product => (
      product.productId === 'app.makaron.ios.subscription.basic.monthly'
        ? {
            ...product,
            displayPrice: '$9.99',
            isEligibleForIntroOffer: true,
            introductoryOffer: {
              displayPrice: '$0.00',
              paymentMode: 'freeTrial',
              periodUnit: 'day',
              periodValue: 3,
              periodCount: 1,
            },
          }
        : product
    )));
    mocks.purchaseNativeAppleSubscription.mockResolvedValue({
      productId: 'app.makaron.ios.subscription.basic.monthly',
      transactionId: 'trial-tx',
      originalTransactionId: 'trial-tx',
      signedTransactionInfo: 'signed-trial',
    });

    render(<CreditPopup open entryPoint="ios_onboarding" onClose={vi.fn()} balance={0} subscription={null} />);

    expect(await screen.findByText('3-day free trial')).toBeTruthy();
    expect(screen.getByText('$0 today')).toBeTruthy();
    expect(screen.getByText('then $9.99/month')).toBeTruthy();
    expect(screen.getByText('1,500 credits during your trial')).toBeTruthy();

    fireEvent.click(screen.getByText('Start 3-day free trial'));
    await waitFor(() => expect(mocks.purchaseNativeAppleSubscription).toHaveBeenCalledWith(
      'app.makaron.ios.subscription.basic.monthly',
      '11111111-1111-4111-8111-111111111111',
    ));
  });

  it('holds an unauthenticated Apple trial server-side before navigating to registration', async () => {
    mocks.suppressWebBilling = true;
    mocks.getNativeAppleProducts.mockResolvedValue(nativeProducts.map(product => (
      product.productId === 'app.makaron.ios.subscription.basic.monthly'
        ? {
            ...product,
            displayPrice: '$9.99',
            isEligibleForIntroOffer: true,
            introductoryOffer: {
              displayPrice: '$0.00',
              paymentMode: 'freeTrial',
              periodUnit: 'day',
              periodValue: 3,
              periodCount: 1,
            },
          }
        : product
    )));
    mocks.purchaseNativeAppleSubscription.mockResolvedValue({
      productId: 'app.makaron.ios.subscription.basic.monthly',
      transactionId: 'preauth-trial-tx',
      originalTransactionId: 'preauth-trial-tx',
      signedTransactionInfo: 'signed-preauth-trial',
    });
    const onPreAuthTrialConfirmed = vi.fn();

    render(
      <CreditPopup
        open
        entryPoint="ios_preauth_trial"
        onClose={vi.fn()}
        onPreAuthTrialConfirmed={onPreAuthTrialConfirmed}
        balance={0}
        subscription={null}
      />,
    );

    fireEvent.click(await screen.findByText('Start 3-day free trial'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/billing/apple/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        signedTransactionInfo: 'signed-preauth-trial',
        metaEventId: 'meta-event-id',
        attribution: {},
        intent: 'preauth_trial',
      }),
    })));
    await waitFor(() => expect(mocks.finishNativeAppleTransaction).toHaveBeenCalledWith('preauth-trial-tx'));
    expect(onPreAuthTrialConfirmed).toHaveBeenCalledTimes(1);
    expect(mocks.writeNativeJSONCache).not.toHaveBeenCalled();
  });

  it('shows a recovery action instead of exposing server verification details', async () => {
    mocks.suppressWebBilling = true;
    mocks.getNativeAppleProducts.mockResolvedValue(nativeProducts.map(product => (
      product.productId === 'app.makaron.ios.subscription.basic.monthly'
        ? {
            ...product,
            displayPrice: '$9.99',
            isEligibleForIntroOffer: true,
            introductoryOffer: {
              displayPrice: '$0.00',
              paymentMode: 'freeTrial',
              periodUnit: 'day',
              periodValue: 3,
              periodCount: 1,
            },
          }
        : product
    )));
    const baseFetch = mockFetch();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/billing/apple/verify') {
        return {
          ok: false,
          json: async () => ({
            code: 'APPLE_TRIAL_VERIFICATION_FAILED',
            error: 'private server configuration detail',
          }),
        } as Response;
      }
      return baseFetch(input, init);
    }));

    render(<CreditPopup open entryPoint="ios_preauth_trial" onClose={vi.fn()} balance={0} subscription={null} />);
    fireEvent.click(await screen.findByText('Start 3-day free trial'));

    expect(await screen.findByText('Subscription complete. Tap Restore Apple purchase to continue.')).toBeTruthy();
    expect(screen.queryByText('private server configuration detail')).toBeNull();
    expect(mocks.finishNativeAppleTransaction).not.toHaveBeenCalled();
  });
});
