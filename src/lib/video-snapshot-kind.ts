import type { Snapshot, VideoMeta } from '@/types';

export function isSourceUploadVideoMeta(meta?: VideoMeta | null): boolean {
  if (!meta) return false;
  return meta.model === 'upload'
    && !meta.taskId
    && !meta.prompt.trim()
    && meta.sourceSnapshotIds.length === 0
    && meta.sourceUrls.length === 0;
}

export function isSourceUploadVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return snapshot?.type === 'video' && isSourceUploadVideoMeta(snapshot.videoMeta);
}

export function isGeneratedVideoSnapshot(snapshot?: Snapshot | null): boolean {
  return snapshot?.type === 'video' && !isSourceUploadVideoSnapshot(snapshot);
}
