'use client';

import { useState, useEffect, useRef } from 'react';
import { CREDIT_TIERS } from '@/lib/billing/tiers';
import { useLocale } from '@/lib/i18n';
import { shouldSuppressWebBilling } from '@/lib/native-app';
import { writeNativeJSONCache } from '@/lib/native-app-cache';
import { getAttributionForRequest } from '@/lib/marketing/attribution';
import { trackCheckoutStart, trackCheckoutSuccessFromUrl } from '@/lib/marketing/meta-pixel';
import {
  finishNativeAppleTransaction,
  getNativeAppleProducts,
  isNativeApplePurchaseAvailable,
  purchaseNativeAppleProduct,
  purchaseNativeAppleSubscription,
  restoreNativeApplePurchases,
  type NativeAppleProduct,
} from '@/lib/native-purchases';

const PLANS = [
  { id: 'basic', name: 'Basic', monthlyPrice: 990, annualPrice: 9500, credits: 1200 },
  { id: 'pro', name: 'Pro', monthlyPrice: 1990, annualPrice: 19100, credits: 3000 },
  { id: 'business', name: 'Business', monthlyPrice: 4990, annualPrice: 47900, credits: 10000 },
] as const;

interface AppleBillingProduct {
  kind: 'subscription' | 'topup';
  planId?: string;
  tierId?: string;
  name: string;
  interval?: 'month' | 'year';
  productId: string;
  credits: number;
  price: number;
}

interface CreditPopupProps {
  open: boolean;
  onClose: () => void;
  balance: number;
  needed?: number;
  subscription?: { planId: string; status: string } | null;
  projectId?: string;
  /** Show success celebration screen (with fireworks) */
  success?: boolean;
  /** Waiting for payment webhook — show loading state */
  waiting?: boolean;
  /** Auto-detect ?topped_up=1 in URL, poll for credits, show waiting→success */
  autoDetectPayment?: boolean;
  /** Called when balance updates after successful payment */
  onBalanceUpdate?: (balance: number, subscription?: { planId: string; status: string } | null) => void;
}

