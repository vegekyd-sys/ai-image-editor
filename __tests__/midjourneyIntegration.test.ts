// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { planImageGeneration } from '@/lib/image-model-capabilities';
import { collectMidjourneyBatch, midjourneyOptions } from '@/lib/models/midjourney';
import { isLocalMidjourneyRequest } from '@/lib/midjourney-local-access';
import type { MidjourneyTask } from '@/lib/midjourney';

const complete: MidjourneyTask = { model: 'mj-v8.2', taskId: 'task-accepted', status: 'completed', providerCostUsd: .08,
  images: Array.from({ length: 4 }, (_, index) => ({ index, url: `https://example.com/${index}.png` })) };

describe('Midjourney capability boundaries and full batches', () => {
  it('keeps MJ explicit and leaves ordinary Auto unchanged', () => {
    expect(planImageGeneration({ prompt: 'scene' }).model).toBe('gpt-image-2.5-flare');
    expect(planImageGeneration({ prompt: 'scene', model: 'mj-v8.2' }).model).toBe('mj-v8.2');
  });
  it.each([
    { image: 'https://example.com/photo.png' }, { background: 'transparent' as const }, { isNsfw: true },
    { imageResolution: '4K' }, { aspectRatio: '15:1' }, { midjourney: { quality: 'hd' as const }, aspectRatio: '8:1' },
  ])('rejects unsupported %j without silent rerouting', req => {
    expect(() => planImageGeneration({ prompt: 'scene', model: 'mj-v8.2', ...req })).toThrow();
  });
  it('validates incompatible modes and data references before preparing a paid prompt', () => {
    expect(() => midjourneyOptions({ prompt: 'scene', midjourney: { speed: 'draft', quality: 'hd' } })).toThrow();
    expect(() => midjourneyOptions({ prompt: 'scene', references: [{ url: 'data:image/png;base64,YQ==', role: 'reference' }] })).toThrow();
  });
  it('collects every image from exactly the accepted task after a transient read failure', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('transport')).mockResolvedValueOnce(complete);
    const read = vi.fn(async (url: string) => `decoded:${url}`);
    const result = await collectMidjourneyBatch({ ...complete, status: 'pending', images: [] }, 4, { get }, read, async () => {});
    expect(get.mock.calls).toEqual([['task-accepted'], ['task-accepted']]);
    expect(result.images).toHaveLength(4);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it('keeps moderated candidate counts and does not publish an undecodable batch', async () => {
    const read = vi.fn(async () => 'image');
    const partial = await collectMidjourneyBatch({ ...complete, images: complete.images.slice(0, 3) }, 4, { get: vi.fn() }, read);
    expect(partial.images).toHaveLength(3);
    expect(read).toHaveBeenCalledTimes(3);
    await expect(collectMidjourneyBatch(complete, 4, { get: vi.fn() }, async () => { throw new Error('Corrupt image'); })).rejects.toMatchObject({ taskId: 'task-accepted' });
  });
  it('keeps the accepted task on timeout and never submits a replacement', async () => {
    const get = vi.fn();
    await expect(collectMidjourneyBatch({ ...complete, status: 'pending' }, 4, { get }, async () => 'image', async () => {}, -1)).rejects.toMatchObject({ taskId: 'task-accepted' });
    expect(get).not.toHaveBeenCalled();
  });
  it('handles Next dev hostname normalization and still blocks cross-origin calls', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('MIDJOURNEY_LOCAL_LAB', '1');
    expect(isLocalMidjourneyRequest(new Request('http://localhost:3041/api/local-midjourney', { headers: { host: '127.0.0.1:3041', origin: 'http://127.0.0.1:3041' } }))).toBe(true);
    expect(isLocalMidjourneyRequest(new Request('http://localhost:3041/api/local-midjourney', { headers: { host: 'evil.test:3041', origin: 'http://evil.test:3041' } }))).toBe(false);
    vi.unstubAllEnvs();
  });
});
