'use client';

import { useState } from 'react';
import { CREDIT_TIERS } from '@/lib/billing/tiers';
// i18n keys to be added later; using inline strings for now

const PLANS = [
  { id: 'basic', name: 'Basic', monthlyPrice: 990, credits: 1200 },
  { id: 'pro', name: 'Pro', monthlyPrice: 1990, credits: 3000 },
  { id: 'business', name: 'Business', monthlyPrice: 4990, credits: 10000 },
] as const;

interface CreditPopupProps {
  open: boolean;
  onClose: () => void;
  balance: number;
  needed?: number;
  subscription?: { planId: string; status: string } | null;
}

export default function CreditPopup({ open, onClose, balance, needed, subscription }: CreditPopupProps) {
  // placeholder — will use useLocale() after adding i18n keys
  const [loading, setLoading] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('starter');

  if (!open) return null;

  const hasSubscription = subscription && subscription.status !== 'canceled';
  const currentPlanIndex = hasSubscription ? PLANS.findIndex(p => p.id === subscription.planId) : -1;
  const upgradePlan = currentPlanIndex >= 0 && currentPlanIndex < PLANS.length - 1 ? PLANS[currentPlanIndex + 1] : null;

  const handleCheckout = async (tier: string) => {
    setLoading(tier);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank');
    } finally {
      setLoading(null);
    }
  };

  const handleSubscribe = async (planId: string) => {
    setLoading(`sub-${planId}`);
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, interval: 'month' }),
      });
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.2s ease-out',
        }}
      />

      {/* Popup */}
      <div
        style={{
          position: 'fixed', zIndex: 301,
          left: '50%', bottom: 0, transform: 'translateX(-50%)',
          width: '100%', maxWidth: 420,
          background: 'linear-gradient(180deg, #141416 0%, #0c0c0e 100%)',
          borderRadius: '24px 24px 0 0',
          border: '1px solid rgba(255,255,255,0.06)',
          borderBottom: 'none',
          padding: '24px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)',
          animation: 'slideUpSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
      >
        {/* Handle bar */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24', letterSpacing: '-0.01em' }}>
            Credits Exhausted
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
            Balance: {balance} credits
            {needed ? ` · $need ~${needed}` : ''}
            {hasSubscription ? ` · ${subscription.planId} $plan` : ''}
          </div>
        </div>

        {!hasSubscription ? (
          /* ── A: No subscription → recommend subscribing ── */
          <>
            {/* Recommended plan card */}
            <div style={{
              background: 'rgba(217,70,239,0.08)',
              border: '1px solid rgba(217,70,239,0.25)',
              borderRadius: 16,
              padding: '16px 20px',
              marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                    Basic · ${(PLANS[0].monthlyPrice / 100).toFixed(2)}/mo
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                    Monthly {PLANS[0].credits.toLocaleString()} credits
                  </div>
                </div>
                <button
                  onClick={() => handleSubscribe('basic')}
                  disabled={!!loading}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: loading ? 'wait' : 'pointer',
                    opacity: loading ? 0.5 : 1,
                    boxShadow: '0 4px 20px rgba(217,70,239,0.3)',
                  }}
                >
                  {loading === 'sub-basic' ? '...' : 'Subscribe'}
                </button>
              </div>
            </div>

            {/* Secondary: one-time top-up links */}
            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
              Or top up:
              {CREDIT_TIERS.map((tier, i) => (
                <span key={tier.id}>
                  {i > 0 && ' · '}
                  <button
                    onClick={() => handleCheckout(tier.id)}
                    disabled={!!loading}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'rgba(255,255,255,0.5)', fontSize: 12, textDecoration: 'underline',
                      textUnderlineOffset: 2, padding: '2px 0',
                    }}
                  >
                    {loading === tier.id ? '...' : `$${(tier.price / 100).toFixed(0)}`}
                  </button>
                </span>
              ))}
            </div>
          </>
        ) : (
          /* ── B: Has subscription → top up + upgrade ── */
          <>
            {/* Top up tier cards */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {CREDIT_TIERS.map(tier => (
                <button
                  key={tier.id}
                  onClick={() => setSelectedTier(tier.id)}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    borderRadius: 12,
                    border: selectedTier === tier.id
                      ? '1.5px solid rgba(217,70,239,0.6)'
                      : '1px solid rgba(255,255,255,0.08)',
                    background: selectedTier === tier.id
                      ? 'rgba(217,70,239,0.1)'
                      : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
                    {tier.credits.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    ${(tier.price / 100).toFixed(0)}
                  </div>
                </button>
              ))}
            </div>

            {/* Top up action button */}
            <button
              onClick={() => handleCheckout(selectedTier)}
              disabled={!!loading}
              style={{
                width: '100%',
                padding: 14,
                borderRadius: 14,
                border: 'none',
                background: 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.5 : 1,
                boxShadow: '0 4px 20px rgba(217,70,239,0.3)',
                marginBottom: 16,
              }}
            >
              {loading === selectedTier ? '...' : `Top Up ${CREDIT_TIERS.find(c => c.id === selectedTier)?.credits.toLocaleString()} Credits · $${((CREDIT_TIERS.find(c => c.id === selectedTier)?.price ?? 0) / 100).toFixed(0)}`}
            </button>

            {/* Secondary: upgrade suggestion */}
            {upgradePlan && (
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={() => handleSubscribe(upgradePlan.id)}
                  disabled={!!loading}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.4)', fontSize: 12,
                  }}
                >
                  {loading === `sub-${upgradePlan.id}` ? '...' : (
                    <>
                      Upgrade to {upgradePlan.name} · ${(upgradePlan.monthlyPrice / 100).toFixed(2)}/mo · {upgradePlan.credits.toLocaleString()} credits
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0 }
          to { opacity: 1 }
        }
      `}</style>
    </>
  );
}
