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
