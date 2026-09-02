import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';

describe('ModelSelector Seedance 2.5', () => {
  it('shows the model and selects its Evolink 720p default', async () => {
    localStorage.setItem('locale', 'zh');
    const onVideoModelChange = vi.fn();
    const onVideoResolutionChange = vi.fn();
    render(
      <LocaleProvider>
        <ModelSelector
          preferredModel="auto"
          onModelChange={vi.fn()}
          videoAuto={false}
          onVideoAutoChange={vi.fn()}
          videoModel="seedance-fast"
          videoResolution="720p"
          onVideoModelChange={onVideoModelChange}
          onVideoResolutionChange={onVideoResolutionChange}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(await screen.findByText(/视频|Video/));
    expect(await screen.findByText('全新 SOTA · 30s')).toBeTruthy();
    expect(screen.getByText(/全新 SOTA，最长 30 秒/)).toBeTruthy();
    expect(screen.getByText('Wan 3.0 标准版')).toBeTruthy();
    expect(screen.getByText('4K · 30s')).toBeTruthy();
    expect(screen.getByText(/自动启用 FlashVSR/)).toBeTruthy();
    expect(screen.getByText('Wan 3.0 Prime')).toBeTruthy();
    expect(screen.getByText('快速 · 4K')).toBeTruthy();
    expect(screen.queryByText('Wan 3.0 Pro')).toBeNull();
    expect(screen.getByText('MiniMax H3')).toBeTruthy();
    fireEvent.click(await screen.findByText('Seedance 2.5'));
    await waitFor(() => {
      expect(onVideoModelChange).toHaveBeenCalledWith('seedance-2.5');
      expect(onVideoResolutionChange).toHaveBeenCalledWith('720p');
    });
  });
});
