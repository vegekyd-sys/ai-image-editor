import type { Snapshot, VideoMeta } from '@/types';
import type { LocaleContextValue } from '@/lib/i18n';
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
  onCreateExportSnapshot?: (snapshot: Snapshot) => void;
  onUpdateExportSnapshot?: (snapshotId: string, videoMeta: VideoMeta) => void;
  t: LocaleContextValue['t'];
  projectTitle?: string;
  projectId?: string;
}

async function pollRemotionExport(jobId: string, onProgress: (progress: number | null) => void): Promise<{
  url: string;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}> {
  while (true) {
    const res = await fetch(`/api/remotion/export/${jobId}`);
    if (!res.ok) throw new Error(`Export status failed: ${res.status}`);
    const data = await res.json();
    if (data.status === 'completed') {
      const url = data.url || data.storageUrl || data.storage_url;
      if (!url) throw new Error('Export completed without a video URL');
      return {
        url,
        durationSeconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : null,
        width: typeof data.width === 'number' ? data.width : null,
        height: typeof data.height === 'number' ? data.height : null,
      };
    }
    if (data.status === 'failed') {
      throw new Error(data.error || 'Export failed');
    }
    onProgress(typeof data.progress === 'number' ? data.progress : null);
    await new Promise(resolve => setTimeout(resolve, data.next_poll_after_ms || 3000));
  }
}

async function downloadVideoBlob(videoSrc: string): Promise<Blob> {
  const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(videoSrc)}&download=1`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
  return res.blob();
}

function triggerVideoDownload(videoSrc: string, filename: string): void {
  const link = document.createElement('a');
  link.href = videoSrc;
  link.download = filename;
  if (/^https?:\/\//i.test(videoSrc) && !videoSrc.startsWith(window.location.origin)) {
    link.target = '_blank';
    link.rel = 'noopener';
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function saveVideoUrl(videoSrc: string, filename: string): Promise<void> {
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  if (!isMobile) {
    triggerVideoDownload(videoSrc, filename);
    return;
  }

  const blob = await downloadVideoBlob(videoSrc);
  const file = new File([blob], filename, { type: 'video/mp4' });
  // Try native share (iOS/Android) — wrapped in its own try/catch so share failure
  // falls through to blob download instead of navigating away.
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch { /* share failed (gesture expired, user cancelled) — fall through to blob download */ }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadAsset(params: DownloadAssetParams): Promise<void> {
  const {
    timeline,
    viewIndex,
    isViewingVideo,
    currentVideoUrl,
    draftParentIndex,
    snapshotsRef,
    setIsSaving,
    setAgentStatus,
    showSaveToast,
    t,
    projectTitle,
    projectId,
  } = params;

  // Video download — proxy through our API to avoid CORS
  if (isViewingVideo && currentVideoUrl) {
    const videoSrc = currentVideoUrl;
    const filename = `makaron-video-${Date.now()}.mp4`;
    setIsSaving(true);
    try {
      await saveVideoUrl(videoSrc, filename);
      setIsSaving(false);
      showSaveToast();
    } catch {
      setIsSaving(false);
      window.open(videoSrc, '_blank');
    }
    return;
  }

  // Animated design → export as MP4 via backend Remotion worker
  const snapIdx = snapFromTimeline(viewIndex, draftParentIndex);
  const currentSnap = snapIdx !== null ? snapshotsRef.current[snapIdx] : undefined;
  if (currentSnap?.design?.animation) {
    setIsSaving(true);
    // Pause Remotion Player during export to avoid competing for resources
    document.dispatchEvent(new Event('music-play'));
    try {
      if (!projectId) throw new Error('Project context is required for MP4 export');

      const createRes = await fetch('/api/remotion/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          snapshotId: currentSnap.id,
          designPath: currentSnap.designPath,
          design: currentSnap.design,
          outputType: 'video',
          renderProfile: 'fast_720p',
          publish: false,
          name: `save-${currentSnap.id || Date.now()}`,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || `Export failed: ${createRes.status}`);
      const jobId = created.jobId || created.id;
      if (!jobId) throw new Error('Export job was not created');

      setAgentStatus('Exporting video...');
      const finish = async () => {
        const exported = created.status === 'completed' && (created.url || created.storageUrl || created.storage_url)
          ? {
              url: created.url || created.storageUrl || created.storage_url,
              durationSeconds: typeof created.duration_seconds === 'number' ? created.duration_seconds : null,
              width: typeof created.width === 'number' ? created.width : null,
              height: typeof created.height === 'number' ? created.height : null,
          }
          : await pollRemotionExport(jobId, (progress) => {
        if (progress !== null && progress >= 0.995) setAgentStatus('Preparing download...');
        else if (progress !== null) setAgentStatus(`Exporting video... ${Math.round(progress * 100)}%`);
        else setAgentStatus('Exporting video...');
      });
        setAgentStatus('Downloading video...');
        try {
          await saveVideoUrl(exported.url, `makaron-${projectTitle || 'composition'}-${Date.now()}.mp4`);
          setAgentStatus(t('editor.done'));
          showSaveToast();
        } finally {
          setIsSaving(false);
        }
      };
      void finish().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setIsSaving(false);
        setAgentStatus(`Export failed: ${msg.slice(0, 100)}`);
      });
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

    const res = await fetch(img);
    const blob = await res.blob();
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
    const slug = (projectTitle || 'edit').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const idx = (snapIdxForSave ?? viewIndex) + 1;
    const filename = `makaron-${slug}-${idx}.${ext}`;

    if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
      await navigator.share({ files: [file] });
      setIsSaving(false);
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
    showSaveToast();
  } catch {
    setIsSaving(false);
    const link = document.createElement('a');
    link.href = img;
    link.download = `ai-edited-${Date.now()}.jpg`;
    link.click();
  }
}
