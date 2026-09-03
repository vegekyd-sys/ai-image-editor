// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createVideo } from '@/lib/skills/create-video';
import { preserveOptionalToolFields } from '@/lib/agent-tool-schema';
import { shouldStopAfterTerminalToolFailure } from '@/lib/agent-terminal';
import { generateAnimationHarness, lookbookRequest } from './helpers/generateAnimationHarness';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('video generation intent and one-submit regression', () => {
  it('replays the old all-fields lookbook call in one submit, charging once and keeping media_2', async () => {
    const h = generateAnimationHarness();
    vi.stubEnv('FAL_KEY', 'test-key');
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain('minimax/h3-max-turbo/image-to-video');
      const body = JSON.parse(init.body);
      expect(body.image_url).toBe('https://example.com/generated.jpg');
      expect(body).not.toHaveProperty('replication_contract');
      expect(body.prompt).not.toContain('placeholder');
      expect(body.prompt).not.toContain('temporal performance');
      return new Response(JSON.stringify({ request_id: 'lookbook-once' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    h.createVideo.mockImplementation(createVideo);
    const result = await h.tool.execute(h.tool.inputSchema.parse(lookbookRequest));
    expect(result).toMatchObject({ success: true, taskId: 'fal-h3max-turbo-lookbook-once' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.deductFixedCredits).toHaveBeenCalledTimes(1);
    expect(h.deductFixedCredits.mock.calls[0][1]).toBe(120);
    expect(h.refundCredits).not.toHaveBeenCalled();
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.ctx.pendingVideoSnapshot.videoMeta.sourceUrls).toEqual(['https://example.com/generated.jpg']);
  });

  it.each([undefined, null])('ordinary generation accepts an absent/null contract (%s)', async (contract) => {
    const h = generateAnimationHarness();
    const input = h.tool.inputSchema.parse({ ...lookbookRequest, replication_contract: contract });
    expect((await h.tool.execute(input)).success).toBe(true);
    expect(h.createVideo.mock.calls[0][0].script).toBe(lookbookRequest.story_prompt);
  });

  it('does not let a stray contract change an ordinary model or resolution', async () => {
    const h = generateAnimationHarness();
    await h.tool.execute({ ...lookbookRequest, model: undefined, video_resolution: undefined });
    expect(h.createVideo.mock.calls[0][0]).toMatchObject({ videoModel: 'seedance-fast', videoResolution: '720p' });
  });

  it('requires a real source video for explicit replication before billing', async () => {
    const h = generateAnimationHarness();
    const result = await h.tool.execute({ ...lookbookRequest, video_intent: 'replicate' });
    expect(result.message).toContain('real, ready video');
    expect(h.createVideo).not.toHaveBeenCalled();
    expect(h.deductFixedCredits).not.toHaveBeenCalled();
  });

  it('requires a contract when explicit replication is requested', async () => {
    const h = generateAnimationHarness();
    const result = await h.tool.execute({ ...lookbookRequest, video_intent: 'replicate', replication_contract: null });
    expect(result.message).toContain('requires replication_contract');
    expect(h.createVideo).not.toHaveBeenCalled();
  });

  it('keeps true replication, source video and Prime default working', async () => {
    const h = generateAnimationHarness();
    h.rows[0] = { id: 'source-video', type: 'video', video_meta: { videoUrl: 'https://example.com/source.mp4', duration: 15, width: 1280, height: 720, fileSizeBytes: 1000000 } };
    const result = await h.tool.execute({ ...lookbookRequest, video_intent: 'replicate', model: undefined, video_resolution: undefined,
      replication_contract: { reference_video_media_index: 1, source_duration_seconds: 15, characters: [{ replacement_media_index: 2, source_actor_anchor: 'Dancer in a red jacket opens with a side step', replacement_identity: 'The woman in the supplied generated portrait' }] },
    });
    expect(result.success, result.message).toBe(true);
    expect(h.createVideo.mock.calls[0][0]).toMatchObject({ videoModel: 'wan-3.0-prime', videoResolution: '720p', videoUrls: ['https://example.com/source.mp4'] });
    expect(h.createVideo.mock.calls[0][0].script).toContain('sole and exact temporal performance');
  });

  it('does not silently downgrade true replication when H3 Max is locked', async () => {
    const h = generateAnimationHarness();
    h.rows[0] = { type: 'video', video_meta: { videoUrl: 'https://example.com/source.mp4' } };
    h.ctx.videoAuto = false;
    h.ctx.videoModel = 'minimax-h3-max';
    const result = await h.tool.execute({ ...lookbookRequest, video_intent: 'replicate', model: 'wan-3.0-prime' });
    expect(result.message).toContain('cannot replicate');
    expect(h.createVideo).not.toHaveBeenCalled();
  });

  it('gives concrete feedback once and stops a repeated unchanged constraint', async () => {
    const h = generateAnimationHarness();
    const input = { ...lookbookRequest, story_prompt: 'Shot 1 (15s): Use <<<media_1>>> and <<<media_2>>>.' };
    const first = await h.tool.execute(input);
    const second = await h.tool.execute({ ...input, story_prompt: input.story_prompt + ' Use only the first frame.' });
    expect(first).toMatchObject({ terminal: false, validation: { mediaIndices: [1, 2], replicationEnabled: false } });
    expect(second).toMatchObject({ terminal: true, retryable: false, errorCode: 'video_repeated_validation' });
    expect(shouldStopAfterTerminalToolFailure({ toolResults: [{ output: second }] })).toBe(true);
    expect(h.createVideo).not.toHaveBeenCalled();
    expect(h.deductFixedCredits).not.toHaveBeenCalled();
  });

  it('allows an actual corrected request after the first validation failure', async () => {
    const h = generateAnimationHarness();
    await h.tool.execute({ ...lookbookRequest, story_prompt: 'Shot 1 (15s): <<<media_1>>> and <<<media_2>>>.' });
    expect((await h.tool.execute(lookbookRequest)).success).toBe(true);
    expect(h.createVideo).toHaveBeenCalledTimes(1);
  });
});

describe('Responses optional-field wire contract', () => {
  it('sends strict:false with real video schema and retains local input validation', async () => {
    const h = generateAnimationHarness();
    let request: any;
    const model = createOpenAI({ apiKey: 'test', fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      throw new Error('capture only');
    } }).responses('gpt-5.6-terra');
    await expect(generateText({ model, tools: { generate_animation: h.tool }, prompt: 'capture', maxRetries: 0 })).rejects.toThrow();
    const tool = request.tools[0];
    expect(tool.strict).toBe(false);
    expect(tool.parameters.required).toEqual(['story_prompt']);
    expect(h.tool.inputSchema.safeParse({}).success).toBe(false);
    expect(h.tool.inputSchema.safeParse({ story_prompt: 'A film', duration: 'five' }).success).toBe(false);
  });

  it.each(['azure-openai', 'codex-subscription'])('fixes all optional tools on %s without overriding explicit strict tools', provider => {
    const tools = { optional: { strict: undefined }, explicit: { strict: true } };
    expect(preserveOptionalToolFields(tools, provider)).toMatchObject({ optional: { strict: false }, explicit: { strict: true } });
  });

  it('leaves non-Responses providers unchanged', () => {
    const tools = { optional: { strict: undefined } };
    preserveOptionalToolFields(tools, 'deepseek');
    expect(tools.optional.strict).toBeUndefined();
  });
});
