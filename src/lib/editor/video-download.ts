const STORAGE_ORIGIN = 'sdyrtztrjgmmpnirswxt.supabase.co';
const PUBLIC_STORAGE_HOSTS = new Set([
  STORAGE_ORIGIN,
  'orywxdeppjtwckzqehpr.supabase.co',
  'cdn.makaron.app',
]);

/** Only anonymous, permanent Storage objects can bypass the application proxy. */
export function directVideoDownloadUrl(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !PUBLIC_STORAGE_HOSTS.has(url.hostname)
      || !url.pathname.startsWith('/storage/v1/object/public/')
      || [...url.searchParams.keys()].some(key => /token|signature|credential|authorization/i.test(key))) {
      return null;
    }
    // Existing media URLs can use our alias. Downloads need only Supabase Storage.
    if (url.hostname === 'cdn.makaron.app') url.hostname = STORAGE_ORIGIN;
    return url.href;
  } catch {
    return null;
  }
}

export async function loadVideoDownload(
  source: string,
  mode: 'full' | 'download',
): Promise<Blob> {
  const directUrl = directVideoDownloadUrl(source);
  if (directUrl) {
    const controller = new AbortController();
    // A blocked connection must not leave Save waiting indefinitely before fallback.
    const firstByteTimeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(directUrl, { signal: controller.signal });
      clearTimeout(firstByteTimeout);
      if (response.status !== 200) throw new Error('Direct video download failed');
      const blob = await response.blob();
      const length = response.headers.get('Content-Length');
      const encoding = response.headers.get('Content-Encoding');
      if (!blob.size || (length && (!encoding || encoding === 'identity') && Number(length) !== blob.size)) {
        throw new Error('Incomplete direct video download');
      }
      return blob;
    } catch {
      controller.abort();
      // CORS, regional reachability and incomplete responses retain the existing
      // server-side path. Never save the partial direct response.
    } finally {
      clearTimeout(firstByteTimeout);
    }
  }

  const response = await fetch(`/api/proxy-video?url=${encodeURIComponent(directUrl || source)}&${mode}=1`);
  if (!response.ok) throw new Error('Could not load video');
  return response.blob();
}
