import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';

describe('ModelSelector Seedance Mini', () => {
  it('shows Seedance Mini in the video tab and selects its 480p default', async () => {
    const onVideoModelChange = vi.fn();
    const onVideoResolutionChange = vi.fn();
    const onVideoAutoChange = vi.fn();

    render(
      <LocaleProvider>
        <ModelSelector
          preferredModel="auto"
          onModelChange={vi.fn()}
          videoAuto={false}
          onVideoAutoChange={onVideoAutoChange}
          videoModel="seedance-fast"
          videoResolution="720p"
          onVideoModelChange={onVideoModelChange}
          onVideoResolutionChange={onVideoResolutionChange}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByTestId('model-selector'));

    fireEvent.click(await screen.findByText(/视频|Video/));
    const mini = await screen.findByText('SeeDance 2.0 Mini');
    fireEvent.click(mini);

    await waitFor(() => {
      expect(onVideoAutoChange).toHaveBeenCalledWith(false);
      expect(onVideoModelChange).toHaveBeenCalledWith('seedance-mini');
      expect(onVideoResolutionChange).toHaveBeenCalledWith('480p');
    });
  });

  it('shows MiniMax H3 in the video tab and selects its public 768P default', async () => {
    const onVideoModelChange = vi.fn();
    const onVideoResolutionChange = vi.fn();
    const onVideoAutoChange = vi.fn();

    render(
      <LocaleProvider>
        <ModelSelector
          preferredModel="auto"
          onModelChange={vi.fn()}
          videoAuto={false}
          onVideoAutoChange={onVideoAutoChange}
          videoModel="seedance-fast"
          videoResolution="720p"
          onVideoModelChange={onVideoModelChange}
          onVideoResolutionChange={onVideoResolutionChange}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(await screen.findByText(/视频|Video/));
    fireEvent.click(await screen.findByText('MiniMax H3'));

    await waitFor(() => {
      expect(onVideoAutoChange).toHaveBeenCalledWith(false);
      expect(onVideoModelChange).toHaveBeenCalledWith('minimax-h3');
      expect(onVideoResolutionChange).toHaveBeenCalledWith('768p');
    });
  });
});
