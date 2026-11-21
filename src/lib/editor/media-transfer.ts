import { buildVideoProxyUrl, requiresAuthenticatedVideoProxy } from '@/lib/video-playback-url';
import type { LocaleContextValue } from '@/lib/i18n';
import { normalizeDomain } from '@/lib/supabase/storage';

export interface TransferProgress {
  received: number;
  total?: number;
}

export function transferProgressLabel(t: LocaleContextValue['t'], { received, total }: TransferProgress): string {
  if (total) return t('editor.downloadProgress', Math.floor(received * 100 / total));
  if (received) return t('editor.downloadReceived', (received / (1024 * 1024)).toFixed(1));
  return t('editor.savePreparing');
}

type MediaKind = 'image' | 'video' | 'audio';
type OnProgress = (progress: TransferProgress) => void;

export interface MediaWarmup {
  signal: AbortSignal;
  maxBytes: number;
}

export function isMobileMediaBrowser(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function managedDownloadUrl(source: string, filename: string): string | undefined {
  try {
    const url = new URL(normalizeDomain(source));
    if (url.origin !== 'https://cdn.makaron.app' || !url.pathname.startsWith('/storage/v1/object/public/') || url.search) return;
    url.hash = '';
    url.searchParams.set('download', filename);
    return url.href;
  } catch {
    return;
  }
}

export function startFileDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  try { link.click(); } finally { link.remove(); }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try { startFileDownload(url, filename); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

export function supportsMobileFileShare(): boolean {
  return isMobileMediaBrowser() && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

export function shareableFile(blob: Blob, filename: string): File | undefined {
  if (!supportsMobileFileShare()) return;
  const file = new File([blob], filename, { type: blob.type });
  try {
    return navigator.canShare({ files: [file] }) ? file : undefined;
  } catch {
    return;
  }
}

async function readMedia(url: string, kind: MediaKind, onProgress?: OnProgress, firstByteMs = 30_000, warmup?: MediaWarmup): Promise<Blob> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Media transfer timed out'));
  let timer = setTimeout(cancel, firstByteMs);

  const cancelWarmup = () => controller.abort(warmup?.signal.reason);
  warmup?.signal.addEventListener('abort', cancelWarmup, { once: true });
  try {
    warmup?.signal.throwIfAborted();
    const response = await fetch(url, { signal: controller.signal });
    const contentRange = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
    const fullRange = contentRange && Number(contentRange[1]) + 1 === Number(contentRange[2]);
    if (response.status !== 200 && !(response.status === 206 && fullRange)) {
      throw new Error(`Incomplete media response (${response.status})`);
    }
    const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith(`${kind}/`) && contentType !== 'application/octet-stream'
      && !(kind === 'audio' && contentType === 'application/ogg')) {
      throw new Error('Unexpected media content type');
    }
    const length = Number(fullRange ? contentRange[2] : response.headers.get('Content-Length'));
    // Cross-origin servers may not expose Content-Encoding. SVGs can be
    // compressed in transit and the body is already decoded by Fetch.
    const total = contentType !== 'image/svg+xml' && !response.headers.get('Content-Encoding') && length > 0
      ? length : undefined;
    if (warmup && length > warmup.maxBytes) throw new Error('Media exceeds warmup budget');
    const type = contentType && contentType !== 'application/octet-stream' ? contentType : kind === 'video' ? 'video/mp4' : '';
    if (!response.body) throw new Error('Empty media response');
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    let lastUpdate = 0;

    for (;;) {
      const { done, value } = await reader.read();
      clearTimeout(timer);
      if (done) break;
      timer = setTimeout(cancel, 30_000);
      received += value.byteLength;
      if (warmup && received > warmup.maxBytes) throw new Error('Media exceeds warmup budget');
      chunks.push(value as Uint8Array<ArrayBuffer>);
      const now = performance.now();
      if (!lastUpdate || now - lastUpdate >= 120) {
        onProgress?.({ received, total });
        lastUpdate = now;
      }
    }

    if (!received || (total !== undefined && received !== total)) throw new Error('Incomplete media body');
    onProgress?.({ received, total });
    return new Blob(chunks, { type });
  } finally {
    clearTimeout(timer);
    warmup?.signal.removeEventListener('abort', cancelWarmup);
    controller.abort();
  }
}

export async function fetchMediaBlob(source: string, kind: MediaKind, onProgress?: OnProgress, warmup?: MediaWarmup): Promise<Blob> {
  if (warmup) return readMedia(normalizeDomain(source), kind, onProgress, 8_000, warmup);
  const proxy = kind === 'video' && /^https?:\/\//i.test(source) ? `${buildVideoProxyUrl(source)}&full=1` : undefined;
  if (proxy && requiresAuthenticatedVideoProxy(source)) return readMedia(proxy, kind, onProgress);

  const direct = normalizeDomain(source);
  const candidates = [...new Set([direct, source, proxy].filter((url): url is string => Boolean(url)))];
  for (const [index, url] of candidates.entries()) {
    onProgress?.({ received: 0 });
    try {
      return await readMedia(url, kind, onProgress, index < candidates.length - 1 ? 8_000 : undefined);
    } catch (error) {
      if (index === candidates.length - 1) throw error;
    }
  }
  throw new Error('Media unavailable');
}
