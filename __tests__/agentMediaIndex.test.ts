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
