'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
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
  variant = 'compact',
}: {
  className?: string;
  style?: CSSProperties;
  variant?: 'compact' | 'menu';
}) {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<CSSProperties | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const current = getLocaleConfig(locale);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') return;

    const rect = trigger.getBoundingClientRect();
    const gutter = 12;
    const desiredWidth = variant === 'menu' ? Math.max(208, rect.width) : 196;
    const width = Math.min(desiredWidth, window.innerWidth - gutter * 2);
    const estimatedHeight = LOCALE_CONFIG.length * 44 + 10;
    const canOpenUp = rect.top >= estimatedHeight + gutter + 8;
    const shouldOpenUp = rect.bottom + 8 + estimatedHeight > window.innerHeight - gutter && canOpenUp;
    const top = shouldOpenUp
      ? Math.max(gutter, rect.top - estimatedHeight - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - gutter);
    const left = Math.min(
      Math.max(gutter, rect.right - width),
      window.innerWidth - width - gutter,
    );

    setPopoverPosition({ top, left, width });
  }, [variant]);

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const handleViewportChange = () => updatePopoverPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open || !popoverPosition) return;
    const selectedIndex = LOCALE_CONFIG.findIndex((option) => option.code === locale);
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [locale, open, popoverPosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const closeAndFocusTrigger = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const selectLocale = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    closeAndFocusTrigger();
  }, [closeAndFocusTrigger, setLocale]);

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % LOCALE_CONFIG.length;
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + LOCALE_CONFIG.length) % LOCALE_CONFIG.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = LOCALE_CONFIG.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTrigger();
      return;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`mkr-locale-selector mkr-locale-selector-${variant}`}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('locale.selector')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="locale-selector-trigger"
        className={`mkr-locale-trigger mkr-locale-trigger-${variant}${className ? ` ${className}` : ''}`}
        style={style}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeAndFocusTrigger();
          }
        }}
      >
        <span className="mkr-locale-trigger-leading">
          {variant === 'menu' && (
            <svg className="mkr-locale-globe" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a14 14 0 0 1 0 18" />
              <path d="M12 3a14 14 0 0 0 0 18" />
            </svg>
          )}
          <span className="mkr-locale-trigger-label">
            {variant === 'menu' ? current.label : current.shortLabel}
          </span>
        </span>
        <svg className="mkr-locale-chevron" data-open={open ? 'true' : 'false'} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && popoverPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          id={menuId}
          role="menu"
          aria-label={t('locale.selector')}
          data-makaron-locale-popover="true"
          className="mkr-locale-popover"
          style={popoverPosition}
        >
          {LOCALE_CONFIG.map((option, index) => {
            const selected = option.code === locale;
            return (
              <button
                key={option.code}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                data-selected={selected ? 'true' : 'false'}
                className="mkr-locale-option"
                onClick={() => selectLocale(option.code)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="mkr-locale-option-label">{option.label}</span>
                <span className="mkr-locale-option-check" aria-hidden="true">
                  {selected && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
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
