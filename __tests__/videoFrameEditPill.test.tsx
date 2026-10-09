import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoResultCard from '@/components/VideoResultCard';
import type { ProjectAnimation } from '@/types';
import { LocaleProvider } from '@/lib/i18n';

describe('VideoResultCard frame edit pill', () => {
  it('shows a one-click frame edit action for the selected completed video', () => {
    const anim: ProjectAnimation = {
      id: 'video-1',
      projectId: 'project-1',
      taskId: 'task-1',
      videoUrl: 'https://storage.example.com/final.mp4',
      prompt: 'Final clip',
      snapshotUrls: [],
      imageUrl: 'https://storage.example.com/poster.jpg',
      status: 'completed',
      duration: 15,
      createdAt: new Date().toISOString(),
      videoModel: 'seedance-2-fast' as ProjectAnimation['videoModel'],
    };
    const onFrameEdit = vi.fn();

    render(
      <LocaleProvider>
        <VideoResultCard
          animations={[anim]}
          selectedVideoId="video-1"
          onSelectVideo={vi.fn()}
          onCreateNew={vi.fn()}
          onAbandon={vi.fn()}
          onViewDetail={vi.fn()}
          onFrameEdit={onFrameEdit}
          currentTime={8.7}
          currentDuration={15}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByTestId('video-frame-edit-pill').querySelector('button')!);

    expect(screen.getByText(/从这帧改视频|Edit video here/)).toBeTruthy();
    expect(onFrameEdit).toHaveBeenCalledWith(anim, 8.7);
  });
});
