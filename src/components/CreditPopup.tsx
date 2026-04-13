'use client';

import { useState, useEffect } from 'react';
import { CREDIT_TIERS } from '@/lib/billing/tiers';

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
  projectId?: string;
  /** Show success celebration screen */
  success?: boolean;
}

export default function CreditPopup({ open, onClose, balance, needed, subscription, projectId, success }: CreditPopupProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('pro');
  const [selectedPlan, setSelectedPlan] = useState<string>('basic');
  const [animatedBalance, setAnimatedBalance] = useState(0);

  const hasSubscription = !!(subscription && subscription.status !== 'canceled');

  // Tab: no subscription → subscribe only; has subscription → topup default
  const [tab, setTab] = useState<'subscribe' | 'topup'>(hasSubscription ? 'topup' : 'subscribe');
  const currentPlanIndex = hasSubscription ? PLANS.findIndex(p => p.id === subscription!.planId) : -1;

  // Animate balance count-up on success
  useEffect(() => {
    if (!success || !open) return;
    setAnimatedBalance(0);
    const target = balance;
    const duration = 1200;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setAnimatedBalance(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [success, open, balance]);

  if (!open) return null;

  const handleCheckout = async (tier: string) => {
    setLoading(tier);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, returnPath: projectId ? `/projects/${projectId}` : undefined }),
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
        body: JSON.stringify({ planId, interval: 'month', returnPath: projectId ? `/projects/${projectId}` : undefined }),
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
        {/* ══════ SUCCESS STATE ══════ */}
        {success ? (
          <div style={{ padding: '48px 24px 36px', textAlign: 'center' }}>
            {/* Celebration icon */}
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
              background: 'linear-gradient(135deg, rgba(217,70,239,0.2), rgba(168,85,247,0.2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'creditSuccessPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e879f9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.02em' }}>
              Credits Added!
            </div>

            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
              Your balance has been updated
            </div>

            {/* Animated balance */}
            <div style={{
              marginTop: 24, padding: '20px 0',
              borderRadius: 16,
              background: 'rgba(192,38,211,0.06)',
              border: '1px solid rgba(192,38,211,0.15)',
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
                credits available
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
              }}
            >
              Continue Creating
            </button>
          </div>
        ) : (
          /* ══════ NORMAL STATE — SUBSCRIBE / TOP UP ══════ */
          <>
            {/* Header */}
            <div style={{ padding: '24px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>
                  Get More Credits
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

            {/* Tab bar — only show if has subscription (both tabs available) */}
            {hasSubscription && (
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
            )}

            {/* Content */}
            <div style={{ padding: '16px 24px 24px' }}>

              {/* ── Subscribe tab (or only view if no subscription) ── */}
              {tab === 'subscribe' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PLANS.map((plan, idx) => {
                      const isCurrent = hasSubscription && subscription!.planId === plan.id;
                      const isDowngrade = hasSubscription && idx < currentPlanIndex;
                      const isSelected = selectedPlan === plan.id;
                      return (
                        <button
                          key={plan.id}
                          onClick={() => !isCurrent && !isDowngrade && setSelectedPlan(plan.id)}
                          disabled={!!(isCurrent || isDowngrade)}
                          style={{
                            padding: '14px 18px',
                            borderRadius: 14,
                            border: isCurrent
                              ? '1.5px solid rgba(192,38,211,0.5)'
                              : isSelected
                                ? '1.5px solid rgba(192,38,211,0.5)'
                                : '1px solid rgba(255,255,255,0.06)',
                            background: isCurrent
                              ? 'rgba(192,38,211,0.06)'
                              : isSelected
                                ? 'rgba(192,38,211,0.06)'
                                : 'rgba(255,255,255,0.02)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            opacity: isDowngrade ? 0.4 : 1,
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
                                  Current
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                              {plan.credits.toLocaleString()} credits/month
                            </div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: isSelected && !isCurrent ? '#e879f9' : 'rgba(255,255,255,0.6)' }}>
                            ${(plan.monthlyPrice / 100).toFixed(2)}<span style={{ fontSize: 11, fontWeight: 400 }}>/mo</span>
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
                      : hasSubscription
                        ? `Upgrade to ${PLANS.find(p => p.id === selectedPlan)?.name}`
                        : `Subscribe to ${PLANS.find(p => p.id === selectedPlan)?.name}`}
                  </button>
                </>
              )}

              {/* ── Top Up tab (only when subscribed) ── */}
              {tab === 'topup' && hasSubscription && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {CREDIT_TIERS.map(tier => (
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
                          ${(tier.price / 100).toFixed(0)}
                        </div>
                      </button>
                    ))}
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
                      : `Top Up ${CREDIT_TIERS.find(c => c.id === selectedTier)?.credits.toLocaleString()} Credits`}
                  </button>
                </>
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
      `}</style>
    </>
  );
}
