import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TipsBar from '@/components/TipsBar';
import { LocaleProvider } from '@/lib/i18n';
import type { Tip } from '@/types';

function renderTipsBar(props: Partial<React.ComponentProps<typeof TipsBar>> = {}) {
  const defaults: React.ComponentProps<typeof TipsBar> = {
    tips: [],
    isLoading: false,
    isEditing: false,
    onTipClick: vi.fn(),
    previewingIndex: null,
    onRetryAll: vi.fn(),
  };

  return render(
    <LocaleProvider>
      <TipsBar {...defaults} {...props} />
    </LocaleProvider>
  );
}

describe('TipsBar empty state', () => {
  it('shows a manual reload action even when no failed category is recorded', () => {
    const onRetryAll = vi.fn();
    renderTipsBar({ onRetryAll });

    const reload = screen.getByRole('button', { name: '重新加载修图建议' });
    fireEvent.click(reload);

    expect(onRetryAll).toHaveBeenCalledOnce();
  });

  it('keeps the carousel height stable between empty and populated states', () => {
    const sampleTip: Tip = {
      emoji: '✨',
      label: 'Clean light',
      desc: 'Make the lighting cleaner.',
      category: 'enhance',
      editPrompt: 'Improve the light while preserving the subject.',
      previewStatus: 'none',
    };

    const { container, rerender } = renderTipsBar({ tips: [] });
    const emptyCarousel = container.querySelector('[data-testid="tips-bar"] > div');
    expect(emptyCarousel?.className).toContain('h-[86px]');

    rerender(
      <LocaleProvider>
        <TipsBar
          tips={[sampleTip]}
          isLoading={false}
          isEditing={false}
          onTipClick={vi.fn()}
          previewingIndex={null}
          onRetryAll={vi.fn()}
        />
      </LocaleProvider>
    );
    const populatedCarousel = container.querySelector('[data-testid="tips-bar"] > div');
    expect(populatedCarousel?.className).toContain('h-[86px]');
  });
});
