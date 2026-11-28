import type { Snapshot } from '@/types';
import type { LocaleContextValue } from '@/lib/i18n';
import { isNativePhotoLibrarySaveAvailable, saveBlobToNativePhotoLibrary, saveUrlToNativePhotoLibrary } from '@/lib/native-media';
import { snapFromTimeline } from './timeline-utils';
import { requiresAuthenticatedVideoProxy, resolveNativeVideoPlaybackUrl } from '@/lib/video-playback-url';
import { getOptimizedUrl, normalizeDomain } from '@/lib/supabase/storage';
import { downloadBlob, fetchMediaBlob, isMobileMediaBrowser, managedDownloadUrl, startFileDownload, type MediaWarmup, type TransferProgress } from './media-transfer';

export async function checkMediaDownload(): Promise<boolean> {
  const response = await fetch('/api/media/unlock', { cache: 'no-store' });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error('Could not verify media download');
  const result = await response.json();
  if (typeof result.paid !== 'boolean') throw new Error('Invalid media download');
  return result.paid;
}

export interface PreparedDownload {
  blob: Blob;
  filename: string;
  kind: 'image' | 'video';
}

export interface DownloadAssetPreview {
  source: string;
  kind: 'image' | 'video';
  width?: number;
  height?: number;
}

/** Editor-scoped, bounded cache. Failed preparations are retryable, not cached. */
export class PreparedDownloadCache {
  private entries = new Map<string, { promise: Promise<PreparedDownload>; bytes: number | null }>();
  constructor(private maxBytes = 64 * 1024 * 1024, private maxEntries = 3) {}

