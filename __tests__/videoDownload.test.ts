import { afterEach, describe, expect, it, vi } from 'vitest';
import { directVideoDownloadUrl, loadVideoDownload } from '@/lib/editor/video-download';

const source = 'https://cdn.makaron.app/storage/v1/object/public/images/movie.mp4';
const direct = source.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public video downloads', () => {
  it('uses Supabase directly for an existing public media alias', async () => {
    const request = vi.fn().mockResolvedValue(new Response('movie', {
      headers: { 'Content-Length': '5', 'Content-Type': 'video/mp4' },
    }));
    vi.stubGlobal('fetch', request);
    expect(await (await loadVideoDownload(source, 'download')).text()).toBe('movie');
    expect(request).toHaveBeenCalledExactlyOnceWith(direct, { signal: expect.any(AbortSignal) });
  });

  it.each([
    'https://storage.theapi.app/movie.mp4',
    'https://cdn.makaron.app/storage/v1/object/sign/images/movie.mp4?token=private',
    source + '?token=private',
    source + '?X-Amz-Signature=private',
    source.replace('https://', 'https://user:password@'),
    source.replace('cdn.makaron.app', 'cdn.makaron.app.evil.test'),
  ])('retains the proxy for provider, signed or unrecognized URLs: %s', async url => {
    const request = vi.fn().mockResolvedValue(new Response('proxied'));
    vi.stubGlobal('fetch', request);
    expect(directVideoDownloadUrl(url)).toBeNull();
    expect(await (await loadVideoDownload(url, 'full')).text()).toBe('proxied');
    expect(request).toHaveBeenCalledExactlyOnceWith(`/api/proxy-video?url=${encodeURIComponent(url)}&full=1`);
  });

  it.each(['cors', 'status', 'truncated', 'stream'])('falls back without saving an incomplete direct download: %s', async failure => {
    const response = failure === 'status'
      ? new Response('unavailable', { status: 403 })
      : failure === 'stream'
        ? new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection reset')); } }))
        : new Response('partial', { headers: { 'Content-Length': '100' } });
    const request = vi.fn();
    if (failure === 'cors') request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else request.mockResolvedValueOnce(response);
    request.mockResolvedValueOnce(new Response('complete'));
    vi.stubGlobal('fetch', request);
    expect(await (await loadVideoDownload(source, 'download')).text()).toBe('complete');
    expect(request).toHaveBeenLastCalledWith(`/api/proxy-video?url=${encodeURIComponent(direct)}&download=1`);
  });

  it('times out a blocked direct connection and completes through the proxy', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })).mockResolvedValueOnce(new Response('complete'));
    vi.stubGlobal('fetch', request);
    const result = loadVideoDownload(source, 'download');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await (await result).text()).toBe('complete');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('surfaces a proxy failure instead of returning an error page as a video', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 502 })));
    await expect(loadVideoDownload(source, 'full')).rejects.toThrow('Could not load video');
  });
});
