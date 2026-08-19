'use client'

import { MakaronSpark, MAKARON_WORDMARK_STYLE } from '@/components/MakaronLogo'
import { useLocale } from '@/lib/i18n'
import type { NativeAppleProduct } from '@/lib/native-purchases'

interface AppleTrialCheckoutProps {
  nativeProduct?: NativeAppleProduct
  loading: boolean
  disabled: boolean
  purchasing: boolean
  error?: string | null
  onStart: () => void
  onClose: () => void
  onRestore: () => void
  restoring: boolean
}

const CREATION_LABELS = [
  'billing.trial.creation1',
  'billing.trial.creation2',
  'billing.trial.creation3',
] as const

const CREATION_ALTS = [
  'billing.trial.creationAlt1',
  'billing.trial.creationAlt2',
  'billing.trial.creationAlt3',
] as const

const CREATION_IMAGES = [
  '/landing/trial-selfie-poster.jpg',
  '/landing/trial-image-video.jpg',
  '/landing/trial-agent-variations.jpg',
] as const

export default function AppleTrialCheckout({
  nativeProduct,
  loading,
  disabled,
  purchasing,
  error,
  onStart,
  onClose,
  onRestore,
  restoring,
}: AppleTrialCheckoutProps) {
  const { t } = useLocale()
  const renewalPrice = nativeProduct?.displayPrice || '$9.99'

  return (
    <section
      data-testid="apple-skill-trial-paywall"
      data-presentation="bottom-sheet"
      className="apple-trial-sheet"
    >
      <div className="apple-trial-handle" aria-hidden="true" />
      <header className="apple-trial-header">
        <div className="apple-trial-brand">
          {/* i18n-ignore */}
          <MakaronSpark size={24} title="Makaron" />
          {/* i18n-ignore */}
          <span style={{ ...MAKARON_WORDMARK_STYLE, fontSize: 17, fontWeight: 560 }}>Makaron</span>
        </div>
        <button type="button" onClick={onClose} className="apple-trial-close" aria-label={t('billing.trial.close')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="apple-trial-scroll">
        <div className="apple-trial-copy">
          <div className="apple-trial-kicker">{t('billing.trial.firstCreationComplete')}</div>
          <h2>{t('billing.trial.nextSkillTitle')}</h2>
          <p>{t('billing.trial.nextSkillSubtitle')}</p>
        </div>

        <div className="apple-trial-gallery" aria-label={t('billing.trial.galleryLabel')}>
          {CREATION_LABELS.map((label, index) => (
            <figure key={label}>
              <img src={CREATION_IMAGES[index]} alt={t(CREATION_ALTS[index])} className="apple-trial-visual" />
              <figcaption>{t(label)}</figcaption>
            </figure>
          ))}
        </div>

        <div className="apple-trial-benefits">
          {[
            t('billing.trial.benefitCredits'),
            t('billing.trial.benefitSkills'),
            t('billing.trial.benefitAgent'),
          ].map(label => (
            <div key={label}>
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="9" fill="rgba(110,231,183,0.13)" />
                <path d="M6.4 10.2L8.7 12.5L13.8 7.4" stroke="#6ee7b7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="apple-trial-offer">
        {loading ? (
          <div data-testid="apple-trial-loading" className="apple-trial-loading">
            <span />
            {t('billing.trial.loadingOffer')}
          </div>
        ) : (
          <>
            <div className="apple-trial-option">
              <span className="apple-trial-radio" aria-hidden="true"><span /></span>
              <div>
                <strong>{t('billing.trial.offerTitle')}</strong>
                <span>{t('billing.trial.offerRenewalPrefix')} {renewalPrice}{t('billing.trial.perMonth')}</span>
              </div>
              <b>{t('billing.trial.offerToday')}</b>
            </div>

            <button
              data-testid="apple-trial-cta"
              type="button"
              onClick={onStart}
              disabled={disabled}
              className="apple-trial-cta"
            >
              {purchasing ? t('billing.trial.confirming') : t('billing.trial.cta')}
            </button>

            {error && <p data-testid="apple-trial-error" className="apple-trial-error">{error}</p>}

            <p className="apple-trial-legal">{t('billing.trial.legal')}</p>
            <button type="button" onClick={onRestore} disabled={restoring} className="apple-trial-restore">
              {restoring ? t('billing.trial.restoring') : t('billing.trial.restore')}
            </button>
          </>
        )}
      </div>

      {/* i18n-ignore */}
      <style>{`
        .apple-trial-sheet {
          box-sizing: border-box;
          height: min(70dvh, 720px);
          min-height: min(66dvh, 620px);
          max-height: 78dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          color: #fff;
          background: radial-gradient(circle at 50% -20%, rgba(240,91,236,0.13), transparent 35%), #0b0b0e;
          padding-bottom: max(8px, env(safe-area-inset-bottom));
        }
        .apple-trial-handle { width: 38px; height: 4px; margin: 8px auto 2px; border-radius: 999px; background: rgba(255,255,255,0.18); flex: 0 0 auto; }
        .apple-trial-header { padding: 8px 18px 0; display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; }
        .apple-trial-brand { display: flex; align-items: center; gap: 8px; }
        .apple-trial-close { width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; color: rgba(255,255,255,0.58); background: rgba(255,255,255,0.07); cursor: pointer; }
        .apple-trial-scroll { overflow-y: auto; overscroll-behavior: contain; padding: 18px 18px 14px; }
        .apple-trial-copy { text-align: center; }
        .apple-trial-kicker { color: #f05bec; font-size: 11px; line-height: 1.2; font-weight: 760; text-transform: uppercase; letter-spacing: 0; }
        .apple-trial-copy h2 { margin: 8px auto 0; font-size: 30px; line-height: 1.08; font-weight: 720; letter-spacing: 0; text-wrap: balance; }
        .apple-trial-copy p { margin: 9px auto 0; max-width: 390px; color: rgba(255,255,255,0.55); font-size: 13px; line-height: 1.48; text-wrap: pretty; }
        .apple-trial-gallery { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 18px; }
        .apple-trial-gallery figure { position: relative; margin: 0; min-width: 0; aspect-ratio: 1 / 2; overflow: hidden; border-radius: 8px; border: 1px solid rgba(255,255,255,0.11); background: #15151a; }
        .apple-trial-visual { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
        .apple-trial-gallery figure::after { content: ""; position: absolute; inset: 48% 0 0; background: linear-gradient(transparent, rgba(5,5,8,0.92)); pointer-events: none; }
        .apple-trial-gallery figcaption { position: absolute; z-index: 1; left: 9px; right: 7px; bottom: 8px; color: rgba(255,255,255,0.94); font-size: 11px; line-height: 1.2; font-weight: 700; text-shadow: 0 1px 8px rgba(0,0,0,0.8); }
        .apple-trial-benefits { display: grid; gap: 8px; margin: 15px auto 0; max-width: 410px; }
        .apple-trial-benefits > div { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 9px; color: rgba(255,255,255,0.72); font-size: 12px; line-height: 1.35; }
        .apple-trial-benefits svg { display: block; }
        .apple-trial-offer { flex: 0 0 auto; padding: 12px 18px 2px; border-top: 1px solid rgba(255,255,255,0.09); background: rgba(11,11,14,0.98); }
        .apple-trial-option { min-height: 52px; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 0 2px 9px; }
        .apple-trial-radio { width: 20px; height: 20px; display: grid; place-items: center; border: 1.5px solid #f05bec; border-radius: 50%; }
        .apple-trial-radio span { width: 10px; height: 10px; border-radius: 50%; background: #f05bec; }
        .apple-trial-option div { display: grid; gap: 2px; }
        .apple-trial-option strong { font-size: 14px; line-height: 1.2; font-weight: 720; }
        .apple-trial-option div span { color: rgba(255,255,255,0.45); font-size: 11px; line-height: 1.2; }
        .apple-trial-option b { color: #6ee7b7; font-size: 13px; font-weight: 720; }
        .apple-trial-cta { width: 100%; min-height: 54px; border: 0; border-radius: 8px; color: #1a0419; background: #f05bec; font-size: 16px; line-height: 1.2; font-weight: 780; cursor: pointer; box-shadow: 0 9px 28px rgba(240,91,236,0.22); }
        .apple-trial-cta:disabled { color: rgba(255,255,255,0.36); background: rgba(255,255,255,0.09); box-shadow: none; cursor: wait; }
        .apple-trial-legal { margin: 8px auto 0; max-width: 460px; color: rgba(255,255,255,0.31); font-size: 9px; line-height: 1.4; text-align: center; }
        .apple-trial-error { margin: 8px auto 0; color: #fca5a5; font-size: 11px; line-height: 1.4; text-align: center; }
        .apple-trial-restore { display: block; margin: 2px auto 0; padding: 5px 8px; border: 0; color: rgba(255,255,255,0.43); background: transparent; font-size: 10px; font-weight: 650; cursor: pointer; }
        .apple-trial-loading { min-height: 100px; display: flex; align-items: center; justify-content: center; gap: 10px; color: rgba(255,255,255,0.54); font-size: 13px; }
        .apple-trial-loading span { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.12); border-top-color: #f05bec; border-radius: 50%; animation: creditSpin 0.8s linear infinite; }
        @media (min-width: 640px) { .apple-trial-sheet { border-radius: 26px; } }
        @media (max-height: 700px) {
          .apple-trial-scroll { padding-top: 10px; }
          .apple-trial-copy h2 { font-size: 26px; }
          .apple-trial-gallery { margin-top: 12px; }
          .apple-trial-benefits { margin-top: 11px; gap: 6px; }
        }
      `}</style>
    </section>
  )
}