export default function CreditPopup({ open: externalOpen, onClose: externalOnClose, balance: externalBalance, needed, subscription: externalSubscription, projectId, success: externalSuccess, waiting: externalWaiting, autoDetectPayment, onBalanceUpdate }: CreditPopupProps) {
  const { t } = useLocale();
  const [loading, setLoading] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('pro');
  const [selectedPlan, setSelectedPlan] = useState<string>('basic');
  const [selectedBillingInterval, setSelectedBillingInterval] = useState<'month' | 'year'>('month');
  const [animatedBalance, setAnimatedBalance] = useState(0);
  const [appleBillingAvailable, setAppleBillingAvailable] = useState(false);
  const [appleProducts, setAppleProducts] = useState<AppleBillingProduct[]>([]);
  const [nativeAppleProducts, setNativeAppleProducts] = useState<Record<string, NativeAppleProduct>>({});
  const [appAccountToken, setAppAccountToken] = useState<string | undefined>();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const animatingRef = useRef(false);

  // Auto-detect payment state (self-managed when autoDetectPayment=true)
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoWaiting, setAutoWaiting] = useState(false);
  const [autoSuccess, setAutoSuccess] = useState(false);
  const [autoBalance, setAutoBalance] = useState(0);
  const [autoSubscription, setAutoSubscription] = useState<{ planId: string; status: string } | null>(null);

  const open = autoOpen || externalOpen;
  const waiting = autoWaiting || (externalWaiting ?? false);
  const success = autoSuccess || (externalSuccess ?? false);
  const balance = autoSuccess ? autoBalance : externalBalance;
  const subscription = autoSubscription || externalSubscription;
  const suppressWebBilling = shouldSuppressWebBilling();

  const onClose = () => {
    setAutoOpen(false);
    setAutoWaiting(false);
    setAutoSuccess(false);
    externalOnClose();
  };

  // Auto-detect ?topped_up=1 after Stripe redirect
  const [autoFailed, setAutoFailed] = useState(false);
  useEffect(() => {
    if (!autoDetectPayment || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('topped_up') && !params.get('payment') && !params.get('subscription')) return;
    trackCheckoutSuccessFromUrl(params);
    window.history.replaceState({}, '', window.location.pathname);
    setAutoOpen(true);
    setAutoWaiting(true);
    setAutoSuccess(false);
    setAutoFailed(false);
    const preBalance = parseInt(sessionStorage.getItem('mkr_pre_topup_balance') || '0');
    sessionStorage.removeItem('mkr_pre_topup_balance');
    let attempts = 0;
    const poll = () => {
      attempts++;
      fetch('/api/billing/credits').then(r => r.json()).then(data => {
        writeNativeJSONCache('/api/billing/credits', data);
        const bal = data.balance ?? 0;
        if (data.subscription) setAutoSubscription(data.subscription);
        if (bal > preBalance) {
          setAutoBalance(bal);
          setAutoSuccess(true);
          setAutoWaiting(false);
          onBalanceUpdate?.(bal, data.subscription ?? null);
        } else if (attempts < 30) {
          setTimeout(poll, 1000);
        } else {
          setAutoBalance(bal);
          setAutoWaiting(false);
          setAutoFailed(true);
        }
      }).catch(() => { if (attempts < 30) setTimeout(poll, 1000); });
    };
    poll();
  }, [autoDetectPayment]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSubscription = !!(subscription && subscription.status !== 'canceled');

  const [tab, setTab] = useState<'subscribe' | 'topup'>('topup');

  useEffect(() => {
    setAppleBillingAvailable(isNativeApplePurchaseAvailable());
  }, []);

  useEffect(() => {
    if (!open || !appleBillingAvailable) return;
    let cancelled = false;
    fetch('/api/billing/apple/products')
      .then(r => r.json())
      .then(async data => {
        if (cancelled) return;
        const products = (data.products || []) as AppleBillingProduct[];
        setAppleProducts(products);
        setAppAccountToken(data.appAccountToken);
        const nativeProducts = await getNativeAppleProducts(products.map(product => product.productId));
        if (!cancelled) setNativeAppleProducts(Object.fromEntries(nativeProducts.map(product => [product.productId, product])));
      })
      .catch(error => {
        console.error('[billing/apple] product load failed:', error);
        if (!cancelled) setPaymentError('Apple purchases are not ready yet.');
      });
    return () => { cancelled = true; };
  }, [open, appleBillingAvailable]);

  // Sync tab when subscription status changes (async fetch)
  useEffect(() => {
    setTab(hasSubscription ? 'subscribe' : 'topup');
  }, [hasSubscription]);
  const currentPlanIndex = hasSubscription ? PLANS.findIndex(p => p.id === subscription!.planId) : -1;

  // Animate balance count-up on success
  useEffect(() => {
    if (!success || !open || animatingRef.current) return;
    animatingRef.current = true;
    const target = Math.max(0, balance);
    const from = parseInt(sessionStorage.getItem('mkr_pre_topup_balance') || '0');
    setAnimatedBalance(from);
    // Small delay so the "0" renders first, then count up
    const timer = setTimeout(() => {
      const duration = 1200;
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setAnimatedBalance(Math.max(0, Math.round(from + eased * (target - from))));
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          animatingRef.current = false;
        }
      };
      requestAnimationFrame(step);
    }, 100);
    return () => { clearTimeout(timer); animatingRef.current = false; };
  }, [success, open, balance]);

  if (!open) return null;

  const finishAppleTransaction = async (transactionId: string) => {
    try {
      await finishNativeAppleTransaction(transactionId);
    } catch (error) {
      console.warn('[billing/apple] could not finish native transaction:', error);
    }
  };

  const handleCheckout = async (tier: string) => {
    setLoading(tier);
    setPaymentError(null);
    try {
      const tierConfig = CREDIT_TIERS.find(c => c.id === tier);
      const metaEventId = trackCheckoutStart('topup', {
        content_name: tier,
        value: tierConfig ? tierConfig.price / 100 : undefined,
        currency: 'USD',
      });
      if (appleBillingAvailable) {
        const appleProduct = appleProducts.find(product => product.kind === 'topup' && product.tierId === tier);
        if (!appleProduct) throw new Error('Apple top-up product is not configured');
        sessionStorage.setItem('mkr_pre_topup_balance', String(externalBalance));
        const transaction = await purchaseNativeAppleProduct(appleProduct.productId, appAccountToken);
        const res = await fetch('/api/billing/apple/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedTransactionInfo: transaction.signedTransactionInfo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Apple top-up verification failed');
        await finishAppleTransaction(transaction.transactionId);
        writeNativeJSONCache('/api/billing/credits', data);
        setAutoOpen(true);
        setAutoWaiting(false);
        setAutoSuccess(true);
        setAutoFailed(false);
        setAutoBalance(data.balance ?? externalBalance);
        if (data.subscription) setAutoSubscription(data.subscription);
        onBalanceUpdate?.(data.balance ?? externalBalance, data.subscription ?? null);
        return;
      }

      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          returnPath: projectId ? `/projects/${projectId}` : (typeof window !== 'undefined' ? window.location.pathname : undefined),
          metaEventId,
          attribution: getAttributionForRequest(),
        }),
      });
      const data = await res.json();
      if (data.url) {
        sessionStorage.setItem('mkr_pre_topup_balance', String(externalBalance));
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('[billing] top-up failed:', error);
      setPaymentError(error instanceof Error ? error.message : 'Unable to start top-up.');
    } finally {
      setLoading(null);
    }
  };

  const handleSubscribe = async (planId: string) => {
    setLoading(`sub-${planId}-${selectedBillingInterval}`);
    setPaymentError(null);
    try {
      if (appleBillingAvailable) {
        const appleProduct = appleProducts.find(product => product.kind === 'subscription' && product.planId === planId && product.interval === selectedBillingInterval);
        if (!appleProduct) throw new Error('Apple subscription product is not configured');
        sessionStorage.setItem('mkr_pre_topup_balance', String(externalBalance));
        const transaction = await purchaseNativeAppleSubscription(appleProduct.productId, appAccountToken);
        const res = await fetch('/api/billing/apple/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedTransactionInfo: transaction.signedTransactionInfo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Apple purchase verification failed');
        await finishAppleTransaction(transaction.transactionId);
        writeNativeJSONCache('/api/billing/credits', data);
        setAutoOpen(true);
        setAutoWaiting(false);
        setAutoSuccess(true);
        setAutoFailed(false);
        setAutoBalance(data.balance ?? externalBalance);
        if (data.subscription) setAutoSubscription(data.subscription);
        onBalanceUpdate?.(data.balance ?? externalBalance, data.subscription ?? null);
        return;
      }

      const plan = PLANS.find(p => p.id === planId);
      const metaEventId = trackCheckoutStart('subscription', {
        content_name: planId,
        value: plan ? (selectedBillingInterval === 'year' ? plan.annualPrice : plan.monthlyPrice) / 100 : undefined,
        currency: 'USD',
      });
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          interval: selectedBillingInterval,
          returnPath: projectId ? `/projects/${projectId}` : (typeof window !== 'undefined' ? window.location.pathname : undefined),
          metaEventId,
          attribution: getAttributionForRequest(),
        }),
      });
      const data = await res.json();
      if (data.url) {
        sessionStorage.setItem('mkr_pre_topup_balance', String(externalBalance));
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('[billing] subscribe failed:', error);
      setPaymentError(error instanceof Error ? error.message : 'Unable to start subscription.');
    } finally {
      setLoading(null);
    }
  };

  const handleRestoreApplePurchases = async () => {
    setLoading('restore-apple');
    setPaymentError(null);
    try {
      sessionStorage.setItem('mkr_pre_topup_balance', String(externalBalance));
      const transactions = await restoreNativeApplePurchases();
      const transaction = transactions[0];
      if (!transaction) throw new Error('No active Apple subscription was found.');
      const res = await fetch('/api/billing/apple/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransactionInfo: transaction.signedTransactionInfo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not restore Apple subscription.');
      await finishAppleTransaction(transaction.transactionId);
      writeNativeJSONCache('/api/billing/credits', data);
      setAutoOpen(true);
      setAutoWaiting(false);
      setAutoSuccess(true);
      setAutoFailed(false);
      setAutoBalance(data.balance ?? externalBalance);
      if (data.subscription) setAutoSubscription(data.subscription);
      onBalanceUpdate?.(data.balance ?? externalBalance, data.subscription ?? null);
    } catch (error) {
      console.error('[billing/apple] restore failed:', error);
      setPaymentError(error instanceof Error ? error.message : 'Could not restore Apple subscription.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={success ? undefined : onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          animation: 'creditFadeIn 0.2s ease-out',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed', zIndex: 301,
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '92%', maxWidth: 480,
          maxHeight: '85dvh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, #18181b 0%, #0f0f12 100%)',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
          animation: 'creditScaleIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
      >
        {/* ══════ FAILED STATE ══════ */}
        {autoFailed ? (
          <div style={{ padding: '48px 24px 36px', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
              background: 'rgba(239,68,68,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
              {t('billing.paymentPending')}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 6, lineHeight: 1.5 }}>
              {t('billing.paymentPendingDesc')}
            </div>
            <button
              onClick={onClose}
              style={{
                width: '100%', marginTop: 24,
                padding: 14, borderRadius: 14, border: 'none',
                background: 'rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('billing.close')}
            </button>
          </div>

        ) : waiting && !success ? (
          <div style={{ padding: '48px 24px 36px', textAlign: 'center' }}>
            <div style={{
              width: 48, height: 48, margin: '0 auto 20px',
              border: '3px solid rgba(192,38,211,0.2)',
              borderTopColor: '#e879f9',
              borderRadius: '50%',
              animation: 'creditSpin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
              {t('billing.processingPayment')}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
              {t('billing.usuallyFewSeconds')}
            </div>
          </div>

        ) : success ? (
          /* ══════ SUCCESS STATE + FIREWORKS ══════ */
          <div style={{ padding: '48px 24px 36px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            {/* Fireworks particles */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {Array.from({ length: 24 }).map((_, i) => {
                const angle = (i / 24) * 360;
                const dist = 60 + Math.random() * 80;
                const size = 4 + Math.random() * 4;
                const delay = Math.random() * 0.3;
                const colors = ['#e879f9', '#a855f7', '#fbbf24', '#f472b6', '#818cf8', '#34d399'];
                const color = colors[i % colors.length];
                return (
                  <div key={i} style={{
                    position: 'absolute',
                    left: '50%', top: '40%',
                    width: size, height: size,
                    borderRadius: '50%',
                    background: color,
                    opacity: 0,
                    animation: `creditFirework 1s ${delay}s ease-out forwards`,
                    // @ts-expect-error CSS custom properties
                    '--fw-x': `${Math.cos(angle * Math.PI / 180) * dist}px`,
                    '--fw-y': `${Math.sin(angle * Math.PI / 180) * dist}px`,
                  }} />
                );
              })}
            </div>

            {/* Checkmark icon */}
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
              background: 'linear-gradient(135deg, rgba(217,70,239,0.25), rgba(168,85,247,0.25))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'creditSuccessPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              position: 'relative', zIndex: 1,
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e879f9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.02em', position: 'relative', zIndex: 1 }}>
              {t('billing.creditsAdded')}
            </div>

            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 6, position: 'relative', zIndex: 1 }}>
              {t('billing.balanceUpdated')}
            </div>

            {/* Animated balance */}
            <div style={{
              marginTop: 24, padding: '20px 0',
              borderRadius: 16,
              background: 'rgba(192,38,211,0.06)',
              border: '1px solid rgba(192,38,211,0.15)',
              position: 'relative', zIndex: 1,
            }}>
              <div style={{
                fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em',
                background: 'linear-gradient(135deg, #e879f9, #a855f7)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {animatedBalance.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                {t('billing.creditsAvailable')}
              </div>
            </div>

            {/* Continue button */}
            <button
              onClick={onClose}
              style={{
                width: '100%', marginTop: 24,
                padding: 14, borderRadius: 14, border: 'none',
                background: 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(217,70,239,0.3)',
                position: 'relative', zIndex: 1,
              }}
            >
              {t('billing.continueCreating')}
            </button>
          </div>
        ) : suppressWebBilling && !appleBillingAvailable ? (
          <div data-testid="ios-billing-unavailable" style={{ padding: '32px 24px 28px', textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 18, margin: '0 auto 18px',
              background: 'rgba(192,38,211,0.12)',
              border: '1px solid rgba(192,38,211,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e879f9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>
              {t('billing.iosUnavailableTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.42)', marginTop: 8, lineHeight: 1.55 }}>
              {t('billing.iosUnavailableDesc')}
            </div>
            <div style={{
              marginTop: 18, padding: '14px 16px', borderRadius: 14,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.72)',
              fontSize: 13,
            }}>
              Balance: <span style={{ color: balance === 0 ? '#fbbf24' : 'rgba(255,255,255,0.9)', fontWeight: 700 }}>{balance}</span> credits
              {needed ? <> &middot; ~{needed} needed</> : null}
            </div>
            <button
              onClick={onClose}
              style={{
                width: '100%', marginTop: 20,
                padding: 14, borderRadius: 14, border: 'none',
                background: 'rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('billing.close')}
            </button>
          </div>
        ) : (
          /* ══════ NORMAL STATE — SUBSCRIBE / TOP UP ══════ */
          <>
            {/* Header */}
            <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>
                  {t('billing.getMoreCredits')}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                  Balance: <span style={{ color: balance === 0 ? '#fbbf24' : 'rgba(255,255,255,0.6)' }}>{balance}</span> credits
                  {needed ? <> &middot; ~{needed} needed</> : null}
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.06)', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.4)',
                  fontSize: 16, lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: 'flex', gap: 4, margin: '16px 24px 0', padding: 3, background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
              <button
                onClick={() => setTab('topup')}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: tab === 'topup' ? 'rgba(192,38,211,0.2)' : 'transparent',
                  color: tab === 'topup' ? '#e879f9' : 'rgba(255,255,255,0.35)',
                  transition: 'all 0.15s',
                }}
              >
                Top Up
              </button>
              <button
                onClick={() => setTab('subscribe')}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: tab === 'subscribe' ? 'rgba(192,38,211,0.2)' : 'transparent',
                  color: tab === 'subscribe' ? '#e879f9' : 'rgba(255,255,255,0.35)',
                  transition: 'all 0.15s',
                }}
              >
                Upgrade
              </button>
            </div>

            {appleBillingAvailable && (
              <div style={{ margin: '10px 24px 0', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                Purchases are billed through Apple.
              </div>
            )}

            {/* Content */}
            <div style={{ padding: '16px 24px 24px' }}>

              {/* ── Subscribe tab (or only view if no subscription) ── */}
              {tab === 'subscribe' && (
                <>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 12, padding: 3, background: 'rgba(255,255,255,0.04)', borderRadius: 10 }}>
                    {(['month', 'year'] as const).map(interval => (
                      <button
                        key={interval}
                        onClick={() => setSelectedBillingInterval(interval)}
                        style={{
                          flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                          fontSize: 12, fontWeight: 650, cursor: 'pointer',
                          background: selectedBillingInterval === interval ? 'rgba(192,38,211,0.2)' : 'transparent',
                          color: selectedBillingInterval === interval ? '#e879f9' : 'rgba(255,255,255,0.35)',
                        }}
                      >
                        {interval === 'month' ? 'Monthly' : 'Annual'}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PLANS.map((plan, idx) => {
                      const isCurrent = hasSubscription && subscription!.planId === plan.id;
                      const isDowngrade = hasSubscription && idx < currentPlanIndex;
                      const isSelected = selectedPlan === plan.id;
                      const appleProduct = appleProducts.find(product => product.kind === 'subscription' && product.planId === plan.id && product.interval === selectedBillingInterval);
                      const displayPrice = appleProduct ? nativeAppleProducts[appleProduct.productId]?.displayPrice : undefined;
                      const fallbackPrice = selectedBillingInterval === 'year' ? plan.annualPrice : plan.monthlyPrice;
                      const credits = selectedBillingInterval === 'year' ? plan.credits * 12 : plan.credits;
                      return (
                        <button
                          key={plan.id}
                          onClick={() => !isCurrent && !isDowngrade && setSelectedPlan(plan.id)}
                          disabled={!!(isCurrent || isDowngrade)}
                          style={{
                            padding: '14px 18px',
                            borderRadius: 14,
                            border: isCurrent
                              ? '1px solid rgba(255,255,255,0.08)'
                              : isSelected
                                ? '1.5px solid rgba(192,38,211,0.5)'
                                : '1px solid rgba(255,255,255,0.06)',
                            background: isCurrent
                              ? 'rgba(255,255,255,0.02)'
                              : isSelected
                                ? 'rgba(192,38,211,0.06)'
                                : 'rgba(255,255,255,0.02)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            opacity: isCurrent ? 0.45 : isDowngrade ? 0.4 : 1,
                            cursor: isCurrent || isDowngrade ? 'default' : 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                                {plan.name}
                              </span>
                              {isCurrent && (
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                                  background: 'rgba(192,38,211,0.2)', color: '#e879f9',
                                }}>
                                  {t('billing.current')}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                              {credits.toLocaleString()} {selectedBillingInterval === 'year' ? 'credits/year' : t('billing.creditsPerMonth')}
                            </div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: isSelected && !isCurrent ? '#e879f9' : 'rgba(255,255,255,0.6)' }}>
                            {displayPrice || `$${(fallbackPrice / 100).toFixed(2)}`}<span style={{ fontSize: 11, fontWeight: 400 }}>{selectedBillingInterval === 'year' ? '/yr' : '/mo'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => handleSubscribe(selectedPlan)}
                    disabled={!!loading || !!(hasSubscription && subscription!.planId === selectedPlan)}
                    style={{
                      width: '100%', marginTop: 16,
                      padding: 14, borderRadius: 14, border: 'none',
                      background: 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                      cursor: loading ? 'wait' : 'pointer',
                      opacity: loading || (hasSubscription && subscription!.planId === selectedPlan) ? 0.4 : 1,
                      boxShadow: '0 4px 20px rgba(217,70,239,0.3)',
                    }}
                  >
                    {loading?.startsWith('sub-')
                      ? '...'
                      : appleBillingAvailable
                        ? `Subscribe with Apple ${selectedBillingInterval === 'year' ? 'Annual' : 'Monthly'}`
                        : hasSubscription
                        ? `${t('billing.upgradeTo')} ${PLANS.find(p => p.id === selectedPlan)?.name}`
                        : `${t('billing.subscribeTo')} ${PLANS.find(p => p.id === selectedPlan)?.name}`}
                  </button>

                  {appleBillingAvailable && (
                    <button
                      onClick={handleRestoreApplePurchases}
                      disabled={!!loading}
                      style={{
                        width: '100%', marginTop: 10,
                        padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)',
                        background: 'rgba(255,255,255,0.03)',
                        color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600,
                        cursor: loading ? 'wait' : 'pointer',
                      }}
                    >
                      {loading === 'restore-apple' ? '...' : 'Restore Apple Purchase'}
                    </button>
                  )}
                </>
              )}

              {/* ── Top Up tab ── */}
              {tab === 'topup' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {CREDIT_TIERS.map(tier => {
                      const appleProduct = appleProducts.find(product => product.kind === 'topup' && product.tierId === tier.id);
                      const displayPrice = appleProduct ? nativeAppleProducts[appleProduct.productId]?.displayPrice : undefined;
                      return (
                        <button
                          key={tier.id}
                          onClick={() => setSelectedTier(tier.id)}
                          style={{
                            padding: '14px 18px',
                            borderRadius: 14,
                            border: selectedTier === tier.id
                              ? '1.5px solid rgba(192,38,211,0.5)'
                              : '1px solid rgba(255,255,255,0.06)',
                            background: selectedTier === tier.id
                              ? 'rgba(192,38,211,0.06)'
                              : 'rgba(255,255,255,0.02)',
                            cursor: 'pointer',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            transition: 'all 0.15s',
                            textAlign: 'left',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                              {tier.credits.toLocaleString()} credits
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                              {tier.unitPrice}/credit
                            </div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: selectedTier === tier.id ? '#e879f9' : 'rgba(255,255,255,0.6)' }}>
                            {displayPrice || `$${(tier.price / 100).toFixed(0)}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => handleCheckout(selectedTier)}
                    disabled={!!loading}
                    style={{
                      width: '100%', marginTop: 16,
                      padding: 14, borderRadius: 14, border: 'none',
                      background: 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                      cursor: loading ? 'wait' : 'pointer',
                      opacity: loading ? 0.5 : 1,
                      boxShadow: '0 4px 20px rgba(217,70,239,0.3)',
                    }}
                  >
                    {loading === selectedTier
                      ? '...'
                      : `${t('billing.topUp')} ${CREDIT_TIERS.find(c => c.id === selectedTier)?.credits.toLocaleString()} ${t('billing.credits')}`}
                  </button>
                </>
              )}

              {paymentError && (
                <div style={{ marginTop: 12, color: '#f87171', fontSize: 12, lineHeight: 1.45 }}>
                  {paymentError}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes creditFadeIn {
          from { opacity: 0 }
          to { opacity: 1 }
        }
        @keyframes creditScaleIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.95) }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1) }
        }
        @keyframes creditSuccessPop {
          from { transform: scale(0.5); opacity: 0 }
          to { transform: scale(1); opacity: 1 }
        }
        @keyframes creditSpin {
          to { transform: rotate(360deg) }
        }
        @keyframes creditFirework {
          0% { transform: translate(0, 0) scale(1); opacity: 1 }
          100% { transform: translate(var(--fw-x), var(--fw-y)) scale(0); opacity: 0 }
        }
      `}</style>
    </>
  );
}
