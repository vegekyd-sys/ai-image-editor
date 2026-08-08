import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Changelog from '@/components/Changelog';

describe('Seedance 2.5 and MiniMax H3 changelog entries', () => {
  it('keeps both announcements in Chinese and English', () => {
    const { rerender } = render(<Changelog onClose={vi.fn()} locale="zh" />);

    expect(screen.getByText('Seedance 2.5：全新 SOTA 多模态视频')).toBeTruthy();
    expect(screen.getByText('MiniMax H3 视频模型')).toBeTruthy();

    rerender(<Changelog onClose={vi.fn()} locale="en" />);

    expect(screen.getByText('Seedance 2.5: New SOTA Multimodal Video')).toBeTruthy();
    expect(screen.getByText('MiniMax H3 Video')).toBeTruthy();
  });
});
