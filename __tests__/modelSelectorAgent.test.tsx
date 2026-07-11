import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModelSelector from '@/components/ModelSelector';
import { LocaleProvider } from '@/lib/i18n';

describe('ModelSelector Agent tab', () => {
  it('shows all five models and emits allowlisted Agent preferences', async () => {
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

    for (const id of ['sonnet-4.6', 'sonnet-5', 'opus-4.8', 'grok-4.5', 'deepseek-v4-pro']) {
      expect(await screen.findByTestId(`agent-model-${id}`)).not.toBeNull();
    }
    expect(screen.getByTestId('model-auto-agent').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('model-auto-agent'));
    expect(onAgentModelChange).toHaveBeenCalledWith('sonnet-5');

    fireEvent.click(screen.getByTestId('agent-model-opus-4.8'));
    expect(onAgentModelChange).toHaveBeenCalledWith('opus-4.8');

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
