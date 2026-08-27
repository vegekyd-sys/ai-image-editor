import { describe, expect, it } from 'vitest';
import { detectExternalMediaType, publishExternalVideoRanges } from '@/lib/external-video-range';

function emptyMediaListSupabase() {
  const inserted: Array<Record<string, unknown>> = [];
  let sortOrder = 0;
  return {
    inserted,
    client: {
      rpc() {
        sortOrder += 1;
        return Promise.resolve({ data: sortOrder, error: null });
      },
      from() {
        let selection = '';
        return {
          select(fields: string) { selection = fields; return this; },
          eq() { return this; },
          order() {
            return Promise.resolve({
              data: selection === 'id' ? inserted.map(row => ({ id: row.id })) : [],
              error: null,
            });
          },
          insert(payload: Record<string, unknown>) {
            inserted.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

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
        type: 'video',
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

  it('publishes a declared Scene image as a normal image snapshot with no fake range', async () => {
    const supabase = emptyMediaListSupabase();
    const [published] = await publishExternalVideoRanges({
      supabase: supabase.client as never,
      projectId: 'project-1',
      ranges: [{
        source_url: 'https://scenes-ai.com/v1/assets/photo/media',
        type: 'image',
        description: 'AFF Tokyo product photo',
      }],
      fetchImpl: (() => { throw new Error('declared type must not be fetched'); }) as typeof fetch,
    });

    expect(published).toMatchObject({
      mediaIndex: 1,
      ref: '<<<media_1>>>',
      type: 'image',
      url: 'https://scenes-ai.com/v1/assets/photo/media',
      description: 'AFF Tokyo product photo',
      created: true,
    });
    expect(published.sourceRange).toBeUndefined();
    expect(supabase.inserted[0]).toMatchObject({
      project_id: 'project-1',
      image_url: 'https://scenes-ai.com/v1/assets/photo/media',
      description: 'AFF Tokyo product photo',
    });
    expect(supabase.inserted[0]).not.toHaveProperty('type');
    expect(supabase.inserted[0]).not.toHaveProperty('video_meta');
  });

  it('detects an image for an old CLI payload that omitted type', async () => {
    const supabase = emptyMediaListSupabase();
    const fetchImpl = (async () => new Response(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      { status: 206, headers: { 'content-type': 'application/octet-stream' } },
    )) as typeof fetch;
    const [published] = await publishExternalVideoRanges({
      supabase: supabase.client as never,
      projectId: 'project-legacy-cli',
      ranges: [{
        source_url: 'https://scenes-ai.com/v1/assets/extensionless/media',
        start: 0,
        end: 1,
        description: 'Legacy CLI image',
      }],
      fetchImpl,
    });

    expect(published.type).toBe('image');
    expect(published.sourceRange).toBeUndefined();
    expect(supabase.inserted[0].image_url).toBe('https://scenes-ai.com/v1/assets/extensionless/media');
  });

  it('uses response MIME before file bytes', async () => {
    const methods: Array<string | undefined> = [];
    const detected = await detectExternalMediaType(
      'https://cdn.example.com/asset',
      (async (_url: string | URL | Request, init?: RequestInit) => {
        methods.push(init?.method);
        return new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } });
      }) as typeof fetch,
    );
    expect(detected).toBe('video');
    expect(methods).toEqual(['HEAD']);
  });
});
