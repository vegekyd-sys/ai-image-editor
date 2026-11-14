// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { buildPromptContext } from '@/lib/agent-context';

const analyze = vi.hoisted(() => vi.fn(async (_url: string, _question: string) => '0–12s: colorful puppet band dances on a bright stage. 12–15s: a large Chinese product title fills the stage.'));
vi.mock('@/lib/gemini', () => ({ analyzeVideoContent: analyze, analyzeImageContent: vi.fn() }));

it('prepares original image bytes and video evidence while history loads, and awaits both before planning', async () => {
  let releaseHistory!: () => void;
  const historyReady = new Promise<void>(resolve => { releaseHistory = resolve; });
  const updates: unknown[] = [];
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchMock);
  class Query {
    constructor(private table: string) {}
    select() { return this; } eq() { return this; } not() { return this; }
    in() { return this; } order() { return this; } limit() { return this; } range() { return this; }
    update(value: unknown) { updates.push(value); return this; }
    maybeSingle() { return Promise.resolve({ data: null, error: null }); }
    async then(resolve: (result: {data: unknown[]; error: null}) => unknown) {
      if (this.table === 'messages') await historyReady;
      return resolve({ data: this.table === 'snapshots' && updates.length === 0 ? [{
        id: 'still', type: 'image', image_url: 'https://cdn.makaron.app/storage/v1/object/public/images/test.png',
        description: 'Original upload', sort_order: 0,
      }, {
        id: 'source', type: 'video', image_url: 'https://example.com/poster.jpg',
        video_meta: { videoUrl: 'https://example.com/video.mp4' }, description: 'video snapshot', sort_order: 0,
      }] : [], error: null });
    }
  }
  const result = buildPromptContext('project', { from: (table: string) => new Query(table) } as never, 'user', {
    userMessage: '比较开头和结尾', supportsImageInput: true, agentModelId: 'deepseek-flash', turnMediaCount: 2,
  });
  try {
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
    expect(analyze.mock.calls[0][1]).toContain('Reserve space for the final scene');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseHistory();
    const context = await result;
    expect(context.fullPrompt).toContain('12–15s: a large Chinese product title');
    expect(context.nativeVisionImages).toEqual([{ mediaIndex: 1, source: 'data:image/png;base64,AQID', transportPrepared: true }]);
    expect(updates).toHaveLength(1);
  } finally { releaseHistory(); vi.unstubAllGlobals(); }
});
