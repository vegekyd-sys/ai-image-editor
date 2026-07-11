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
  return snapshot?.type === 'video' && !isSourceUploadVideoSnapshot(snapshot);
}

export function isCompletedGeneratedVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return isGeneratedVideoSnapshot(snapshot)
    && snapshot?.videoMeta?.status === 'completed'
    && Boolean(snapshot.videoMeta.videoUrl);
}

export function isFailedGeneratedVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return isGeneratedVideoSnapshot(snapshot) && snapshot?.videoMeta?.status === 'failed';
}
