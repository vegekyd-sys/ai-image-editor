import type { Snapshot } from '@/types';
import type { LocaleContextValue } from '@/lib/i18n';
import { isNativePhotoLibrarySaveAvailable, saveBlobToNativePhotoLibrary, saveUrlToNativePhotoLibrary } from '@/lib/native-media';
import { snapFromTimeline } from './timeline-utils';

export interface DownloadAssetParams {
  timeline: string[];
  viewIndex: number;
  isViewingVideo: boolean;
  currentVideoUrl: string | null | undefined;
  draftParentIndex: number | null;
  snapshotsRef: { current: Snapshot[] };
  pendingVideoRef: { current: { blob: Blob; filename: string } | null };
  setIsSaving: (v: boolean) => void;
  setAgentStatus: (msg: string) => void;
  showSaveToast: () => void;
  t: LocaleContextValue['t'];
  projectTitle?: string;
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

async function normalizeImageBlobForNativeSave(blob: Blob): Promise<{ blob: Blob; filenameExt: 'jpg' | 'png' }> {
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
    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Could not encode image for native save'));
      }, 'image/jpeg', 0.95);
    });
    return { blob: jpegBlob, filenameExt: 'jpg' };
  } catch (error) {
    console.warn('Native image save normalization failed, using original image blob:', error);
    return { blob, filenameExt: blob.type === 'image/png' ? 'png' : 'jpg' };
  }
}

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function shortErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

    const slug = (projectTitle || 'edit').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const idx = (snapIdxForSave ?? viewIndex) + 1;

    if (isNativePhotoLibrarySaveAvailable() && isRemoteHttpUrl(img)) {
      try {
        await saveUrlToNativePhotoLibrary(img, `makaron-${slug}-${idx}.jpg`, 'image');
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
    link.download = `ai-edited-${Date.now()}.jpg`;
    link.click();
  }
}
