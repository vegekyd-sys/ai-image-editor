import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreditPopup from '@/components/CreditPopup';
import { LocaleProvider } from '@/lib/i18n';
import { translate, type Locale } from '@/lib/locales';

const state = vi.hoisted(() => ({ loading: false, error: null as string | null }));
vi.mock('@/lib/native-app', () => ({ shouldSuppressWebBilling: () => true }));
vi.mock('@/lib/billing/use-apple-billing', () => ({
  useAppleBillingProducts: () => ({
    available: true, loading: state.loading, error: state.error,
    findSubscription: (planId: string, interval: string) => ({ kind: 'subscription', planId, interval, introTrial: planId === 'basic' && interval === 'month' ? { days: 3, credits: 1500 } : undefined }),
    findTopup: (tierId: string) => ({ kind: 'topup', tierId }),
    nativeProductFor: (product: { planId?: string; interval?: string }) => state.loading || state.error ? undefined : ({
      displayPrice: product.interval === 'year' ? 'US$94.99' : 'US$9.99',
      isEligibleForIntroOffer: product.planId === 'basic',
      introductoryOffer: { paymentMode: 'freeTrial', periodUnit: 'day', periodValue: 3, periodCount: 1 },
    }),
  }),
}));
vi.mock('@/lib/native-purchases', () => ({
  finishNativeAppleTransaction: vi.fn(), purchaseNativeAppleProduct: vi.fn(), purchaseNativeAppleSubscription: vi.fn(),
  restoreNativeApplePurchases: vi.fn(), isNativeApplePurchaseCancellation: () => false,
  getNativeApplePurchaseErrorMessage: (_: unknown, fallback: string) => fallback,
}));

function open(locale: Locale) {
  localStorage.setItem('locale', locale);
  return render(<LocaleProvider initialLocale={locale}><CreditPopup open watermarkUnlock balance={323} onClose={vi.fn()} /></LocaleProvider>);
}

describe('localized purchase presentation', () => {
  beforeEach(() => {state.loading = false;state.error = null;localStorage.clear();});
  afterEach(() => {cleanup();localStorage.clear();});

  it.each<Locale>(['zh', 'zh-Hant', 'ja', 'en'])('localizes subscription, annual and all top-up options in %s', async locale => {
    open(locale);
    expect(screen.getByText(translate(locale, 'billing.balanceAmount', '323'))).toBeTruthy();
    expect(screen.getByRole('button', { name: translate(locale, 'billing.monthly') })).toBeTruthy();
    expect(screen.getByText(translate(locale, 'billing.plan.basic'))).toBeTruthy();
    expect(screen.getByText(translate(locale, 'billing.appleTrialBadge'))).toBeTruthy();
    expect(screen.queryByTestId('apple-billing-banner')).toBeNull();
    expect(screen.queryByText('Apple In-App Purchase')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: translate(locale, 'billing.annual') })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: translate(locale, 'billing.annual') }));
    expect(screen.getByRole('button', { name: translate(locale, 'billing.annual') }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByText(new RegExp(translate(locale, 'billing.creditsPerYear'))).length).toBe(3);
    expect(screen.getByRole('button', { name: translate(locale, 'billing.subscribePrice', 'US$94.99') })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: translate(locale, 'billing.topUp') }));
    expect(document.querySelectorAll('.credit-pack').length).toBe(5);
    expect(screen.getByText(translate(locale, 'billing.topUpDescription'))).toBeTruthy();
    expect(screen.getByRole('button', { name: translate(locale, 'billing.restorePurchases') })).toBeTruthy();
    const packs = document.querySelectorAll('.credit-pack');
    fireEvent.click(packs[4]);
    expect(packs[4].getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.credit-pack[aria-pressed=true]').length).toBe(1);
    if (locale !== 'en') expect(document.querySelector('.credit-purchase')?.textContent).not.toMatch(/Monthly|Annual|Balance:|credits|Unavailable|Restore Apple/i);
  });

  it('keeps loading and price errors localized and purchase controls disabled', async () => {
    state.loading = true;open('zh');
    expect(document.querySelector('.credit-purchase-primary')?.textContent).toBe(translate('zh', 'billing.loadingPrices'));
    expect(document.querySelector('.credit-purchase-primary')?.hasAttribute('disabled')).toBe(true);
    cleanup();state.loading = false;state.error = 'English provider error';open('zh');
    expect(screen.getByRole('alert').textContent).toBe(translate('zh', 'billing.pricesUnavailable'));
    expect(screen.queryByText('English provider error')).toBeNull();
    expect(document.querySelector('.credit-purchase-primary')?.hasAttribute('disabled')).toBe(true);
  });
});
