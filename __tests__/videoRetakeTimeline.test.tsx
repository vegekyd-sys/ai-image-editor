import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import VideoResultCard from '@/components/VideoResultCard';
import { LocaleProvider } from '@/lib/i18n';
import type { ProjectAnimation } from '@/types';
afterEach(cleanup);
describe('Retake entry', () => {
  it('selects a precise interval and passes it without capturing a screenshot', () => {
    const anim = { id: 'v', projectId: 'p', taskId: '', videoUrl: 'https://example.com/v.mp4', prompt: '', snapshotUrls: [],
      status: 'completed', duration: 12, createdAt: new Date().toISOString() } as ProjectAnimation;
    const retake = vi.fn(), frame = vi.fn();
    render(<LocaleProvider><VideoResultCard animations={[anim]} selectedVideoId="v" onSelectVideo={vi.fn()} onCreateNew={vi.fn()}
      onAbandon={vi.fn()} onViewDetail={vi.fn()} onRetake={retake} onFrameEdit={frame} currentTime={3} currentDuration={12} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('video-frame-edit-pill').querySelector('button')!);
    const ranges = screen.getAllByRole('slider');
    fireEvent.change(ranges[0], { target: { value: '4.2' } });
    fireEvent.change(ranges[1], { target: { value: '6.4' } });
    fireEvent.click(screen.getByText(/填写修改要求|Describe the change/));
    expect(retake).toHaveBeenCalledWith(anim, 4.2, 6.4);
    expect(frame).not.toHaveBeenCalled();
  });
});
