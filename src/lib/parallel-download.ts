// Four bounded chunks at a time; never buffer the entire video for ZIP streaming.
// CORS must expose Content-Range and ETag. Otherwise use the original full GET.
export interface ParallelDownloadOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  threshold?: number;
  chunkSize?: number;
}

export function isPublicDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co', 'orywxdeppjtwckzqehpr.supabase.co'].includes(url.hostname)
      && /^\/storage\/v1\/(object\/public|render\/image\/public)\//.test(url.pathname)
      && !url.searchParams.has('token');
  } catch { return false; }
}

export async function fetchDownload(url: string, bytes?: number, {
  signal, fetcher = fetch, threshold = 8 * 1024 ** 2, chunkSize = 4 * 1024 ** 2,
}: ParallelDownloadOptions = {}): Promise<Response> {
  signal?.throwIfAborted();
  const full = () => signal ? fetcher(url, { signal }) : fetcher(url);
  if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < threshold)) return full();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const cleanup = () => signal?.removeEventListener('abort', abort);
  let probe: Response;
  try {
    probe = await fetcher(url, { cache: 'no-store', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
  } catch (error) {
    cleanup(); if (signal?.aborted) throw error; return full();
  }
  if (probe.status === 200) { await probe.body?.cancel(); cleanup(); return full(); }
  if (bytes === undefined) {
    const total = /^bytes 0-0\/(\d+)$/.exec(probe.headers.get('Content-Range') || '');
    bytes = total ? Number(total[1]) : NaN;
  }
  if (!Number.isSafeInteger(bytes) || bytes < threshold) { await probe.body?.cancel(); cleanup(); return full(); }
  const totalBytes = bytes;
  const etag = probe.headers.get('ETag');
  const valid = probe.status === 206 && probe.headers.get('Content-Range') === `bytes 0-0/${bytes}` && /^"[^"\r\n]+"$/.test(etag || '');
  await probe.body?.cancel();
  if (!valid) { cleanup(); return full(); }
  let offset = 0;
  return new Response(new ReadableStream({
    async pull(stream) {
      try {
        controller.signal.throwIfAborted();
        const starts = Array.from({ length: Math.min(4, Math.ceil((totalBytes - offset) / chunkSize)) }, (_, i) => offset + i * chunkSize);
        const chunks = await Promise.all(starts.map(async start => {
          const end = Math.min(totalBytes - 1, start + chunkSize - 1);
          const response = await fetcher(url, { cache: 'no-store', headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
          if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${start}-${end}/${totalBytes}` || response.headers.get('ETag') !== etag) {
            await response.body?.cancel();
            throw new Error('Media changed during download');
          }
          // Bound even a malformed/oversized response before it reaches the archive.
          const data = new Uint8Array(end - start + 1); let used = 0;
          const reader = response.body!.getReader();
          try {
            for (;;) {
              const { value, done } = await reader.read(); if (done) break;
              if (used + value.byteLength > data.length) throw new Error('Invalid media range length');
              data.set(value, used); used += value.byteLength;
            }
            if (used !== data.length) throw new Error('Incomplete media range');
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
          return data;
        }));
        controller.signal.throwIfAborted();
        for (const data of chunks) { stream.enqueue(data); offset += data.length; }
        if (offset === totalBytes) { cleanup(); stream.close(); }
      } catch (error) { controller.abort(); cleanup(); stream.error(error); }
    },
    cancel(reason) { controller.abort(reason); cleanup(); },
  }, { highWaterMark: 0 }), { headers: { 'Content-Length': String(bytes), 'Content-Type': probe.headers.get('Content-Type') || 'application/octet-stream' } });
}

/** Only our anonymous public media use parallel requests. Other URLs retain their existing path. */
export function fetchPublicDownload(url: string, options?: ParallelDownloadOptions): Promise<Response> {
  return isPublicDownloadUrl(url) ? fetchDownload(url, undefined, options) : (options?.fetcher || fetch)(url);
}
