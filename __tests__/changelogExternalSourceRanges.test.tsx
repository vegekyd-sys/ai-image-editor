import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';

describe('external source ranges changelog entry', () => {
  it.each([
    ['zh', '外部视频直接剪辑'],
    ['zh-Hant', '外部影片直接剪輯'],
    ['ja', '外部動画を直接編集'],
    ['en', 'Edit External Video Sources Directly'],
  ])('renders the release note in %s', (locale, title) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    expect(screen.getByText(title)).toBeTruthy();
  });
});
