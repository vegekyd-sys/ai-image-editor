import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AnimateSheet from '@/components/AnimateSheet';
import { LocaleProvider } from '@/lib/i18n';
import type { AnimationState } from '@/lib/editor/types';
import type { ProjectAnimation, Snapshot } from '@/types';

vi.mock('@/lib/supabase/storage', () => ({
  getThumbnailUrl: (url: string, width: number) => `${url}?w=${width}`,
}));

describe('AnimateSheet inline image preview', () => {
  const animationState: AnimationState = {
    imageUrls: [],
    prompt: '',
    userHint: '',
    taskId: null,
    videoUrl: null,
    status: 'idle',
    error: null,
    duration: null,
    pollSeconds: 0,
    videoModel: 'kling',
  };

  const snapshots: Snapshot[] = [
    {
      id: 'snap-1',
      image: '',
      imageUrl: 'https://example.com/source.jpg',
      tips: [],
      messageId: 'msg-1',
    },
  ];

  const detailAnimation: ProjectAnimation = {
    id: 'anim-1',
    projectId: 'project-1',
    taskId: 'task-1',
    videoUrl: 'https://example.com/video.mp4',
    prompt: '角色：<<<media_1>>>（Codex）',
    snapshotUrls: ['https://example.com/source.jpg'],
    status: 'completed',
    duration: 3,
    createdAt: new Date().toISOString(),
    videoModel: 'kling',
  };

  it('opens the sheet-owned preview from media refs', () => {
    render(
      <LocaleProvider>
        <AnimateSheet
          snapshots={snapshots}
          projectId="project-1"
          onClose={() => {}}
          animationState={animationState}
          onStateChange={() => {}}
          mode="detail"
          detailAnimation={detailAnimation}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByTestId('image-ref-chip-1'));

    const preview = screen.getByTestId('animate-inline-image-preview');
    expect(preview.querySelector('img')?.getAttribute('src')).toBe('https://example.com/source.jpg?w=400');
    expect(screen.queryByTestId('image-ref-preview-1')).toBeNull();
  });

  it('resolves repeated Retake image slots to the current timeline and previews the submitted image', () => {
    const timeline = Array.from({ length: 7 }, (_, i) => ({
      ...snapshots[0], id: String(i + 1), imageUrl: `https://example.com/${i + 1}.png`,
    }));
    const sourceUrl = 'https://example.com/source.mp4';
    const referenceUrl = timeline[6].imageUrl;
    const edit: ProjectAnimation = {
      ...detailAnimation, videoModel: 'seedance-2.5',
      prompt: 'Use <<<image_1>>> then <<<image_2>>> and repeat <<<image_1>>>',
      snapshotUrls: [sourceUrl, referenceUrl, timeline[2].imageUrl],
      retake: { start: 7, end: 20, sourceUrl },
    };
    const detail = (items: Snapshot[]) => (
      <LocaleProvider>
        <AnimateSheet snapshots={items} projectId="project-1" onClose={vi.fn()} animationState={animationState}
          onStateChange={vi.fn()} mode="detail" detailAnimation={edit} />
      </LocaleProvider>
    );
    const { rerender } = render(detail(timeline));
    const chips = screen.getAllByTestId('image-ref-chip-7');
    expect(chips).toHaveLength(2);
    expect(screen.getByTestId('image-ref-chip-3')).toBeTruthy();
    expect(screen.queryByTestId('image-ref-chip-1')).toBeNull();
    fireEvent.click(chips[1]);
    expect(screen.getByTestId('animate-inline-image-preview').querySelector('img')?.src).toBe(referenceUrl + '?w=400');

    rerender(detail(timeline.slice(1)));
    expect(screen.queryByTestId('animate-inline-image-preview')).toBeNull();
    expect(screen.getAllByTestId('image-ref-chip-6')).toHaveLength(2);
    rerender(detail(timeline.slice(0, 6)));
    expect(screen.queryByTestId('image-ref-chip-1')).toBeNull();
    expect(screen.queryByTestId('image-ref-chip-7')).toBeNull();
    expect(screen.getByTestId('image-ref-chip-3')).toBeTruthy();
  });

  it('shows the provider error for a failed Grok video', () => {
    render(
      <LocaleProvider>
        <AnimateSheet
          snapshots={snapshots}
          projectId="project-1"
          onClose={() => {}}
          animationState={animationState}
          onStateChange={() => {}}
          mode="detail"
          detailAnimation={{
            ...detailAnimation,
            taskId: 'xai-request-1',
            videoUrl: null,
            status: 'failed',
            videoModel: 'grok',
            error: 'Generated video rejected by content moderation.',
          }}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('Generated video rejected by content moderation.')).toBeTruthy();
  });
});
