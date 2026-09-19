import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';
import { IMAGE_MODEL_IDS } from '@/lib/models/types';
import { getImageModels } from '@/lib/model-registry';

describe('Wan model selector', () => {
  it('shares the canonical model id with the backend and tool schemas', () => {
    expect(IMAGE_MODEL_IDS).toContain('wan2.7-image');
    expect(getImageModels().filter(m => m.id === 'wan2.7-image')).toHaveLength(1);
  });
  it('is opt-in and selects Wan without changing video settings', async () => {
    const onModelChange = vi.fn();
    const onVideoModelChange = vi.fn();
    render(<LocaleProvider><ModelSelector preferredModel="auto" onModelChange={onModelChange} videoModel="seedance-fast" videoResolution="720p" onVideoModelChange={onVideoModelChange} onVideoResolutionChange={vi.fn()} /></LocaleProvider>);
    expect(onModelChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(await screen.findByText('Wan 2.7 Image'));
    expect(onModelChange).toHaveBeenCalledWith('wan2.7-image');
    expect(onVideoModelChange).not.toHaveBeenCalled();
  });
});
