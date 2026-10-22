import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';
import { generateAnimationHarness } from './helpers/generateAnimationHarness';
afterEach(cleanup);
describe('Kling retirement public entrypoints', () => {
  it.each(['zh', 'zh-Hant', 'ja', 'en'])('removes O3 and keeps Kling 4 selectable in %s', async locale => {
    localStorage.setItem('locale', locale);
    const select = vi.fn();
    render(<LocaleProvider><ModelSelector preferredModel="auto" onModelChange={vi.fn()} videoAuto={false} videoModel="kling-4" videoResolution="720p" onVideoModelChange={select}/></LocaleProvider>);
    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.queryByText('Kling O3', {exact:true})).toBeNull();
    fireEvent.click(screen.getByText('Kling 4.0', {exact:true}));
    expect(select).toHaveBeenCalledWith('kling-4');
  });
  it.each([true,false])('rejects a retired Agent model before charging, with auto=%s',async auto=>{
    const h=generateAnimationHarness();
    h.ctx.videoAuto=auto;
    h.ctx.videoModel='kling';
    const result=await h.tool.execute({story_prompt:'Shot 1 (5s): <<<media_1>>> glows.',model:auto?'kling':'kling-4',duration:5});
    expect(result.success).toBe(false);
    expect(result.message).toContain('retired');
    expect(h.createVideo).not.toHaveBeenCalled();
    expect(h.deductFixedCredits).not.toHaveBeenCalled();
  });
});
