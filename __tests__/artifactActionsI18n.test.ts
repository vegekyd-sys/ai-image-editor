import { describe, expect, it } from 'vitest';
import { buildVideoFailureActions } from '@/lib/artifact-actions';
import type { Locale } from '@/lib/locales';

const expectedCopy: Record<Locale, {
  retryLabel: string;
  explainLabel: string;
  promptFragment: string;
}> = {
  en: {
    retryLabel: 'Make safer & retry',
    explainLabel: 'Review the cause',
    promptFragment: 'The last video generation failed.',
  },
  zh: {
    retryLabel: '改安全点重试',
    explainLabel: '先看原因',
    promptFragment: '刚才这个视频生成失败了',
  },
  'zh-Hant': {
    retryLabel: '調整安全後重試',
    explainLabel: '先查看原因',
    promptFragment: '剛才這個影片產生失敗了',
  },
  ja: {
    retryLabel: '安全に直して再試行',
    explainLabel: '原因を確認',
    promptFragment: '先ほどの動画生成に失敗しました',
  },
};

describe('buildVideoFailureActions i18n', () => {
  for (const locale of Object.keys(expectedCopy) as Locale[]) {
    it(`localizes policy failure actions and submitted prompts for ${locale}`, () => {
      const actions = buildVideoFailureActions({
        error: 'Blocked by safety policy',
        prompt: 'A rooftop chase',
        duration: 15,
        model: 'seedance-fast',
      }, locale);

      expect(actions).toHaveLength(2);
      expect(actions[0].label).toBe(expectedCopy[locale].retryLabel);
      expect(actions[1].label).toBe(expectedCopy[locale].explainLabel);
      expect(actions[0].prompt).toContain(expectedCopy[locale].promptFragment);
      expect(actions[0].prompt).toContain('A rooftop chase');
      expect(actions.every(action => action.policy === 'confirm')).toBe(true);
    });
  }

  it('keeps the English UI and submitted prompt free of fallback Chinese copy', () => {
    const serialized = JSON.stringify(buildVideoFailureActions({
      error: 'Blocked by safety policy',
      prompt: 'A rooftop chase',
    }, 'en'));

    expect(serialized).not.toMatch(/[\u3400-\u9fff]/);
  });

  it('localizes the seedance-mini service fallback action', () => {
    const actions = buildVideoFailureActions({
      error: 'service authentication failed',
      model: 'seedance-mini',
      prompt: 'A quiet street',
    }, 'en');

    expect(actions[0]).toMatchObject({
      label: 'Retry with Fast',
      description: 'Mini service failed; switch to the more reliable Fast model',
      policy: 'confirm',
    });
    expect(actions[0].prompt).toContain('change the model to seedance-fast');
    expect(actions[0].prompt).not.toMatch(/[\u3400-\u9fff]/);
  });

  const matureLabels: Record<Locale, string> = {
    en: 'Retry with Mature Mode',
    zh: '用 Mature Mode 重试',
    'zh-Hant': '用 Mature Mode 重試',
    ja: 'Mature Modeで再試行',
  };

  for (const locale of Object.keys(matureLabels) as Locale[]) {
    it(`offers one explicit Mature Mode retry for a Seedance 2.5 moderation failure in ${locale}`, () => {
      const actions = buildVideoFailureActions({
        error: 'Blocked by content safety policy',
        prompt: 'A fashion film by the pool',
        duration: 30,
        model: 'seedance-2.5',
        contentFilter: true,
      }, locale);

      expect(actions).toHaveLength(2);
      expect(actions[0].label).toBe(matureLabels[locale]);
      expect(actions[1].label).toBe(expectedCopy[locale].explainLabel);
      expect(actions[0].description).toContain('+10%');
      expect(actions[0].prompt).toContain('seedance-2.5');
      expect(actions[0].prompt).toContain('content_filter: false');
      expect(actions[0].prompt).toContain('+10%');
      expect(actions[0].prompt).toContain('A fashion film by the pool');
      expect(actions[0].prompt).toMatch(/once|一次|一度/);
    });
  }

  it('does not offer Mature Mode again after a Mature Mode attempt fails', () => {
    const actions = buildVideoFailureActions({
      error: 'Blocked by content safety policy',
      prompt: 'A fashion film by the pool',
      model: 'seedance-2.5',
      contentFilter: false,
    }, 'en');

    expect(actions[0].label).not.toBe('Retry with Mature Mode');
    expect(JSON.stringify(actions)).not.toContain('content_filter: false');
  });

  it.each([
    'Your input contains a real person. Real people in input images or videos are not supported.',
    'Your input may contain copyrighted or trademarked content (logos, brands, or IP characters).',
  ])('does not offer Mature Mode for a Seedance 2.5 input restriction: %s', error => {
    const actions = buildVideoFailureActions({
      error,
      prompt: 'Use the supplied reference',
      model: 'seedance-2.5',
      contentFilter: true,
    }, 'en');

    expect(actions[0].label).not.toBe('Retry with Mature Mode');
    expect(JSON.stringify(actions)).not.toContain('content_filter: false');
  });
});
