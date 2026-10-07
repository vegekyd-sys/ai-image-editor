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
    const retake = vi.fn(), frame = vi.fn(), seek = vi.fn();
    render(<LocaleProvider><VideoResultCard animations={[anim]} selectedVideoId="v" onSelectVideo={vi.fn()} onCreateNew={vi.fn()}
      onAbandon={vi.fn()} onViewDetail={vi.fn()} onRetake={retake} onFrameEdit={frame} onSeek={seek} currentTime={3} currentDuration={12} /></LocaleProvider>);
    fireEvent.click(screen.getByTestId('video-frame-edit-pill').querySelector('button')!);
    const ranges = screen.getAllByRole('slider');
    expect(screen.queryByTestId('video-frame-edit-pill')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    fireEvent.keyDown(ranges[0], { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(ranges[0], { key: 'ArrowRight' });
    fireEvent.keyDown(ranges[0], { key: 'ArrowRight' });
    fireEvent.keyDown(ranges[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(ranges[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(ranges[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(ranges[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(ranges[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(ranges[1], { key: 'ArrowLeft' });
    expect(ranges[0].getAttribute('aria-valuenow')).toBe('4.2');
    expect(ranges[1].getAttribute('aria-valuenow')).toBe('6.4');
    expect(seek).toHaveBeenLastCalledWith(6.4);
    fireEvent.click(screen.getByRole('button', { name: /填写修改要求|Describe the change/ }));
    expect(retake).toHaveBeenCalledWith(anim, 4.2, 6.4);
    expect(frame).not.toHaveBeenCalled();
  });
});
