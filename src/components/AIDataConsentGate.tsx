'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from '@/lib/i18n';
import { isMakaronIOSApp } from '@/lib/native-app';

export const AI_DATA_CONSENT_STORAGE_KEY = 'makaron:ai-data-consent:v1';
export const AI_DATA_CONSENT_COOKIE = 'makaron_ai_data_consent';

type ConsentState = 'checking' | 'prompt' | 'declined' | 'accepted';

function storeConsent() {
  const record = JSON.stringify({ version: 1, grantedAt: new Date().toISOString() });
  try {
    localStorage.setItem(AI_DATA_CONSENT_STORAGE_KEY, record);
  } catch {}
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${AI_DATA_CONSENT_COOKIE}=v1; path=/; max-age=31536000; SameSite=Lax${secure}`;
}

function hasStoredConsent(): boolean {
  try {
    const record = JSON.parse(localStorage.getItem(AI_DATA_CONSENT_STORAGE_KEY) || 'null');
    if (record?.version === 1 && typeof record?.grantedAt === 'string') return true;
  } catch {}
  return document.cookie.split(';').some((part) => part.trim() === `${AI_DATA_CONSENT_COOKIE}=v1`);
}

export function shouldLeaveRedirectRootAfterConsent(pathname: string): boolean {
  return pathname === '/';
}

export default function AIDataConsentGate({
  children,
  required,
  initiallyAccepted = false,
}: {
  children: ReactNode;
  required: boolean;
  initiallyAccepted?: boolean;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<ConsentState>(
    required && !initiallyAccepted ? 'checking' : 'accepted',
  );

  useEffect(() => {
    if (initiallyAccepted) {
      setState('accepted');
      return;
    }
    const developmentPreview = process.env.NODE_ENV === 'development'
      && new URLSearchParams(window.location.search).has('__makaron_ios_consent');
    if (!required && !isMakaronIOSApp() && !developmentPreview) {
      setState('accepted');
      return;
    }
    if (!hasStoredConsent()) {
      setState('prompt');
      return;
    }
    if (shouldLeaveRedirectRootAfterConsent(window.location.pathname)) {
      // The root route is a server redirect. Mounting its already-suspended
      // React node after the consent gate opens can reuse an invalid hook tree
      // in React 19. Sync the server-visible cookie, then cross the redirect
      // boundary with a clean request to the public Skill home.
      storeConsent();
      window.location.replace('/home');
      return;
    }
    setState('accepted');
  }, [initiallyAccepted, required]);

  if (state === 'accepted') return <>{children}</>;

  if (state === 'checking') {
    return (
      <main className="makaron-ios-page flex min-h-dvh items-center justify-center bg-black">
        <img
          src="/brand/makaron-app-icon-1024.png"
          alt="Makaron"
          className="h-16 w-16 rounded-[15px]"
        />
      </main>
    );
  }

  const declined = state === 'declined';

  return (
    <main
      className="makaron-ios-page min-h-dvh overflow-y-auto bg-black px-5 text-white"
      data-testid="ai-data-consent-gate"
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center py-[max(40px,env(safe-area-inset-top))]">
        <img
          src="/brand/makaron-app-icon-1024.png"
          alt="Makaron"
          className="mb-8 h-16 w-16 rounded-[15px]"
        />

        <h1 className="text-[28px] font-semibold leading-tight tracking-normal">
          {declined ? t('aiConsent.offTitle') : t('aiConsent.title')}
        </h1>

        {declined ? (
          <p className="mt-4 text-[15px] leading-6 text-white/62">{t('aiConsent.offBody')}</p>
        ) : (
          <div className="mt-5 space-y-4 text-[15px] leading-6 text-white/65">
            <p>{t('aiConsent.body')}</p>
            <div className="border-y border-white/10 py-4">
              <p className="font-medium text-white/88">{t('aiConsent.dataTitle')}</p>
              <p className="mt-1.5">{t('aiConsent.data')}</p>
            </div>
            <div className="border-b border-white/10 pb-4">
              <p className="font-medium text-white/88">{t('aiConsent.providersTitle')}</p>
              <p className="mt-1.5">{t('aiConsent.providers')}</p>
            </div>
            <p className="text-[13px] leading-5 text-white/45">{t('aiConsent.accountData')}</p>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {declined ? (
            <button
              type="button"
              className="h-12 w-full bg-white px-5 text-[16px] font-semibold text-black active:bg-white/80"
              onClick={() => setState('prompt')}
            >
              {t('aiConsent.review')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="h-12 w-full bg-white px-5 text-[16px] font-semibold text-black active:bg-white/80"
                onClick={() => {
                  storeConsent();
                  if (shouldLeaveRedirectRootAfterConsent(window.location.pathname)) {
                    window.location.replace('/home');
                    return;
                  }
                  setState('accepted');
                }}
              >
                {t('aiConsent.allow')}
              </button>
              <button
                type="button"
                className="h-12 w-full px-5 text-[15px] font-medium text-white/52 active:text-white/75"
                onClick={() => setState('declined')}
              >
                {t('aiConsent.notNow')}
              </button>
            </>
          )}
          <a
            href="/privacy"
            className="mt-1 py-2 text-center text-[13px] text-white/42 underline decoration-white/20 underline-offset-4"
          >
            {t('aiConsent.privacy')}
          </a>
        </div>
      </div>
    </main>
  );
}
