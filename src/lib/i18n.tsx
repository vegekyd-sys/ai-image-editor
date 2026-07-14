'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_CONFIG,
  detectPreferredLocale,
  getLocaleConfig,
  matchSupportedLocale,
  translate,
  type Locale,
  type Translate,
} from './locales';

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getCookieLocale(): Locale | null {
  const localeCookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('locale='));
  return matchSupportedLocale(localeCookie?.slice('locale='.length));
}

function detectLocale(initialLocale: Locale): Locale {
  if (typeof window === 'undefined') return initialLocale;
  const fromUrl = matchSupportedLocale(new URLSearchParams(window.location.search).get('locale'));
  if (fromUrl) {
    localStorage.setItem('locale', fromUrl);
    return fromUrl;
  }
  const stored = matchSupportedLocale(localStorage.getItem('locale'));
  if (stored) return stored;
  const fromCookie = getCookieLocale();
  if (fromCookie) return fromCookie;
  return detectPreferredLocale(
    navigator.languages?.length ? navigator.languages : [navigator.language],
    initialLocale,
  );
}

function setCookieLocale(l: Locale) {
  document.cookie = `locale=${l}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    // Hydrate from localStorage / navigator on client, then sync to cookie
    const detected = detectLocale(initialLocale);
    queueMicrotask(() => setLocaleState(detected));
    setCookieLocale(detected);
  }, [initialLocale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
    setCookieLocale(l);
  }, []);

  useEffect(() => {
    const config = getLocaleConfig(locale);
    document.documentElement.lang = config.htmlLang;
    document.documentElement.dir = 'ltr';
  }, [locale]);

  const t = useCallback<Translate>((key, ...args) => translate(locale, key, ...args), [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}

/** Locale selector driven by the shared registry. */
export function LocaleToggle({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={t('locale.selector')}
      className={className}
      style={{
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '6px',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '0.65rem',
        letterSpacing: '0.06em',
        padding: '3px 8px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        outline: 'none',
        appearance: 'none',
        WebkitAppearance: 'none',
        paddingRight: '20px',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.35)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
        ...style,
      }}
    >
      {LOCALE_CONFIG.map((option) => (
        <option key={option.code} value={option.code} style={{ background: '#111', color: '#fff' }}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export type { Locale } from './locales';
export {
  LOCALE_CONFIG,
  getLocaleFallbacks,
  getPromptLanguage,
  getReplyLanguageInstruction,
  getTipsLanguageInstruction,
  getTranslationVariants,
  matchSupportedLocale,
  normalizeLocale,
  parseAcceptLanguage,
  pickLocalizedValue,
  translate,
} from './locales';
