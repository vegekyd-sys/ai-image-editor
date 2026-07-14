import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocaleProvider, LocaleToggle, useLocale } from '@/lib/i18n';

function LocaleProbe() {
  const { locale, t } = useLocale();
  return <div data-testid="locale-probe">{locale}:{t('auth.login')}</div>;
}

describe('LocaleProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'locale=; path=/; max-age=0';
    document.documentElement.lang = 'zh-CN';
  });

  it('uses the server-negotiated locale for the first render', () => {
    render(
      <LocaleProvider initialLocale="ja">
        <LocaleProbe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale-probe').textContent).toBe('ja:ログイン');
  });

  it('hydrates a persisted Japanese locale and renders all registered options', async () => {
    localStorage.setItem('locale', 'ja');

    render(
      <LocaleProvider>
        <LocaleToggle />
        <LocaleProbe />
      </LocaleProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('locale-probe').textContent).toBe('ja:ログイン'));
    expect(document.documentElement.lang).toBe('ja-JP');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '简体中文',
      '繁體中文',
      '日本語',
      'English',
    ]);
  });

  it('persists Traditional Chinese to storage, cookie, and document language', async () => {
    render(
      <LocaleProvider>
        <LocaleToggle />
        <LocaleProbe />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-Hant' } });

    await waitFor(() => expect(screen.getByTestId('locale-probe').textContent).toBe('zh-Hant:登入'));
    expect(localStorage.getItem('locale')).toBe('zh-Hant');
    expect(document.cookie).toContain('locale=zh-Hant');
    expect(document.documentElement.lang).toBe('zh-Hant');
  });
});
