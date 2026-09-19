import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';

describe('video model changelog entries', () => {
  it('keeps the Seedance and MiniMax announcements in Chinese and English', () => {
    const { rerender } = render(<Changelog onClose={vi.fn()} locale="zh" />);

    expect(screen.getByText('MiniMax H3 Max Turbo 超实时视频')).toBeTruthy();
    expect(screen.getByText('Seedance 2.5：全新 SOTA 多模态视频')).toBeTruthy();
    expect(screen.getByText('MiniMax H3 视频模型')).toBeTruthy();

    rerender(<Changelog onClose={vi.fn()} locale="en" />);

    expect(screen.getByText('Faster-Than-Real-Time Video with MiniMax H3 Max Turbo')).toBeTruthy();
    expect(screen.getByText('Seedance 2.5: New SOTA Multimodal Video')).toBeTruthy();
    expect(screen.getByText('MiniMax H3 Video')).toBeTruthy();
  });

  it.each([
    ['zh-Hant', 'MiniMax H3 Max Turbo 超即時影片'],
    ['ja', 'MiniMax H3 Max Turbo 超リアルタイム動画'],
  ])('renders the H3 Max announcement in %s', (locale, title) => {
    render(<Changelog onClose={vi.fn()} locale={locale} />);
    expect(screen.getByText(title)).toBeTruthy();
  });
});
