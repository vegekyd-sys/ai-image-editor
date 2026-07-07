import { describe, expect, it } from 'vitest';
import type { Snapshot, VideoMeta } from '@/types';
import { isGeneratedVideoSnapshot, isSourceUploadVideoSnapshot } from '@/lib/video-snapshot-kind';

function videoMeta(overrides: Partial<VideoMeta> = {}): VideoMeta {
  return {
    taskId: null,
    videoUrl: 'https://cdn.example.com/source.mp4',
    prompt: '',
    sourceSnapshotIds: [],
    sourceUrls: [],
    status: 'completed',
    duration: 10,
    model: 'upload',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function videoSnapshot(meta: VideoMeta): Snapshot {
  return {
    id: 'snap-video',
    image: '',
    tips: [],
    messageId: '',
    type: 'video',
    videoMeta: meta,
  };
}

describe('video snapshot kind', () => {
  it('treats bare uploaded videos as source material, not generated results', () => {
    const snap = videoSnapshot(videoMeta());

    expect(isSourceUploadVideoSnapshot(snap)).toBe(true);
    expect(isGeneratedVideoSnapshot(snap)).toBe(false);
  });

  it('keeps exported or generated videos in the generated-result bucket', () => {
    const remotionExport = videoSnapshot(videoMeta({
      taskId: 'remotion-export-job-1',
      prompt: 'Materialized Remotion composition',
      sourceSnapshotIds: ['composition-snap'],
    }));
    const providerVideo = videoSnapshot(videoMeta({
      taskId: 'task-unified-1',
      prompt: 'make a cinematic clip',
      model: 'seedance',
      sourceUrls: ['https://cdn.example.com/source.jpg'],
    }));

    expect(isSourceUploadVideoSnapshot(remotionExport)).toBe(false);
    expect(isGeneratedVideoSnapshot(remotionExport)).toBe(true);
    expect(isSourceUploadVideoSnapshot(providerVideo)).toBe(false);
    expect(isGeneratedVideoSnapshot(providerVideo)).toBe(true);
  });
});
