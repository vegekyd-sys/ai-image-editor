import type { Snapshot } from '@/types';
import type { LocaleContextValue } from '@/lib/i18n';
import { isNativePhotoLibrarySaveAvailable, saveBlobToNativePhotoLibrary, saveUrlToNativePhotoLibrary } from '@/lib/native-media';
import { snapFromTimeline } from './timeline-utils';
import { resolveNativeVideoPlaybackUrl } from '@/lib/video-playback-url';

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
  pendingVideoRef: { current: { blob: Blob; filename: string } | null };
  setIsSaving: (v: boolean) => void;
  setAgentStatus: (msg: string) => void;
  showSaveToast: () => void;
  t: LocaleContextValue['t'];
  projectTitle?: string;
}

export function getDownloadAssetPreview(params: DownloadAssetParams): DownloadAssetPreview | undefined {
  const index = snapFromTimeline(params.viewIndex, params.draftParentIndex);
  const snap = index === null ? undefined : params.snapshotsRef.current[index];
  if (params.isViewingVideo && params.currentVideoUrl) {
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
  return source ? { source, kind: 'image' } : undefined;
}

export function prepareDownloadAsset(params: DownloadAssetParams, cache?: PreparedDownloadCache): Promise<PreparedDownload> {
  if (!cache) return loadDownloadAsset(params);
  const index = snapFromTimeline(params.viewIndex, params.draftParentIndex);
  const snap = index === null ? undefined : params.snapshotsRef.current[index];
  const key = JSON.stringify([params.isViewingVideo, params.isViewingVideo ? params.currentVideoUrl : snap?.design || snap?.imageUrl || params.timeline[params.viewIndex], snap?.id, params.projectTitle]);
  return cache.get(key, () => loadDownloadAsset(params));
}

async function loadDownloadAsset(params: DownloadAssetParams): Promise<PreparedDownload> {
  const { timeline, viewIndex, isViewingVideo, currentVideoUrl, draftParentIndex, snapshotsRef, projectTitle } = params;
  const index = snapFromTimeline(viewIndex, draftParentIndex);
  const snap = index === null ? undefined : snapshotsRef.current[index];
  if (isViewingVideo && currentVideoUrl) {
    const response = await fetch(`/api/proxy-video?url=${encodeURIComponent(currentVideoUrl)}&full=1`);
    if (!response.ok) throw new Error('Could not load video');
    return { blob: await response.blob(), filename: `makaron-video-${Date.now()}.mp4`, kind: 'video' };
  }
  if (snap?.design?.animation) {
    document.dispatchEvent(new Event('music-play'));
    const { exportDesignVideo } = await import('@/components/RemotionRenderer');
    return { blob: await exportDesignVideo(snap.design), filename: `makaron-design-${Date.now()}.mp4`, kind: 'video' };
  }
  let source = snap?.imageUrl || timeline[viewIndex];
  if (snap?.design) {
    const { captureDesignPoster } = await import('@/components/RemotionRenderer');
    source = await captureDesignPoster(snap.design) || source;
  }
  if (!source) throw new Error('Image unavailable');
  const response = await fetch(source);
  if (!response.ok) throw new Error('Could not load image');
  const blob = await response.blob();
  const slug = (projectTitle || 'edit').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  return { blob, filename: `makaron-${slug}-${(index ?? viewIndex) + 1}.${ext}`, kind: 'image' };
}

export async function savePreparedDownload(asset: PreparedDownload): Promise<void> {
  if (isNativePhotoLibrarySaveAvailable()) {
    const normalized = asset.kind === 'image' ? await normalizeImageBlobForNativeSave(asset.blob) : null;
    await saveBlobToNativePhotoLibrary(normalized?.blob || asset.blob,
      normalized ? asset.filename.replace(/\.[^.]+$/, `.${normalized.filenameExt}`) : asset.filename, asset.kind);
    return;
  }
  const file = new File([asset.blob], asset.filename, { type: asset.blob.type });
  if (navigator.share && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file] }); return; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(asset.blob);
  const link = document.createElement('a');
  link.href = url;link.download = asset.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function trySavePaidDownload(params: DownloadAssetParams, cache?: PreparedDownloadCache): Promise<boolean> {
  params.setIsSaving(true);
  try {
    if (!(await checkMediaDownload())) return false;
    const asset = await prepareDownloadAsset(params, cache);
    if (!(await checkMediaDownload())) return false;
    await savePreparedDownload(asset);
    params.setAgentStatus(params.t('editor.done'));
    params.showSaveToast();
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

export async function normalizeImageBlobForNativeSave(blob: Blob): Promise<{ blob: Blob; filenameExt: 'jpg' | 'png' }> {
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

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function shortErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function imageExtensionFromSource(source: string): 'jpg' | 'png' | 'webp' | 'unknown' {
  if (/^data:image\/png;/i.test(source)) return 'png';
  if (/^data:image\/webp;/i.test(source)) return 'webp';
  if (/^data:image\/jpe?g;/i.test(source)) return 'jpg';
  try {
    const pathname = new URL(source, window.location.href).pathname;
    if (/\.png$/i.test(pathname)) return 'png';
    if (/\.webp$/i.test(pathname)) return 'webp';
    if (/\.jpe?g$/i.test(pathname)) return 'jpg';
  } catch {}
  return 'unknown';
}

export async function downloadAsset(params: DownloadAssetParams): Promise<void> {
  const {
    timeline,
    viewIndex,
    isViewingVideo,
    currentVideoUrl,
    draftParentIndex,
    snapshotsRef,
    pendingVideoRef,
    setIsSaving,
    setAgentStatus,
    showSaveToast,
    t,
    projectTitle,
  } = params;

  // Video download — proxy through our API to avoid CORS
  if (isViewingVideo && currentVideoUrl) {
    const videoSrc = currentVideoUrl;
    const filename = `makaron-video-${Date.now()}.mp4`;
    setIsSaving(true);
    setAgentStatus('Saving to Photos...');
    try {
      if (isNativePhotoLibrarySaveAvailable()) {
        try {
          await saveUrlToNativePhotoLibrary(videoSrc, filename, 'video');
          setIsSaving(false);
          setAgentStatus(t('editor.done'));
          showSaveToast();
          return;
        } catch (error) {
          console.warn('Native video save failed, falling back to web save:', error);
          setAgentStatus('Native save failed, trying fallback...');
        }
      }

      const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(videoSrc)}&download=1`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'video/mp4' });
      // Try native share (iOS/Android) — wrapped in its own try/catch so share failure
      // falls through to blob download instead of navigating away
      if (navigator.share && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try {
          await navigator.share({ files: [file] });
          setIsSaving(false);
          showSaveToast();
          return;
        } catch { /* share failed (gesture expired, user cancelled) — fall through to blob download */ }
      }
      // Fallback: trigger download via blob URL (works on desktop + iOS when share fails)
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setIsSaving(false);
      showSaveToast();
    } catch {
      setIsSaving(false);
      setAgentStatus('Save failed. Try again.');
      window.open(videoSrc, '_blank');
    }
    return;
  }

  // Animated design → export as MP4 via renderMediaOnWeb
  const snapIdx = snapFromTimeline(viewIndex, draftParentIndex);
  const currentSnap = snapIdx !== null ? snapshotsRef.current[snapIdx] : undefined;
  if (currentSnap?.design?.animation) {
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

    // Mobile step 2: video already exported → share with fresh user gesture
    if (isMobile && pendingVideoRef.current) {
      const { blob, filename } = pendingVideoRef.current;
      pendingVideoRef.current = null;
      if (isNativePhotoLibrarySaveAvailable()) {
        try {
          await saveBlobToNativePhotoLibrary(blob, filename, 'video');
          setAgentStatus(t('editor.done'));
          showSaveToast();
          return;
        } catch (error) {
          console.warn('Native pending video save failed, falling back to share:', error);
        }
      }

      const file = new File([blob], filename, { type: 'video/mp4' });
      try {
        if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          setAgentStatus(t('editor.done'));
          showSaveToast();
        } else {
          // Fallback: open in new tab (iOS Safari ignores <a download> for blobs)
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setAgentStatus(t('editor.done'));
          showSaveToast();
          setTimeout(() => URL.revokeObjectURL(url), 120000);
        }
      } catch { /* user cancelled share sheet */ }
      return;
    }

    setIsSaving(true);
    setAgentStatus('Exporting video...');
    // Pause Remotion Player during export to avoid competing for resources
    document.dispatchEvent(new Event('music-play'));
    try {
      const { exportDesignVideo } = await import('@/components/RemotionRenderer');
      const blob = await exportDesignVideo(currentSnap.design, (p) => {
        setAgentStatus(`Exporting video... ${Math.round(p.progress * 100)}%`);
      });

      if (isMobile) {
        const filename = `makaron-design-${Date.now()}.mp4`;
        if (isNativePhotoLibrarySaveAvailable()) {
          try {
            await saveBlobToNativePhotoLibrary(blob, filename, 'video');
            setIsSaving(false);
            setAgentStatus(t('editor.done'));
            showSaveToast();
            return;
          } catch (error) {
            console.warn('Native design video save failed, falling back to web save:', error);
            setAgentStatus('Native save failed, trying fallback...');
          }
        }

        const file = new File([blob], filename, { type: 'video/mp4' });
        if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
          // Mobile + share available: store blob, prompt user to tap Share
          pendingVideoRef.current = { blob, filename };
          setIsSaving(false);
          setAgentStatus(t('editor.videoReady'));
        } else {
          // Mobile but no share (localhost/HTTP): download directly
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          setIsSaving(false);
          setAgentStatus(t('editor.done'));
          showSaveToast();
        }
      } else {
        // Desktop: download directly
        const filename = `makaron-design-${Date.now()}.mp4`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setIsSaving(false);
        setAgentStatus(t('editor.done'));
        showSaveToast();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('MP4 export failed:', msg, e);
      setIsSaving(false);
      setAgentStatus(`Export failed: ${msg.slice(0, 100)}`);
    }
    return;
  }

  // Image download — for designs with editable transforms, re-capture poster to include drag/scale
  const snapIdxForSave = snapFromTimeline(viewIndex, draftParentIndex);
  const snapForSave = snapIdxForSave !== null ? snapshotsRef.current[snapIdxForSave] : undefined;
  let img = timeline[viewIndex];
  if (!img) return;
  setIsSaving(true);
  setAgentStatus('Saving to Photos...');

  try {
    // Re-capture poster for static designs (includes drag/scale transforms via HOC)
    if (snapForSave?.design && !snapForSave.design.animation) {
      try {
        const { captureDesignPoster } = await import('@/components/RemotionRenderer');
        const freshPoster = await captureDesignPoster(snapForSave.design);
        if (freshPoster) img = freshPoster;
      } catch (e) {
        console.warn('Re-capture poster for save failed, using cached:', e);
      }
    }

    // The timeline commonly contains a transformed WebP preview. Save the
    // original persisted snapshot so alpha and the provider output format are
    // not lost to the display optimization pipeline.
    if (!snapForSave?.design && snapForSave?.imageUrl) img = snapForSave.imageUrl;

    const slug = (projectTitle || 'edit').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const idx = (snapIdxForSave ?? viewIndex) + 1;

    const sourceExtension = imageExtensionFromSource(img);
    if (
      isNativePhotoLibrarySaveAvailable()
      && isRemoteHttpUrl(img)
      && (sourceExtension === 'jpg' || sourceExtension === 'png')
    ) {
      try {
        await saveUrlToNativePhotoLibrary(img, `makaron-${slug}-${idx}.${sourceExtension}`, 'image');
        setIsSaving(false);
        setAgentStatus(t('editor.done'));
        showSaveToast();
        return;
      } catch (error) {
        console.warn('Native image URL save failed, falling back to web fetch save:', error);
        setAgentStatus('Native save failed, trying fallback...');
      }
    }

    const res = await fetch(img);
    const blob = await res.blob();
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const filename = `makaron-${slug}-${idx}.${ext}`;

    if (isNativePhotoLibrarySaveAvailable()) {
      try {
        const nativeImage = await normalizeImageBlobForNativeSave(blob);
        const nativeFilename = `makaron-${slug}-${idx}.${nativeImage.filenameExt}`;
        await saveBlobToNativePhotoLibrary(nativeImage.blob, nativeFilename, 'image');
        setIsSaving(false);
        setAgentStatus(t('editor.done'));
        showSaveToast();
        return;
      } catch (error) {
        console.warn('Native image save failed, falling back to web save:', error);
        setAgentStatus('Native save failed, trying fallback...');
      }
    }

    if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
      await navigator.share({ files: [file] });
      setIsSaving(false);
      setAgentStatus(t('editor.done'));
      showSaveToast();
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setIsSaving(false);
    setAgentStatus(t('editor.done'));
    showSaveToast();
  } catch (error) {
    setIsSaving(false);
    setAgentStatus(`Save failed: ${shortErrorMessage(error).slice(0, 80)}`);
    const link = document.createElement('a');
    link.href = img;
    const fallbackExtension = imageExtensionFromSource(img);
    link.download = `ai-edited-${Date.now()}.${fallbackExtension === 'unknown' ? 'png' : fallbackExtension}`;
    link.click();
  }
}
