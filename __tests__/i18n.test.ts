import { describe, expect, it } from 'vitest';
import {
  LOCALE_CONFIG,
  detectPreferredLocale,
  getOutputLanguageRequirement,
  getReplyLanguageInstruction,
  getTipsLanguageInstruction,
  matchSupportedLocale,
  parseAcceptLanguage,
  pickLocalizedValue,
  translate,
  translations,
} from '@/lib/locales';
import { resolveRequestLocale } from '@/lib/server-locale';

describe('i18n locale registry', () => {
  it('registers the four product locales in selector order', () => {
    expect(LOCALE_CONFIG.map((locale) => locale.code)).toEqual(['zh', 'zh-Hant', 'ja', 'en']);
  });

  it.each([
    ['zh-CN', 'zh'],
    ['zh_Hans_SG', 'zh'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh_Hant', 'zh-Hant'],
    ['ja-JP', 'ja'],
    ['en-US', 'en'],
    ['fr-FR', null],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(matchSupportedLocale(input)).toBe(expected);
  });

  it('uses the first supported browser language and a deterministic fallback', () => {
    expect(detectPreferredLocale(['fr-FR', 'ja-JP'])).toBe('ja');
    expect(detectPreferredLocale(['fr-FR'], 'zh-Hant')).toBe('zh-Hant');
  });

  it('orders Accept-Language values by quality while preserving ties', () => {
    expect(parseAcceptLanguage('fr-FR, en-US;q=0.7, ja-JP;q=0.9, zh-TW;q=0')).toEqual([
      'fr-FR',
      'ja-JP',
      'en-US',
    ]);
  });

  it('negotiates the initial server locale from cookie, then Accept-Language', () => {
    expect(resolveRequestLocale('zh-TW', 'ja-JP')).toBe('zh-Hant');
    expect(resolveRequestLocale(null, 'fr-FR, ja-JP;q=0.9')).toBe('ja');
    expect(resolveRequestLocale(null, 'fr-FR', 'zh')).toBe('zh');
  });
});

describe('i18n dictionaries', () => {
  it('keeps every locale in exact key parity with the source dictionary', () => {
    const sourceKeys = Object.keys(translations.zh).sort();
    for (const locale of LOCALE_CONFIG) {
      expect(Object.keys(translations[locale.code]).sort()).toEqual(sourceKeys);
    }
  });

  it('preserves formatter signatures across languages', () => {
    expect(translate('zh', 'video.count', 2)).toBe('视频 · 2 个');
    expect(translate('zh-Hant', 'video.count', 2)).toBe('影片 · 2 個');
    expect(translate('ja', 'video.count', 2)).toBe('動画・2件');
    expect(translate('en', 'video.count', 2)).toBe('2 videos');
  });

  it('translates representative product surfaces in Japanese and Traditional Chinese', () => {
    expect(translate('ja', 'auth.login')).toBe('ログイン');
    expect(translate('ja', 'landing.cta.button')).toBe('Makaronを開く');
    expect(translate('zh-Hant', 'auth.login')).toBe('登入');
    expect(translate('zh-Hant', 'status.videoDone')).toBe('影片已產生');
  });

  it.each([
    ['zh', '创作简报', '正在进行：创作简报', '2 个场景', '打开原始文件'],
    ['zh-Hant', '創作簡報', '正在進行：創作簡報', '2 個場景', '開啟原始檔'],
    ['ja', '制作概要', '進行中：制作概要', '2シーン', '元ファイルを開く'],
    ['en', 'Creative brief', 'In progress: Creative brief', '2 scenes', 'Open source file'],
  ] as const)('translates Studio Run chrome in %s', (locale, stage, current, scenes, openSource) => {
    expect(translate(locale, 'studio.stage.brief')).toBe(stage);
    expect(translate(locale, 'studio.progress.current', stage)).toBe(current);
    expect(translate(locale, 'studio.unit.scenes', 2)).toBe(scenes);
    expect(translate(locale, 'studio.source.open')).toBe(openSource);
  });
});

describe('i18n shared behavior', () => {
  it('uses locale-aware content fallbacks for database labels', () => {
    const labels = { zh: '简体名称', en: 'English label' };
    expect(pickLocalizedValue(labels, 'zh-Hant')).toBe('简体名称');
    expect(pickLocalizedValue(labels, 'ja')).toBe('English label');
  });

  it('keeps AI reply language rules aligned with UI locales', () => {
    expect(getReplyLanguageInstruction('ja')).toContain('natural Japanese only');
    expect(getReplyLanguageInstruction('ja')).toContain('do not reply in Chinese');
    expect(getReplyLanguageInstruction('zh-TW')).toContain('Traditional Chinese only');
    expect(getReplyLanguageInstruction('zh-TW')).toContain('do not use Simplified Chinese');
    expect(getOutputLanguageRequirement('zh')).toBe('SIMPLIFIED CHINESE ONLY');
    expect(getTipsLanguageInstruction('ja')).toBe(
      'IMPORTANT: You MUST output ALL "label" and "desc" fields in Japanese only. Reply in natural Japanese only. Use Japanese kana where natural; do not reply in Chinese. "editPrompt" MUST remain in English only.',
    );
    expect(getTipsLanguageInstruction('zh-TW')).toContain('Traditional Chinese only');
  });
});
