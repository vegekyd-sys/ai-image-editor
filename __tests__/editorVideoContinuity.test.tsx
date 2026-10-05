import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { dedupeEditorMessages, videoCompletionMessageId } from '@/lib/editor/message-dedupe';
import { getEditorCanvasKey } from '@/lib/editor/canvas-key';

const delivery = (id: string, snapshotId: string, url: string, timestamp = 1): Message => ({
  id, role: 'assistant', timestamp,
  content: `🎬 视频已生成\n${url}\nsnap:${snapshotId}`,
});
afterEach(cleanup);

describe('video completion hydration', () => {
  it('merges restored and live notifications for the same snapshot even when storage rewrites the URL', () => {
    const restored = delivery('video-action-snap-2', 'snap-2', 'https://cdn.test/final.mp4');
    const live = delivery('legacy-client-id', 'snap-2', 'https://cdn.test/enhanced.mp4', 2);
    expect(dedupeEditorMessages([restored, live])).toEqual([restored]);
    expect(dedupeEditorMessages([live, restored])).toHaveLength(1);
  });
  it('keeps different video snapshots, ordinary conversation and failed attempts', () => {
    const success = delivery('done', 'snap-2', 'https://cdn.test/final.mp4');
    const other = delivery('other', 'snap-3', 'https://cdn.test/other.mp4');
    const user = { ...success, id: 'user', role: 'user' as const };
    const discussion = { ...success, id: 'discussion', content: '请修改这个视频\nsnap:snap-2' };
    const failure = { ...success, id: 'failed', content: '⚠️ 生成失败\nsnap:snap-2' };
    expect(dedupeEditorMessages([success, other, user, discussion, failure])).toHaveLength(5);
  });
  it('keeps attachments and completion actions on the surviving notification', () => {
    const withActions = { ...delivery('persisted', 'snap-2', 'https://cdn.test/final.mp4'), content: '🎬 视频已生成\nhttps://cdn.test/final.mp4\nsnap:snap-2\naction:continue' };
    const image = { ...withActions, id: 'separate-image', image: '/poster.png' };
    expect(dedupeEditorMessages([withActions, delivery('live', 'snap-2', 'https://cdn.test/new.mp4'), image])).toEqual([withActions, image]);
  });
  it('preserves ID hydration of an empty streaming row', () => {
    const filled = delivery('same-id', 'snap-2', 'https://cdn.test/final.mp4');
    expect(dedupeEditorMessages([{ ...filled, content: '' }, filled])).toEqual([filled]);
    expect(videoCompletionMessageId('snap-2')).toBe('video-completion-snap-2');
  });
});

describe('canvas continuity across Eco phases', () => {
  it('retains the mounted canvas through enhancement, final playback and poster repair', () => {
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    function Canvas({ stage }: { stage: string }) {
      useEffect(() => { onMount(); return onUnmount; }, []);
      return <div>{stage}</div>;
    }
    function Surface({ stage, videoId = 'snap-2', url, poster = '/source.png' }: {stage: string; videoId?: string; url?: string; poster?: string}) {
      return <Canvas key={getEditorCanvasKey({viewIndex: 1, image: poster, videoId, snapshotVideoUrl: url, annotationMode: false})} stage={stage} />;
    }
    const view = render(<Surface stage="generating" />);
    view.rerender(<Surface stage="upscaling" />);
    view.rerender(<Surface stage="completed" url="https://cdn.test/enhanced.mp4" />);
    view.rerender(<Surface stage="poster repaired" url="https://cdn.test/final.mp4" poster="/final-poster.png" />);
    expect(screen.getByText('poster repaired')).toBeTruthy();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).not.toHaveBeenCalled();
    view.rerender(<Surface stage="different video" videoId="snap-3" />);
    expect(onMount).toHaveBeenCalledTimes(2);
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });
  it('keeps separate image and annotation canvas identities', () => {
    const key = getEditorCanvasKey({viewIndex: 0, image: '/a.png', annotationMode: false});
    expect(getEditorCanvasKey({viewIndex: 0, image: '/b.png', annotationMode: false})).not.toBe(key);
    expect(getEditorCanvasKey({viewIndex: 0, image: '/a.png', annotationMode: true})).not.toBe(key);
  });
});
