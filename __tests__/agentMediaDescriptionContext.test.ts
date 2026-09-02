import { describe, expect, it } from 'vitest';
import { buildPromptContext } from '@/lib/agent-context';

class FakeQuery {
  constructor(private readonly data: unknown[]) {}
  select() { return this; }
  eq() { return this; }
  not() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  maybeSingle() { return Promise.resolve({ data: this.data[0] || null, error: null }); }
  then(resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.data, error: null }).then(resolve, reject);
  }
}

function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      return new FakeQuery(tables[table] || []);
    },
  };
}

describe('provider-neutral Media List understanding', () => {
  it('attaches current upload pixels directly for a multimodal Agent without Gemini preflight', async () => {
    const ctx = await buildPromptContext(
      'project-native-vision',
      fakeSupabase({
        snapshots: [{
          id: 'image-1',
          image_url: 'https://cdn.example.com/upload.jpg',
          description: 'Original upload',
          type: 'image',
          design_path: null,
          tips: [],
          sort_order: 0,
          video_meta: null,
          metadata: null,
        }],
        messages: [],
        agent_tool_history: [],
        project_music: [],
      }) as never,
      'user-1',
      {
        userMessage: '这张图里有什么？',
        turnMediaCount: 1,
        supportsImageInput: true,
      },
    );

    expect(ctx.nativeVisionImages).toEqual([
      { source: 'https://cdn.example.com/upload.jpg', mediaIndex: 1 },
    ]);
    expect(ctx.fullPrompt).toContain('attached to this same Agent request');
    expect(ctx.fullPrompt).not.toContain('[Verified current upload');
    expect(ctx.fullPrompt).not.toContain('[analysis failed:');
  });

  it('combines native still images with cached video evidence for a mixed first turn', async () => {
    const ctx = await buildPromptContext(
      'project-mixed-vision',
      fakeSupabase({
        snapshots: [{
          id: 'image-1',
          image_url: 'https://cdn.example.com/upload.jpg',
          description: 'Original upload',
          type: 'image',
          design_path: null,
          tips: [],
          sort_order: 0,
          video_meta: null,
          metadata: null,
        }, {
          id: 'video-2',
          image_url: '/video-placeholder.png',
          description: 'A six-second close-up of a racket handle being wrapped.',
          type: 'video',
          design_path: null,
          tips: [],
          sort_order: 1,
          video_meta: { videoUrl: 'https://cdn.example.com/factory.mp4' },
          metadata: null,
        }],
        messages: [],
        agent_tool_history: [],
        project_music: [],
      }) as never,
      'user-1',
      {
        userMessage: '总结刚上传的素材',
        turnMediaCount: 2,
        supportsImageInput: true,
      },
    );

    expect(ctx.nativeVisionImages).toEqual([
      { source: 'https://cdn.example.com/upload.jpg', mediaIndex: 1 },
    ]);
    expect(ctx.fullPrompt).toContain('[Verified current upload video evidence — 1 item]');
    expect(ctx.fullPrompt).toContain('A six-second close-up of a racket handle being wrapped.');
    expect(ctx.fullPrompt).not.toContain('Original upload\nUse the whole batch as the source set');
  });

  it('passes the full video description to the Agent and teaches selective analysis', async () => {
    const description = [
      'A worker wraps the racket handle with black grip tape.',
      'Editorial purpose: tactile middle beat before the finished product reveal.',
      'Evidence: close-up hand movement | continuous wrapping action.',
      'Boundary confidence: high.',
    ].join('\n');

    const ctx = await buildPromptContext(
      'project-1',
      fakeSupabase({
        snapshots: [{
          id: 'video-1',
          image_url: '/video-placeholder.png',
          description,
          type: 'video',
          design_path: null,
          tips: [],
          sort_order: 0,
          video_meta: {
            videoUrl: 'https://cdn.example.com/factory.mp4',
            duration: 6,
            sourceRange: {
              source_url: 'https://cdn.example.com/factory.mp4',
              start_sec: 12,
              end_sec: 18,
            },
          },
          metadata: null,
        }],
        messages: [],
        agent_tool_history: [],
        project_music: [],
      }) as never,
      'user-1',
      { userMessage: '把这一段放在成片中间' },
    );

    expect(ctx.fullPrompt).toContain(description);
    expect(ctx.fullPrompt).toContain('[Media description policy]');
    expect(ctx.fullPrompt).toContain('regardless of its provider');
    expect(ctx.fullPrompt).toContain('Do not call analyze_image or analyze_video merely to restate content already covered there.');
    expect(ctx.fullPrompt).toContain('Use analyze_video only for missing or uncovered visual scenes/actions.');
    expect(ctx.fullPrompt).not.toContain('provider ===');
    expect(ctx.fullPrompt).not.toContain('Scene-specific');
  });
});
