'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { normalizeLocale, translate } from '@/lib/locales';

const changelogGlassStyle: CSSProperties = {
  background:
    'linear-gradient(180deg, rgba(46,47,56,0.68), rgba(17,18,24,0.75) 48%, rgba(7,8,11,0.86))',
  border: '0.5px solid rgba(255,255,255,0.11)',
  boxShadow:
    '0 24px 64px rgba(0,0,0,0.50), inset 0 0.5px 0 rgba(255,255,255,0.14), inset 0 -16px 30px rgba(0,0,0,0.22)',
  backdropFilter: 'blur(32px) saturate(158%) contrast(106%)',
  WebkitBackdropFilter: 'blur(32px) saturate(158%) contrast(106%)',
  isolation: 'isolate',
};

const changelogGlassHighlightStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  borderRadius: 'inherit',
  background:
    'radial-gradient(circle at 18% -8%, rgba(255,255,255,0.18), rgba(255,255,255,0.045) 24%, transparent 52%), linear-gradient(126deg, rgba(255,255,255,0.058), rgba(255,255,255,0.014) 36%, rgba(236,72,153,0.028) 74%, rgba(34,211,238,0.022))',
  mixBlendMode: 'screen',
  opacity: 0.66,
};

const changelogGlassEdgeStyle: CSSProperties = {
  position: 'absolute',
  inset: 1,
  pointerEvents: 'none',
  borderRadius: 'inherit',
  boxShadow:
    'inset 0 0 0 0.5px rgba(255,255,255,0.045), inset 0 10px 18px rgba(255,255,255,0.032), inset 0 -0.5px 0 rgba(0,0,0,0.34), inset 1px 0 0 rgba(56,189,248,0.032), inset -1px 0 0 rgba(236,72,153,0.034)',
};

const iOSAppTopGap = 'max(96px, calc(env(safe-area-inset-top, 0px) + 40px))';
const iOSAppBottomGap = 'max(14px, env(safe-area-inset-bottom, 0px))';

export default function ChangelogDialog({ onClose, locale, children }: { onClose: () => void; locale: string; children: ReactNode }) {
  const normalizedLocale = normalizeLocale(locale, 'en');
  const heading = translate(normalizedLocale, 'changelog.heading');
  const closeLabel = translate(normalizedLocale, 'changelog.close');
  const [isIOSApp, setIsIOSApp] = useState(false);

  useEffect(() => {
    setIsIOSApp(document.documentElement.classList.contains('makaron-ios-app') || navigator.userAgent.includes('MakaronIOS'));
  }, []);

  return (
    <div
      data-home-overlay="true"
      className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center"
      onClick={onClose}
      style={isIOSApp ? {
        boxSizing: 'border-box',
        paddingTop: iOSAppTopGap,
        paddingBottom: iOSAppBottomGap,
      } : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.065), transparent 32%), rgba(0,0,0,0.54)',
          backdropFilter: 'blur(5px) saturate(120%)',
          WebkitBackdropFilter: 'blur(5px) saturate(120%)',
        }}
      />

      {/* Modal */}
      <div
        className={isIOSApp
          ? 'relative w-[calc(100%-24px)] max-w-xl rounded-[22px] overflow-hidden flex flex-col'
          : 'relative mb-2 w-[calc(100%-24px)] max-w-xl max-h-[calc(100dvh-64px)] rounded-[22px] sm:mb-0 sm:mx-4 sm:max-h-[80dvh] overflow-hidden flex flex-col'
        }
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        style={{
          ...changelogGlassStyle,
          maxHeight: isIOSApp ? `calc(100dvh - ${iOSAppTopGap} - ${iOSAppBottomGap})` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={changelogGlassHighlightStyle} />
        <div style={changelogGlassEdgeStyle} />

        {/* Header */}
        <div
          className="relative z-[1] flex-shrink-0 flex items-center justify-between px-5 py-4"
          style={{
            borderBottom: '0.5px solid rgba(255,255,255,0.07)',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))',
          }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full"
              style={{
                color: 'rgba(255,255,255,0.76)',
                background: 'rgba(255,255,255,0.045)',
                border: '0.5px solid rgba(255,255,255,0.08)',
                boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.12)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v3" />
                <path d="M12 18v3" />
                <path d="M3 12h3" />
                <path d="M18 12h3" />
                <path d="m6.4 6.4 2.1 2.1" />
                <path d="m15.5 15.5 2.1 2.1" />
                <path d="m17.6 6.4-2.1 2.1" />
                <path d="m8.5 15.5-2.1 2.1" />
              </svg>
            </span>
            <h2 className="text-base font-semibold" style={{ color: 'rgba(255,255,255,0.88)' }}>
              {heading}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={closeLabel}
            className="w-7 h-7 flex items-center justify-center rounded-full"
            style={{
              background: 'rgba(255,255,255,0.045)',
              border: '0.5px solid rgba(255,255,255,0.08)',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.12)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>

        {/* Scrollable entries */}
        <div className="relative z-[1] flex-1 overflow-y-auto overscroll-contain px-5 pb-6" style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
