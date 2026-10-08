// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildMidjourneyRequest, MidjourneyClient } from '../src/lib/midjourney';

const pending = { id: 'task-unified-test', model: 'mj-v8.2', status: 'processing', progress: 0, usage: { credits_reserved: 5.4 } };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }

describe('Midjourney V8.2 batch contract', () => {
  it('keeps style references separate from content references and native HD separate from detail', () => {
    const body = buildMidjourneyRequest({ prompt: 'A ceramic moon.', imageUrls: ['https://cdn.example.com/product.png'], styleReferences: ['https://cdn.example.com/style.png'], styleWeight: 300, quality: 'hd', detail: 3, aspectRatio: '16:9', seed: 0 });
    expect(body).toEqual({ model: 'mj-v8.2', prompt: 'https://cdn.example.com/product.png A ceramic moon. --ar 16:9 --sref https://cdn.example.com/style.png --sw 300 --seed 0 --q 3', quality: 'hd', model_params: { speed: 'fast' } });
  });
  it.each([
    { prompt: 'A cat.', speed: 'draft', quality: 'hd' },
    { prompt: 'A cat --edit https://cdn.example.com/a.png' },
    { prompt: 'A cat --v 7' },
    { prompt: 'A cat.', speed: 'turbo' },
    { prompt: 'A cat.', styleWeight: 300 },
    { prompt: 'A cat.', imageUrls: ['data:image/png;base64,YQ=='] },
    { prompt: 'A cat.', imageUrls: ['https://127.0.0.1/a.png'] },
    { prompt: 'A cat.', imageUrls: ['https://user:password@cdn.example.com/a.png'] },
    { prompt: 'A cat.', quality: 'hd', aspectRatio: '8:1' },
    { prompt: 'A cat.', aspectRatio: '1:0' },
    { prompt: 'A cat.', seed: -1 },
    { prompt: 'A cat.', imageWeight: 2 },
    { prompt: 'A cat.', raw: 'yes' },
    { prompt: 'A cat.', imageUrls: 'https://cdn.example.com/a.png' },
    { prompt: 'A cat.', edit: true },
    { prompt: 'A cat.', detail: 5 },
    { prompt: 'a'.repeat(1025) },
  ])('rejects unsupported input before any paid submission: %j', async input => {
    const fetcher = vi.fn();
    await expect(new MidjourneyClient('test-key', fetcher).submit(input as any)).rejects.toMatchObject({ outcome: 'not_submitted' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('submits once and exposes a recoverable task ID and supplier reservation', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(pending));
    const task = await new MidjourneyClient('test-key', fetcher).submit({ prompt: 'A cat.' });
    expect(task).toMatchObject({ taskId: pending.id, model: 'mj-v8.2', creditsReserved: 5.4, images: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe('POST');
  });
  it('never retries a timed out paid POST', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(new MidjourneyClient('test-key', fetcher).submit({ prompt: 'A cat.' })).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains an ID when the provider receipt is malformed', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ...pending, model: 'mj-v7' }));
    await expect(new MidjourneyClient('test-key', fetcher).submit({ prompt: 'A cat.' })).rejects.toMatchObject({ outcome: 'unknown', taskId: pending.id });
  });
  it('recovers the same task without POST and preserves all candidates with one supplier charge', async () => {
    const urls = Array.from({ length: 4 }, (_, i) => `https://cdn.example.com/${i}.png`);
    const fetcher = vi.fn().mockResolvedValue(response({ ...pending, status: 'completed', results: urls, usage: { credits_used: 5.4, cost: { usd: 0.08 } } }));
    const result = await new MidjourneyClient('test-key', fetcher).get(pending.id);
    expect(result.images).toEqual(urls.map((url, index) => ({ index, url })));
    expect(result).toMatchObject({ providerCostUsd: 0.08, creditsUsed: 5.4 });
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  });
  it('accepts partially moderated batches and all 24 Draft results', async () => {
    for (const count of [1, 3, 24]) {
      const fetcher = vi.fn().mockResolvedValue(response({ ...pending, status: 'completed', results: Array.from({ length: count }, (_, i) => `https://cdn.example.com/${i}.png`) }));
      expect((await new MidjourneyClient('test-key', fetcher).get(pending.id)).images).toHaveLength(count);
    }
  });
  it('rejects empty completion, incorrect task identity and redirects', async () => {
    for (const data of [{ ...pending, status: 'completed', results: [] }, { ...pending, id: 'other-task' }]) {
      const fetcher = vi.fn().mockResolvedValue(response(data));
      await expect(new MidjourneyClient('test-key', fetcher).get(pending.id)).rejects.toMatchObject({ outcome: 'query_failed', taskId: pending.id });
      expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    }
  });
  it('does not echo credentials, URLs or raw provider errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { message: 'secret key and private image URL' } }, 403));
    await expect(new MidjourneyClient('test-key', fetcher).submit({ prompt: 'A cat.' })).rejects.toThrow('HTTP 403');
  });
});
