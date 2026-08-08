import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';

describe('ModelSelector Seedance 2.5', () => {
  it('shows the model and selects its Evolink 720p default', async () => {
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
    fireEvent.click(await screen.findByText('Seedance 2.5'));
    await waitFor(() => {
      expect(onVideoModelChange).toHaveBeenCalledWith('seedance-2.5');
      expect(onVideoResolutionChange).toHaveBeenCalledWith('720p');
    });
  });
});
