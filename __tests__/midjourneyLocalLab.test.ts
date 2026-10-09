// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MidjourneyClient } from '../src/lib/midjourney';
import { isLocalMidjourneyRequest } from '../src/lib/midjourney-local-access';
import { readLocalMidjourneyRecord, refreshLocalMidjourneyRecord, submitLocalMidjourney, localMidjourneyView } from '../src/lib/midjourney-local-lab';
import { validateMidjourneyPrompt } from '../src/lib/midjourney-prompt';

let directory: string;
const input = () => ({ id: crypto.randomUUID(), brief: '做一张咖啡海报', request: { prompt: 'A ceramic coffee cup in warm afternoon light.' } });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mj-local-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe('Midjourney local trial', () => {
  it('is opt-in, development-only and rejects cross-site access', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('MIDJOURNEY_LOCAL_LAB', '1');
    expect(isLocalMidjourneyRequest(new Request('http://localhost:3039/api/local-midjourney', { headers: { origin: 'http://localhost:3039' } }))).toBe(true);
    expect(isLocalMidjourneyRequest(new Request('http://localhost:3039/api/local-midjourney', { headers: { origin: 'https://evil.example' } }))).toBe(false);
    expect(isLocalMidjourneyRequest(new Request('https://www.makaron.app/api/local-midjourney'))).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isLocalMidjourneyRequest(new Request('http://localhost:3039/api/local-midjourney'))).toBe(false);
  });
  it('persists one paid submission and returns it again without a second POST', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'task-test', model: 'mj-v8.2', status: 'processing' })));
    const client = new MidjourneyClient('test', fetcher);
    const data = input();
    const first = await submitLocalMidjourney(data, client);
    expect((await readLocalMidjourneyRecord(data.id)).task?.taskId).toBe('task-test');
    expect((await submitLocalMidjourney(data, client)).id).toBe(first.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains unknown submissions instead of retrying after restart', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('timeout'));
    const data = input();
    const client = new MidjourneyClient('test', fetcher);
    expect((await submitLocalMidjourney(data, client)).state).toBe('unknown');
    expect((await submitLocalMidjourney(data, client)).state).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovers task completion and exposes local image URLs rather than provider signatures', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-test', model: 'mj-v8.2', status: 'processing' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-test', model: 'mj-v8.2', status: 'completed', results: ['https://cdn.example.com/image.png?Signature=private'], usage: { cost: { usd: 0.08 } } })));
    const client = new MidjourneyClient('test', fetcher);
    const data = input();
    await submitLocalMidjourney(data, client);
    const view = localMidjourneyView(await refreshLocalMidjourneyRecord(data.id, client));
    expect(view).toMatchObject({ status: 'completed', cost: 0.08, images: [{ index: 0, url: `/api/local-midjourney?id=${data.id}&image=0` }] });
    expect(fetcher.mock.calls[1][1].method).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('Signature');
  });
  it('marks interrupted stale intents as unknown without making any provider request', async () => {
    const data = input();
    await mkdir(join(directory, '.midjourney-lab'));
    await writeFile(join(directory, '.midjourney-lab', `${data.id}.json`), JSON.stringify({ ...data, state: 'submitting', createdAt: new Date(Date.now() - 180_000).toISOString() }));
    const fetcher = vi.fn();
    expect((await refreshLocalMidjourneyRecord(data.id, new MidjourneyClient('test', fetcher))).state).toBe('unknown');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects path traversal and invalid supplier parameters before submission', async () => {
    const fetcher = vi.fn();
    const client = new MidjourneyClient('test', fetcher);
    await expect(submitLocalMidjourney({ ...input(), id: '../secrets' }, client)).rejects.toThrow();
    await expect(submitLocalMidjourney({ ...input(), request: { prompt: 'Coffee', speed: 'draft', quality: 'hd' } }, client)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects unavailable style sources rather than silently omitting the reference', async () => {
    const fetcher = vi.fn();
    await expect(submitLocalMidjourney({ ...input(), styleFrom: { id: crypto.randomUUID(), index: 0 } }, new MidjourneyClient('test', fetcher))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps quoted original-language text and validates converted prompt fields', () => {
    expect(validateMidjourneyPrompt({ prompt: 'A poster with the headline "秋日咖啡".', aspectRatio: '4:5' }).prompt).toContain('秋日咖啡');
    expect(() => validateMidjourneyPrompt({ prompt: 'A cat --v 7' })).toThrow();
    expect(() => validateMidjourneyPrompt({ prompt: 'A cat', quality: 'hd' })).toThrow();
  });
});