  get(key: string, prepare: () => Promise<PreparedDownload>): Promise<PreparedDownload> {
    const cached = this.entries.get(key);
    if (cached) {this.entries.delete(key);this.entries.set(key, cached);return cached.promise;}
    const entry = { promise: Promise.resolve().then(prepare), bytes: null as number | null };
    this.entries.set(key, entry);
    entry.promise.then(asset => {
      if (this.entries.get(key) !== entry) return;
      entry.bytes = asset.blob.size;
      let bytes = [...this.entries.values()].reduce((total, item) => total + (item.bytes ?? 0), 0);
      for (const [oldKey, oldEntry] of this.entries) {
        if (bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
        if (oldEntry.bytes === null) continue;
        this.entries.delete(oldKey);bytes -= oldEntry.bytes;
      }
    }, () => {if (this.entries.get(key) === entry) this.entries.delete(key);});
    return entry.promise;
  }

  clear() {this.entries.clear();}
}

export interface DownloadAssetParams {
  timeline: string[];
  viewIndex: number;
  isViewingVideo: boolean;
  currentVideoUrl: string | null | undefined;
  currentVideoSize?: { width: number; height: number };
  draftParentIndex: number | null;
  snapshotsRef: { current: Snapshot[] };
  offerShare?: (blob: Blob, filename: string) => boolean;
  onTransfer?: (progress: TransferProgress) => void;
  preparedOriginal?: Promise<PreparedDownload>;
  isCurrent?: () => boolean;
  setIsSaving: (v: boolean) => void;
  setSaveStatus: (msg: string, options?: { autoDismiss: boolean }) => void;
  showSaveToast: () => void;
  t: LocaleContextValue['t'];
  projectTitle?: string;
}

export function getDownloadAssetPreview(params: DownloadAssetParams): DownloadAssetPreview | undefined {
  const index = snapFromTimeline(params.viewIndex, params.draftParentIndex);
  const snap = index === null ? undefined : params.snapshotsRef.current[index];
  if (params.isViewingVideo) {
    if (!params.currentVideoUrl) return undefined;
    const size = params.currentVideoSize;
    const hasPlaybackSize = size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
    return {
      source: resolveNativeVideoPlaybackUrl(params.currentVideoUrl), kind: 'video',
      width: hasPlaybackSize ? size.width : snap?.videoMeta?.width,
      height: hasPlaybackSize ? size.height : snap?.videoMeta?.height,
    };
  }
  if (snap?.design) return undefined;
  const source = snap?.imageUrl || params.timeline[params.viewIndex];
  return source ? { source: getOptimizedUrl(source), kind: 'image' } : undefined;
}

export function prepareDownloadAsset(params: DownloadAssetParams, cache?: PreparedDownloadCache): Promise<PreparedDownload> {
  const load = () => params.preparedOriginal?.catch(error => {
    if (params.isCurrent?.() === false) throw error;
    return loadDownloadAsset(params);
  }) ?? loadDownloadAsset(params);
  if (!cache) return load();
  const index = snapFromTimeline(params.viewIndex, params.draftParentIndex);
  const snap = index === null ? undefined : params.snapshotsRef.current[index];
  const key = JSON.stringify([params.isViewingVideo, params.isViewingVideo ? params.currentVideoUrl : snap?.design || snap?.imageUrl || params.timeline[params.viewIndex], snap?.id, params.projectTitle]);
  return cache.get(key, load);
}

export function warmDownloadAsset(params: DownloadAssetParams, warmup: MediaWarmup): Promise<PreparedDownload> {
  return loadDownloadAsset(params, warmup);
}

async function loadDownloadAsset(params: DownloadAssetParams, warmup?: MediaWarmup): Promise<PreparedDownload> {
  const { timeline, viewIndex, isViewingVideo, currentVideoUrl, draftParentIndex, snapshotsRef, projectTitle } = params;
  const index = snapFromTimeline(viewIndex, draftParentIndex);
  const snap = index === null ? undefined : snapshotsRef.current[index];
  if (isViewingVideo) {
    if (!currentVideoUrl) throw new Error('Video unavailable');
    const blob = await fetchMediaBlob(currentVideoUrl, 'video', params.onTransfer, warmup);
    return { blob, filename: videoFilename(currentVideoUrl, blob.type), kind: 'video' };
  }
  if (snap?.design?.animation) {
    document.dispatchEvent(new Event('music-play'));
    const { exportDesignVideo } = await import('@/components/RemotionRenderer');
    params.setSaveStatus(params.t('editor.saveRendering'));
    const blob = await exportDesignVideo(snap.design, ({ progress }) => {
      params.setSaveStatus(params.t('editor.saveRenderingProgress', Math.round(progress * 100)));
    });
    return { blob, filename: `makaron-design-${Date.now()}.mp4`, kind: 'video' };
  }
  let source = snap?.imageUrl || timeline[viewIndex];
  if (snap?.design) {
    const { captureDesignPoster } = await import('@/components/RemotionRenderer');
    try {
      source = await captureDesignPoster(snap.design) || source;
    } catch (error) {
      if (!source) throw error;
    }
  }
  if (!source) throw new Error('Image unavailable');
  const blob = await fetchMediaBlob(source, 'image', params.onTransfer, warmup);
  const slug = (projectTitle || 'edit').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/svg+xml' ? 'svg' : 'jpg';
  return { blob, filename: `makaron-${slug}-${(index ?? viewIndex) + 1}.${ext}`, kind: 'image' };
}

export type DownloadDestination = 'photos' | 'download';

export async function savePreparedDownload(asset: PreparedDownload): Promise<DownloadDestination> {
  if (isNativePhotoLibrarySaveAvailable() && asset.blob.type !== 'image/svg+xml') {
    const normalized = asset.kind === 'image' ? await normalizeImageBlobForNativeSave(asset.blob) : null;
    await saveBlobToNativePhotoLibrary(normalized?.blob || asset.blob,
      normalized ? asset.filename.replace(/\.[^.]+$/, `.${normalized.filenameExt}`) : asset.filename, asset.kind);
    return 'photos';
  }
  downloadBlob(asset.blob, asset.filename);
  return 'download';
}

export async function deliverPreparedDownload(params: DownloadAssetParams, asset: PreparedDownload): Promise<void> {
  if (params.isCurrent?.() === false || params.offerShare?.(asset.blob, asset.filename)) return;
  if (isNativePhotoLibrarySaveAvailable() && asset.blob.type !== 'image/svg+xml') {
    params.setSaveStatus(params.t('editor.saveToPhotosProgress'));
  }
  const destination = await savePreparedDownload(asset);
  if (destination === 'photos') {
    params.setSaveStatus(params.t('editor.done'));
    params.showSaveToast();
  } else {
    params.setSaveStatus(params.t('editor.downloadStarted'), { autoDismiss: true });
  }
}

export async function trySavePaidDownload(params: DownloadAssetParams, cache?: PreparedDownloadCache): Promise<boolean> {
  params.setIsSaving(true);
  try {
    if (!(await checkMediaDownload())) return false;
    const asset = await prepareDownloadAsset(params, cache);
    if (!(await checkMediaDownload())) return false;
    await deliverPreparedDownload(params, asset);
    return true;
  } finally {
    params.setIsSaving(false);
  }
}

function blobToImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image before native save'));
    };
    image.src = url;
  });
}

