import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMediaBlob, managedDownloadUrl } from '@/lib/editor/media-transfer';

const direct = 'https://cdn.makaron.app/storage/v1/object/public/images/asset.mp4';
const proxy = '/api/proxy-video?url=' + encodeURIComponent(direct) + '&full=1';

function media(body: string, headers: Record<string, string> = {}, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'video/mp4', ...headers } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('editor media transfer', () => {
  it('creates attachment URLs only for unsigned public Makaron CDN objects', () => {
    expect(managedDownloadUrl(direct + '#t=1', '作品.mp4')).toBe(direct + '?download=%E4%BD%9C%E5%93%81.mp4');
    expect(managedDownloadUrl(direct + '?signature=secret', 'work.mp4')).toBeUndefined();
    expect(managedDownloadUrl('https://example.test/asset.mp4', 'work.mp4')).toBeUndefined();
  });

  it('reads the direct full file with byte progress and no proxy hop', async () => {
    const fetch = vi.fn().mockResolvedValue(media('video', { 'Content-Length': '5' }));
    vi.stubGlobal('fetch', fetch);
    const progress = vi.fn();
    expect(await (await fetchMediaBlob(direct, 'video', progress)).text()).toBe('video');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(direct, { signal: expect.any(AbortSignal) });
    expect(progress).toHaveBeenCalledWith({ received: 0 });
    expect(progress).toHaveBeenLastCalledWith({ received: 5, total: 5 });
  });

  it.each([
    () => media('vid', { 'Content-Range': 'bytes 0-2/5' }, 206),
    () => media('vid', { 'Content-Length': '5' }),
    () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
  ])('restarts on the existing video proxy after an invalid direct response', async invalid => {
    const fetch = vi.fn().mockResolvedValueOnce(invalid()).mockResolvedValueOnce(media('video'));
    vi.stubGlobal('fetch', fetch);
    expect(await (await fetchMediaBlob(direct, 'video')).text()).toBe('video');
    expect(fetch).toHaveBeenNthCalledWith(2, proxy, { signal: expect.any(AbortSignal) });
  });

  it('falls back after eight seconds without a first byte', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockImplementationOnce((_url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }))
      .mockResolvedValueOnce(media('video'));
    vi.stubGlobal('fetch', fetch);
    const pending = fetchMediaBlob(direct, 'video');
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toHaveProperty('size', 5);
    expect(fetch).toHaveBeenNthCalledWith(2, proxy, { signal: expect.any(AbortSignal) });
  });

  it('accepts a complete 206 response from the CDN without downloading it twice', async () => {
    const fetch = vi.fn().mockResolvedValue(media('video', { 'Content-Range': 'bytes 0-4/5' }, 206));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchMediaBlob(direct, 'video')).resolves.toHaveProperty('size', 5);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('only requests the authorized proxy for Google file downloads', async () => {
    const source = 'https://generativelanguage.googleapis.com/v1beta/files/test:download';
    const fetch = vi.fn().mockResolvedValue(media('video'));
    vi.stubGlobal('fetch', fetch);
    await fetchMediaBlob(source, 'video');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/proxy-video?url=' + encodeURIComponent(source) + '&full=1', { signal: expect.any(AbortSignal) });
  });
});
