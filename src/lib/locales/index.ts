import en from './en';
import ja from './ja';
import zh from './zh';
import zhHant from './zh-Hant';

export const DEFAULT_LOCALE = 'zh' as const;

export const LOCALE_CONFIG = [
  {
    code: 'zh',
    htmlLang: 'zh-CN',
    label: '简体中文',
    shortLabel: '简中',
    aliases: ['zh', 'zh-cn', 'zh-sg', 'zh-hans'],
    fallbacks: ['zh', 'en'],
    promptLanguage: 'Simplified Chinese',
  },
  {
    code: 'zh-Hant',
    htmlLang: 'zh-Hant',
    label: '繁體中文',
    shortLabel: '繁中',
    aliases: ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'],
    fallbacks: ['zh-Hant', 'zh', 'en'],
    promptLanguage: 'Traditional Chinese',
  },
  {
    code: 'ja',
    htmlLang: 'ja-JP',
    label: '日本語',
    shortLabel: '日本語',
    aliases: ['ja', 'ja-jp'],
    fallbacks: ['ja', 'en'],
    promptLanguage: 'Japanese',
  },
  {
    code: 'en',
    htmlLang: 'en',
    label: 'English',
    shortLabel: 'EN',
    aliases: ['en', 'en-us', 'en-gb'],
    fallbacks: ['en'],
    promptLanguage: 'English',
  },
] as const;

export type Locale = (typeof LOCALE_CONFIG)[number]['code'];
export type TranslationKey = keyof typeof zh;
export type TranslationDictionary = {
  [K in TranslationKey]: typeof zh[K] extends (...args: infer Args) => unknown
    ? (...args: Args) => string
    : string;
};
export type TranslationArgs<K extends TranslationKey> =
  TranslationDictionary[K] extends (...args: infer Args) => string ? Args : [];
export type Translate = <K extends TranslationKey>(key: K, ...args: TranslationArgs<K>) => string;

export const translations = {
  zh,
  'zh-Hant': zhHant,
  ja,
  en,
} satisfies Record<Locale, TranslationDictionary>;

const aliasToLocale = new Map<string, Locale>(
  LOCALE_CONFIG.flatMap((config) => config.aliases.map((alias) => [alias, config.code] as const)),
);

export function matchSupportedLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;

  const exact = aliasToLocale.get(normalized);
  if (exact) return exact;
  if (normalized.startsWith('zh-hant') || /^zh-(tw|hk|mo)(-|$)/.test(normalized)) return 'zh-Hant';
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

export function normalizeLocale(
  value: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  return matchSupportedLocale(value) ?? fallback;
}

export function detectPreferredLocale(
  languages: readonly string[] | null | undefined,
  fallback: Locale = 'en',
): Locale {
  for (const language of languages ?? []) {
    const matched = matchSupportedLocale(language);
    if (matched) return matched;
  }
  return fallback;
}

export function parseAcceptLanguage(header: string | null | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((part, index) => {
      const [language = '', ...parameters] = part.trim().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const parsedQuality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
      return {
        language: language.trim(),
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
        index,
      };
    })
    .filter((entry) => entry.language && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.language);
}

export function getLocaleConfig(locale: Locale) {
  return LOCALE_CONFIG.find((config) => config.code === locale) ?? LOCALE_CONFIG[0];
}

export function getLocaleFallbacks(locale: Locale): readonly Locale[] {
  return getLocaleConfig(locale).fallbacks;
}

export function getPromptLanguage(locale: string | null | undefined): string {
  return getLocaleConfig(normalizeLocale(locale, 'en')).promptLanguage;
}

export function getReplyLanguageInstruction(locale: string | null | undefined): string {
  switch (normalizeLocale(locale, 'en')) {
    case 'ja':
      return 'Reply in natural Japanese only. Use Japanese kana where natural; do not reply in Chinese.';
    case 'zh-Hant':
      return 'Reply in Traditional Chinese only. Use Traditional Chinese characters; do not use Simplified Chinese.';
    case 'zh':
      return 'Reply in Simplified Chinese only.';
    default:
      return 'Reply in English only.';
  }
}

export function getOutputLanguageRequirement(locale: string | null | undefined): string {
  return `${getPromptLanguage(locale).toUpperCase()} ONLY`;
}

export function getTipsLanguageInstruction(locale: string | null | undefined): string {
  const replyRule = getReplyLanguageInstruction(locale);
  return `IMPORTANT: You MUST output ALL "label" and "desc" fields in ${getPromptLanguage(locale)} only. ${replyRule} "editPrompt" MUST remain in English only.`;
}

export function pickLocalizedValue(
  values: Record<string, string | null | undefined> | null | undefined,
  locale: Locale,
  fallback = '',
): string {
  if (!values) return fallback;
  for (const candidate of getLocaleFallbacks(locale)) {
    const value = values[candidate];
    if (value) return value;
  }
  return fallback;
}

export function translate<K extends TranslationKey>(
  locale: Locale,
  key: K,
  ...args: TranslationArgs<K>
): string {
  const dictionary = translations[locale] ?? translations[DEFAULT_LOCALE];
  const value = dictionary[key] ?? translations[DEFAULT_LOCALE][key];
  if (typeof value === 'function') {
    return String((value as (...params: unknown[]) => unknown)(...(args as unknown[])));
  }
  return String(value ?? key);
}

export function getTranslationVariants<K extends TranslationKey>(
  key: K,
  ...args: TranslationArgs<K>
): string[] {
  return LOCALE_CONFIG.map((locale) => translate(locale.code, key, ...args));
}
