import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';

describe('video replication changelog entry', () => {
  it.each([
    ['zh', '视频复刻：换掉内容，保留原片'],
    ['zh-Hant', '影片復刻：替換內容，保留原片'],
    ['ja', '動画リプリケーション：内容を置き換え、元映像を保つ'],
    ['en', 'Video Replication: Replace the Content, Keep the Original'],
  ])('renders the localized release note in %s', (locale, title) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('describes the simple prompt, fidelity target, and default route', () => {
    render(<Changelog onClose={vi.fn()} locale="en" />);

    expect(screen.getByText(/one ordinary sentence/)).toBeTruthy();
    expect(screen.getByText(/shot order, timing, framing, camera movement/)).toBeTruthy();
    expect(screen.getByText(/Wan 3\.0 Prime at 720p/)).toBeTruthy();
  });
});
