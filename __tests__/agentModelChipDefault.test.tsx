import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentModelChip from '@/components/AgentModelChip';
import { LocaleProvider } from '@/lib/i18n';

afterEach(() => vi.unstubAllGlobals());

describe('configured Auto model presentation', () => {
  it('shows DeepSeek as Auto even when the account has no personal-plan access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ available: false, grokAvailable: false, defaultModelId: 'deepseek-flash', defaultProvider: 'deepseek' }),
    }));
    const onChange = vi.fn();
    render(<LocaleProvider><AgentModelChip value="auto" onChange={onChange} /></LocaleProvider>);
    const trigger = screen.getByTestId('create-agent-model-selector');
    await waitFor(() => expect(trigger.title).toBe('Auto · DeepSeek V4.1 Flash'));
    fireEvent.click(trigger);
    const auto = await screen.findByRole('radio', { name: /Auto · DeepSeek V4.1 Flash/ });
    expect(auto.closest('[data-agent-provider-group="azure"]')).toBeNull();
    fireEvent.click(auto);
    expect(onChange).toHaveBeenCalledWith('auto');
    expect(trigger.title).not.toContain('Luna');
  });

  it('retains an explicitly selected Luna subscription after Auto changes to DeepSeek', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, defaultModelId: 'deepseek-flash', defaultProvider: 'deepseek', codex: { available: true } }),
    }));
    render(<LocaleProvider><AgentModelChip value="gpt-6-luna-codex-subscription" onChange={vi.fn()} /></LocaleProvider>);
    await waitFor(() => expect(screen.getByTestId('create-agent-model-selector').title).toContain('GPT-6 Luna'));
    expect(screen.getByTestId('create-agent-model-selector').title).toContain('Codex');
  });
});
