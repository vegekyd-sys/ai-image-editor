import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';
import { getImageModelCapability, DEFAULT_IMAGE_MODEL } from '@/lib/image-model-capabilities';
afterEach(cleanup);
describe('Seedream 5.5 candidate selector', () => {
  it.each(['zh', 'zh-Hant', 'ja', 'en'] as const)('offers explicit candidate in %s without changing defaults', async locale => {
    localStorage.clear(); localStorage.setItem('locale',locale);
    const changed=vi.fn(); const video=vi.fn();
    render(<LocaleProvider initialLocale={locale}><ModelSelector preferredModel="auto" onModelChange={changed} onVideoModelChange={video}/></LocaleProvider>);
    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(await screen.findByText('Seedream 5.5'));
    expect(changed).toHaveBeenCalledExactlyOnceWith('seedream-5.5');
    expect(video).not.toHaveBeenCalled();
    expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2.6-flare');
    expect(getImageModelCapability('seedream-5.5').autoPriority).toBeUndefined();
  });
});
