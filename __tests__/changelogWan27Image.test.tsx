import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';
import { translate } from '@/lib/locales';

describe('Wan 2.7 Image changelog', () => {
  it.each(['zh', 'zh-Hant', 'ja', 'en'] as const)('renders both release lines in %s', (locale) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    expect(screen.getByText(translate(locale, 'changelog.wan27Image.title'))).toBeTruthy();
    const first = screen.getByText(translate(locale, 'changelog.wan27Image.item1'));
    expect(screen.getByText(translate(locale, 'changelog.wan27Image.item2'))).toBeTruthy();
    expect(within(first.closest('ul')!).getAllByRole('listitem')).toHaveLength(2);
  });
});
