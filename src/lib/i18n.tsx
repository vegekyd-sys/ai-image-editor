'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import zh from './locales/zh';
import en from './locales/en';

type Locale = 'zh' | 'en';

// Union of all translation values (string or function)
type Translations = typeof zh;
type TKey = keyof Translations;

// Resolved value: if function, return its return type; otherwise string
type TValue<K extends TKey> = Translations[K] extends (...args: infer A) => infer R
  ? (...args: A) => R
  : string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: <K extends TKey>(key: K, ...args: Translations[K] extends (...a: infer A) => unknown ? A : []) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const translations: Record<Locale, Translations> = { zh, en: en as unknown as Translations };

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  const stored = localStorage.getItem('locale') as Locale | null;
  if (stored === 'zh' || stored === 'en') return stored;
  const lang = navigator.language || '';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function setCookieLocale(l: Locale) {
  document.cookie = `locale=${l}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh'); // SSR-safe default

  useEffect(() => {
    // Hydrate from localStorage / navigator on client, then sync to cookie
    const detected = detectLocale();
    setLocaleState(detected);
    setCookieLocale(detected);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
    setCookieLocale(l);
  }, []);

  const t = useCallback(<K extends TKey>(
    key: K,
    ...args: Translations[K] extends (...a: infer A) => unknown ? A : []
  ): string => {
    const dict = translations[locale] ?? translations.zh;
    const val = dict[key] ?? translations.zh[key];
    if (typeof val === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return String((val as (...a: unknown[]) => unknown)(...(args as unknown[])));
    }
    return String(val ?? key);
  }, [locale]);

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

/** Locale selector — shows current language, allows switching via dropdown */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as 'zh' | 'en')}
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
      }}
    >
      <option value="zh" style={{ background: '#111', color: '#fff' }}>中文</option>
      <option value="en" style={{ background: '#111', color: '#fff' }}>English</option>
    </select>
  );
}
