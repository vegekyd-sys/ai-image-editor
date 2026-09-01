import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';

describe('ModelSelector Agent tab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        planType: 'pro',
        weekly: {
          usedPercent: 61,
          remainingPercent: 39,
          windowDurationMins: 10_080,
          resetsAt: 1_788_465_960,
        },
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the GPT-5.6 lineup with no Claude choices and emits allowlisted Agent preferences', async () => {
    const onAgentModelChange = vi.fn();
    render(
      <LocaleProvider>
        <ModelSelector
          preferredModel="auto"
          onModelChange={vi.fn()}
          agentModel="auto"
          onAgentModelChange={onAgentModelChange}
        />
      </LocaleProvider>,
    );

    const trigger = screen.getByTestId('model-selector');
    expect(trigger.getAttribute('data-current-agent-model')).toBe('auto');
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '模型' });
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
    const imageTab = await screen.findByTestId('model-tab-image');
    await waitFor(() => expect(document.activeElement).toBe(imageTab));
    for (const tab of ['image', 'video', 'agent']) {
      const tabElement = screen.getByTestId(`model-tab-${tab}`);
      expect(document.getElementById(tabElement.getAttribute('aria-controls')!)).not.toBeNull();
    }

    const agentTab = await screen.findByTestId('model-tab-agent');
    fireEvent.click(agentTab);
    const agentPanel = await screen.findByRole('tabpanel');
    expect(agentTab.getAttribute('aria-controls')).toBe(agentPanel.id);
    expect(agentPanel.getAttribute('aria-labelledby')).toBe(agentTab.id);

    for (const id of ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'grok-4.6', 'deepseek-v4-pro']) {
      expect(await screen.findByTestId(`agent-model-${id}`)).not.toBeNull();
    }
    expect(screen.queryByTestId('agent-model-grok-4.5')).toBeNull();
    for (const id of ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna']) {
      expect(await screen.findByTestId(`agent-model-${id}-codex-subscription`)).not.toBeNull();
    }
    const providerGroups = Array.from(agentPanel.querySelectorAll('[data-agent-provider-group]'));
    expect(providerGroups.map(group => (
      group.getAttribute('data-agent-provider-group')
    ))).toEqual(['azure', 'codex', 'other']);
    expect(providerGroups[1]?.textContent).toContain('Codex');
    const codexUsage = screen.getByTestId('codex-subscription-usage');
    expect(codexUsage.textContent).toContain('39%');
    expect(codexUsage.classList.contains('mkr-agent-model-group-quota')).toBe(true);
    const codexHeader = codexUsage.closest('[data-agent-provider-group="codex"]');
    expect(codexHeader?.querySelector('.mkr-agent-model-group-reset')?.textContent).toMatch(/Resets|重置/);
    expect(codexHeader?.querySelector('.mkr-agent-model-group-title')?.textContent).toContain('Codex');
    expect(screen.queryByText(/Sonnet|Opus|Claude/i)).toBeNull();
    expect(screen.getByTestId('model-auto-agent').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('model-auto-agent'));
    expect(onAgentModelChange).toHaveBeenCalledWith('gpt-5.6-terra');

    fireEvent.click(screen.getByTestId('agent-model-gpt-5.6-sol'));
    expect(onAgentModelChange).toHaveBeenCalledWith('gpt-5.6-sol');

    fireEvent.keyDown(agentTab, { key: 'ArrowLeft' });
    expect(screen.getByTestId('model-tab-video').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '模型' })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('positions the dialog in layout-viewport coordinates above a mobile keyboard', async () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    vi.stubGlobal('visualViewport', {
      height: 500,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { unmount } = render(
      <LocaleProvider>
        <ModelSelector
          preferredModel="auto"
          onModelChange={vi.fn()}
          agentModel="auto"
          onAgentModelChange={vi.fn()}
        />
      </LocaleProvider>,
    );
    const trigger = screen.getByTestId('model-selector');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 400,
      top: 400,
      right: 132,
      bottom: 432,
      left: 100,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '模型' });
    expect(dialog.style.bottom).toBe('452px');
    expect(dialog.style.maxHeight).toBe('392px');

    unmount();
    vi.unstubAllGlobals();
  });
});
