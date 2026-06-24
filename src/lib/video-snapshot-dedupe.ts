import type { Snapshot } from '@/types';

function videoIdentity(snapshot: Snapshot): string | null {
  if (snapshot.type !== 'video') return null;
  const taskId = snapshot.videoMeta?.taskId;
  const videoUrl = snapshot.videoMeta?.videoUrl;
  if (videoUrl) return `url:${videoUrl.split('#')[0].split('?')[0]}`;
  if (taskId) return `task:${taskId}`;
  return null;
}

function mergeSnapshot(existing: Snapshot, incoming: Snapshot): Snapshot {
  const videoMeta = existing.videoMeta && incoming.videoMeta
    ? {
        ...existing.videoMeta,
        ...incoming.videoMeta,
        videoUrl: incoming.videoMeta.videoUrl || existing.videoMeta.videoUrl || null,
      }
    : existing.videoMeta || incoming.videoMeta;

  return {
    ...existing,
    image: existing.image || incoming.image,
    imageUrl: existing.imageUrl || incoming.imageUrl,
    design: existing.design || incoming.design,
    designPath: existing.designPath || incoming.designPath,
    description: existing.description || incoming.description,
    videoMeta,
  };
}

export function appendSnapshotDedupeVideo(snapshots: Snapshot[], incoming: Snapshot): Snapshot[] {
  const incomingIdentity = videoIdentity(incoming);
  const duplicateIndex = snapshots.findIndex(snapshot =>
    snapshot.id === incoming.id ||
    (!!incomingIdentity && videoIdentity(snapshot) === incomingIdentity),
  );

  if (duplicateIndex === -1) return [...snapshots, incoming];

  return snapshots.map((snapshot, index) =>
    index === duplicateIndex ? mergeSnapshot(snapshot, incoming) : snapshot,
  );
}

export function dedupeVideoSnapshots(snapshots: Snapshot[]): Snapshot[] {
  const seen = new Set<string>();
  const result: Snapshot[] = [];

  for (const snapshot of snapshots) {
    const identity = videoIdentity(snapshot);
    if (!identity) {
      result.push(snapshot);
      continue;
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(snapshot);
  }

  return result.length === snapshots.length ? snapshots : result;
}
