import { describe, expect, it } from 'vitest';
import { publishExternalVideoRanges } from '@/lib/external-video-range';

describe('external Media List publishing', () => {
  it('refreshes an existing stable URL range with richer media understanding', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const existing = [{
      id: 'snapshot-1',
      type: 'video',
      description: 'Old short label',
      sort_order: 1,
      video_meta: {
        origin: 'external-range',
        taskId: null,
        videoUrl: 'https://cdn.example.com/source.mp4?capability=stable',
        providerUrl: 'https://cdn.example.com/source.mp4?capability=stable',
        prompt: 'Old short label',
        sourceSnapshotIds: [],
        sourceUrls: ['https://cdn.example.com/source.mp4?capability=stable'],
        sourceRange: {
          source_url: 'https://cdn.example.com/source.mp4?capability=stable',
          start_sec: 12,
          end_sec: 18,
        },
        status: 'completed',
        duration: 6,
        model: 'external-range',
      },
    }];

    const supabase = {
      from() {
        let selection = '';
        return {
          select(fields: string) { selection = fields; return this; },
          eq() { return this; },
          order() {
            return Promise.resolve({
              data: selection === 'id' ? [{ id: 'snapshot-1' }] : existing,
              error: null,
            });
          },
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      },
    };

    const description = [
      'Worker wraps black grip tape around the racket handle.',
      'Editorial purpose: tactile assembly beat.',
      'Evidence: close-up hand motion | continuous wrapping action.',
    ].join('\n');
    const [published] = await publishExternalVideoRanges({
      supabase: supabase as never,
      projectId: 'project-1',
      ranges: [{
        source_url: 'https://cdn.example.com/source.mp4?capability=stable',
        start: 12,
        end: 18,
        description,
      }],
    });

    expect(published).toMatchObject({
      snapshotId: 'snapshot-1',
      mediaIndex: 1,
      ref: '<<<media_1>>>',
      description,
      created: false,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].description).toBe(description);
    expect(updates[0].video_meta).toMatchObject({
      videoUrl: 'https://cdn.example.com/source.mp4?capability=stable',
      prompt: description,
      sourceRange: {
        source_url: 'https://cdn.example.com/source.mp4?capability=stable',
        start_sec: 12,
        end_sec: 18,
      },
    });
  });
});
