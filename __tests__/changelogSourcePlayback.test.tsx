import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';

describe('source playback changelog entry', () => {
  it.each([
    ['zh', 'Source 视频合成播放更稳定'],
    ['zh-Hant', 'Source 影片合成播放更穩定'],
    ['ja', 'ソース動画の再生を安定化'],
    ['en', 'Smoother Source Video Playback'],
  ])('renders the two-line release note in %s', (locale, title) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('keeps the release note to exactly two items', () => {
    render(<Changelog onClose={vi.fn()} locale="en" />);
    expect(screen.getByText(/pause the timeline while buffering/)).toBeTruthy();
    expect(screen.getByText(/starts reliably on the first tap/)).toBeTruthy();
  });
});
