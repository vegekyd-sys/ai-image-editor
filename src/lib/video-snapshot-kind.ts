import type { Snapshot, VideoMeta } from '@/types';

export function isSourceUploadVideoMeta(meta?: VideoMeta | null): boolean {
  if (!meta) return false;
  if (meta.origin) return meta.origin === 'source-upload';
  // Legacy rows predate explicit provenance. Every real upload has no provider
  // task, while Remotion/workspace/ffmpeg outputs always receive one.
  return meta.model === 'upload' && !meta.taskId;
}

export function isSourceUploadVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return snapshot?.type === 'video' && isSourceUploadVideoMeta(snapshot.videoMeta);
}

export function isGeneratedVideoSnapshot(snapshot?: Snapshot | null): boolean {
  if (snapshot?.type !== 'video') return false;

  // Newer snapshots carry explicit provenance. Respect it before applying the
  // legacy heuristic so external source ranges stay in the Media List and are
  // never restored into CUI as completed generated videos.
  if (snapshot.videoMeta?.origin) {
    return snapshot.videoMeta.origin === 'generated';
  }

  return !isSourceUploadVideoSnapshot(snapshot);
}

export function isCompletedGeneratedVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return isGeneratedVideoSnapshot(snapshot)
    && snapshot?.videoMeta?.status === 'completed'
    && Boolean(snapshot.videoMeta.videoUrl);
}

export function isFailedGeneratedVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return isGeneratedVideoSnapshot(snapshot) && snapshot?.videoMeta?.status === 'failed';
}
