import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';
import { translate } from '@/lib/locales';

describe('Web search changelog', () => {
  it.each(['zh', 'zh-Hant', 'ja', 'en'] as const)('renders the latest entry in %s', (locale) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    const title = translate(locale, 'changelog.webSearch.title');
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getAllByText('2026-10-05')[0].parentElement?.textContent).toContain(title);
    const first = screen.getByText(translate(locale, 'changelog.webSearch.item1'));
    expect(screen.getByText(translate(locale, 'changelog.webSearch.item2'))).toBeTruthy();
    expect(within(first.closest('ul')!).getAllByRole('listitem')).toHaveLength(2);
  });
});