export async function normalizeImageBlobForNativeSave(blob: Blob): Promise<{ blob: Blob; filenameExt: 'jpg' | 'png' | 'gif' }> {
  if (blob.type === 'image/gif') return { blob, filenameExt: 'gif' };
  if (blob.type === 'image/svg+xml') throw new Error('SVG must be downloaded as the original vector file, not converted to a photo.');
  if (blob.type === 'image/jpeg' || blob.type === 'image/jpg') {
    return { blob, filenameExt: 'jpg' };
  }
  if (blob.type === 'image/png') {
    return { blob, filenameExt: 'png' };
  }

  try {
    const image = await blobToImageElement(blob);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) throw new Error('Could not prepare image canvas');
    ctx.drawImage(image, 0, 0);
    // Photos support for WebP/AVIF varies. PNG is the lossless interchange
    // format and preserves any decoded alpha instead of flattening to JPEG.
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Could not encode image for native save'));
      }, 'image/png');
    });
    return { blob: pngBlob, filenameExt: 'png' };
  } catch (error) {
    console.warn('Native image save normalization failed:', error);
    throw error;
  }
}

function videoFilename(source?: string, mimeType?: string, stable = false): string {
  const mimeExtension: Record<string, string> = {
    'video/quicktime': 'mov', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/x-m4v': 'm4v',
  };
  const sourceExtension = source?.match(/\.(mp4|mov|webm|ogv|m4v)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  const extension = (mimeType && mimeExtension[mimeType]) || (mimeType === 'video/mp4' ? 'mp4' : sourceExtension) || 'mp4';
  return stable ? `makaron-video.${extension}` : `makaron-video-${Date.now()}.${extension}`;
}

export async function downloadAsset(params: DownloadAssetParams): Promise<void> {
  const { isViewingVideo, currentVideoUrl, setIsSaving, setSaveStatus, t } = params;
  const native = isNativePhotoLibrarySaveAvailable();
  const filename = videoFilename(currentVideoUrl || undefined);
  if (isViewingVideo && currentVideoUrl && !native && !isMobileMediaBrowser()) {
    // A stable attachment filename lets the CDN reuse its download variant.
    const attachmentName = videoFilename(currentVideoUrl, undefined, true);
    const direct = managedDownloadUrl(currentVideoUrl, attachmentName);
    if (direct) {
      startFileDownload(direct, attachmentName);
      setSaveStatus(t('editor.downloadStarted'), { autoDismiss: true });
      return;
    }
  }

  setIsSaving(true);
  setSaveStatus(t('editor.savePreparing'));
  try {
    if (isViewingVideo && currentVideoUrl && native && /^https?:\/\//i.test(currentVideoUrl)
      && !requiresAuthenticatedVideoProxy(currentVideoUrl)) {
      setSaveStatus(t('editor.saveToPhotosProgress'));
      try {
        await saveUrlToNativePhotoLibrary(normalizeDomain(currentVideoUrl), filename, 'video');
        setSaveStatus(t('editor.done'));
        params.showSaveToast();
        return;
      } catch {
        setSaveStatus(t('editor.savePreparing'));
      }
    }
    const asset = await prepareDownloadAsset(params);
    await deliverPreparedDownload(params, asset);
  } finally {
    setIsSaving(false);
  }
}
