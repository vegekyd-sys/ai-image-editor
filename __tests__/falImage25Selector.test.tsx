import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';
import { IMAGE_MODEL_IDS } from '@/lib/models/types';
import { getImageModels } from '@/lib/model-registry';

afterEach(cleanup);
describe('Image 2.5 model selector', () => {
  it('shows Flare for legacy selections without offering the retired Image 2 option', () => {
    render(<LocaleProvider><ModelSelector preferredModel="openai" onModelChange={vi.fn()} /></LocaleProvider>);
    expect(screen.getByTestId('model-selector').getAttribute('aria-label')).toContain('GPT Image 2.5 Flare');
    expect(getImageModels().some(model => model.id === 'openai')).toBe(false);
  });
  it('shares the canonical model id with the backend and tool schemas', () => {
    expect(IMAGE_MODEL_IDS).toContain('gpt-image-2.5-flare');
    expect(getImageModels().filter(m => m.id === 'gpt-image-2.5-flare')).toHaveLength(1);
  });
  it('is opt-in and selects Wan without changing video settings', async () => {
    const onModelChange = vi.fn();
    const onVideoModelChange = vi.fn();
    render(<LocaleProvider><ModelSelector preferredModel="auto" onModelChange={onModelChange} videoModel="seedance-fast" videoResolution="720p" onVideoModelChange={onVideoModelChange} onVideoResolutionChange={vi.fn()} /></LocaleProvider>);
    expect(onModelChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(await screen.findByText('GPT Image 2.5 Flare'));
    expect(onModelChange).toHaveBeenCalledWith('gpt-image-2.5-flare');
    expect(onVideoModelChange).not.toHaveBeenCalled();
  });
});
