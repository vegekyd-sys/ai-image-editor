import { partitionCompositionMediaRefs } from '@/lib/agent-media-index';
import { describe, expect, it } from 'vitest';
import {
  findSnapshotMediaIndex,
  pinAgentMediaUrl,
  rebuildAgentSnapshotUrls,
  snapshotUrlForAgent,
} from '@/lib/agent-media-index';

describe('Agent Media Index synchronization', () => {
  const rows = [
    { id: 'image-1', image_url: 'https://cdn.example.com/image-1.jpg', type: null },
    {
      id: 'video-2',
      image_url: 'https://cdn.example.com/poster.jpg',
      type: 'video',
      video_meta: { videoUrl: 'https://cdn.example.com/final.mp4' },
    },
  ];

  it('uses the playable video URL for video rows', () => {
    expect(snapshotUrlForAgent(rows[1])).toBe('https://cdn.example.com/final.mp4');
  });

  it('rebuilds an empty or partial in-memory index from ordered DB rows', () => {
    expect(rebuildAgentSnapshotUrls(rows, [])).toEqual([
      'https://cdn.example.com/image-1.jpg',
      'https://cdn.example.com/final.mp4',
    ]);
    expect(rebuildAgentSnapshotUrls(rows, ['old-1', 'old-2', 'pending-3'])).toEqual([
      'https://cdn.example.com/image-1.jpg',
      'https://cdn.example.com/final.mp4',
      'pending-3',
    ]);
  });

  it('returns the true one-based timeline index for a published snapshot id', () => {
    expect(findSnapshotMediaIndex(rows, 'video-2')).toBe(2);
    expect(findSnapshotMediaIndex(rows, 'missing')).toBeUndefined();
  });

  it('pins a completed export URL over a temporarily stale timeline placeholder', () => {
    expect(pinAgentMediaUrl([
      'https://cdn.example.com/image-1.jpg',
      'https://cdn.example.com/video-placeholder.jpg',
    ], 2, 'https://cdn.example.com/final.mp4')).toEqual([
      'https://cdn.example.com/image-1.jpg',
      'https://cdn.example.com/final.mp4',
    ]);
  });
});


describe('composition input media types', () => {
  it('does not send extensionless Scene videos to the image decoder', () => {
    const urls = ['https://scenes-ai.com/v1/assets/video/media', 'https://scenes-ai.com/v1/assets/photo/media', 'https://cdn.makaron.app/imports/selfie.jpg'];
    expect(partitionCompositionMediaRefs([1, 2, 3], urls, [
      { type: 'video' }, { type: null }, { type: null },
    ])).toEqual({ stillMediaRefs: [2, 3], skippedVideoRefs: [1] });
  });
  it('uses persisted types before misleading extensions and preserves requested order', () => {
    expect(partitionCompositionMediaRefs([2, 1], ['https://cdn.test/photo.mp4', 'https://cdn.test/clip.jpg'], [
      { type: null }, { type: 'video' },
    ])).toEqual({ stillMediaRefs: [1], skippedVideoRefs: [2] });
  });
  it('retains extension detection for transient media without a stored row', () => {
    expect(partitionCompositionMediaRefs([1, 2], ['https://cdn.test/a.mp4?x=1', 'data:image/jpeg;base64,/9j/'], []))
      .toEqual({ stillMediaRefs: [2], skippedVideoRefs: [1] });
  });
});
