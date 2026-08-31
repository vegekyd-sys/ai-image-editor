import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';

describe('fast durable Agent changelog entry', () => {
  it.each([
    ['zh', '启动更快，长任务不断'],
    ['zh-Hant', '啟動更快，長任務不中斷'],
    ['ja', 'すばやく開始、長いタスクも継続'],
    ['en', 'Fast Starts, Durable Long Runs'],
  ])('renders the localized release note in %s', (locale, title) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('keeps the release note to one concise sentence', () => {
    render(<Changelog onClose={vi.fn()} locale="en" />);
    expect(screen.getByText(/reconnect automatically after a refresh/)).toBeTruthy();
  });
});
