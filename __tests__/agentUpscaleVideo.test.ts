import { describe, expect, it } from 'vitest';
import { generateAnimationHarness } from './helpers/generateAnimationHarness';

describe('Agent standalone video enhancement', () => {
  it('uses the selected ready video despite a locked generation model and creates one result', async () => {
    const h = generateAnimationHarness('upscale');
    h.ctx.videoAuto = false;
    h.ctx.videoModel = 'seedance-2.5';
    h.ctx.videoResolution = '480p';
    h.rows[1] = { id: 'source', type: 'video', video_meta: { status: 'completed', videoUrl: 'https://example.com/source.mp4', duration: 10.08 } };
    const result = await h.tool.execute({ media_index: 2, resolution: '4k' }, { toolCallId: 'upscale-1', messages: [] });
    expect(result.success).toBe(true);
    expect(h.createVideo).toHaveBeenCalledTimes(1);
    expect(h.createVideo).toHaveBeenCalledWith(expect.objectContaining({ videoModel: 'bytedance-video-upscale', videoResolution: '4k', videoUrl: 'https://example.com/source.mp4', images: [] }));
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.ctx.pendingVideoSnapshot.videoMeta).toMatchObject({ model: 'bytedance-video-upscale', resolution: '4k' });
    expect(h.deductFixedCredits).toHaveBeenCalledTimes(1);
  });
  it('rejects ambiguous or processing sources before any paid submission', async () => {
    const h = generateAnimationHarness('upscale');
    h.rows[1] = { type: 'video', video_meta: { status: 'processing', videoUrl: 'https://example.com/source.mp4' } };
    expect((await h.tool.execute({ media_index: 2, resolution: '2k' }, { messages: [] })).success).toBe(false);
    expect((await h.tool.execute({ media_index: 2, video_url: 'https://example.com/other.mp4', resolution: '2k' }, { messages: [] })).success).toBe(false);
    expect(h.createVideo).not.toHaveBeenCalled();
    expect(h.deductFixedCredits).not.toHaveBeenCalled();
  });
});
