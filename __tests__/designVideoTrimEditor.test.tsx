import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DesignVideoTrimEditor from '@/components/DesignVideoTrimEditor';

const field = {
  id: 'growthVideo',
  type: 'video' as const,
  label: 'Growth video',
  propKey: 'growthVideoUrl',
  trimBeforePropKey: 'videoTrimBefore',
  trimAfterPropKey: 'videoTrimAfter',
};

describe('DesignVideoTrimEditor source clip behavior', () => {
  it('lays out trim handles against the selected source duration', () => {
    render(
      <DesignVideoTrimEditor
        field={field}
        props={{
          growthVideoUrl: '',
          videoTrimBefore: 165,
          videoTrimAfter: 285,
        }}
        fps={30}
        durationInFrames={360}
        onUpdateProp={vi.fn()}
        onClose={vi.fn()}
        isDesktop={false}
      />,
    );

    const startHandle = screen.getByRole('button', { name: 'Trim start' });
    expect(startHandle.parentElement?.style.left).toContain('45.833');

    act(() => {
      window.dispatchEvent(new CustomEvent('makaron:design-trim-source-metadata', {
        detail: { fieldId: 'growthVideo', durationSeconds: 15.046 },
      }));
    });

    expect(startHandle.parentElement?.style.left).toContain('36.585');
  });

  it('scopes trim playback events to the selected editable video', () => {
    let previewDetail: Record<string, unknown> | null = null;
    const onPreview = (event: Event) => {
      previewDetail = (event as CustomEvent<Record<string, unknown>>).detail;
    };
    window.addEventListener('makaron:design-trim-preview', onPreview);

    render(
      <DesignVideoTrimEditor
        field={field}
        props={{
          growthVideoUrl: '',
          videoTrimBefore: 165,
          videoTrimAfter: 285,
        }}
        fps={30}
        durationInFrames={360}
        onUpdateProp={vi.fn()}
        onClose={vi.fn()}
        isDesktop={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play trim preview' }));

    expect(previewDetail).toMatchObject({
      fieldId: 'growthVideo',
      sourceFrame: 165,
      startFrame: 165,
      endFrame: 285,
      play: true,
    });
    window.removeEventListener('makaron:design-trim-preview', onPreview);
  });
});
