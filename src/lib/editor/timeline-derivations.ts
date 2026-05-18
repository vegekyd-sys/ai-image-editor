import { type DesignPayload, type Snapshot } from '@/types';
import { getOptimizedUrl, getThumbnailUrl } from '@/lib/supabase/storage';
import { snapFromTimeline } from './timeline-utils';

export const VIDEO_TIMELINE_SENTINEL = '__VIDEO__';
export const VIDEO_PLACEHOLDER_IMAGE = '/video-placeholder.png';

export function getSnapshotTimelineImage(
  snapshot: Snapshot | undefined,
  snapshotIndex: number,
  viewIndex: number,
): string {
  if (!snapshot) return '';

  // IndexedDB/base64 cache should win: it is already local and avoids network cost.
  if (snapshot.image && !snapshot.image.startsWith('http')) return snapshot.image;

  const url = snapshot.image || snapshot.imageUrl || '';
  if (!url) return '';

  // Current snapshot and neighbors: high-quality WebP. Distant snapshots: thumbnail.
  if (Math.abs(snapshotIndex - viewIndex) <= 1) return getOptimizedUrl(url);
  return getThumbnailUrl(url, 800, 75);
}

export function buildImageTimeline({
  snapshots,
  draftImage,
  draftParentIndex,
  hasAnyAnimation,
  viewIndex,
}: {
  snapshots: Snapshot[];
  draftImage: string | null;
  draftParentIndex: number | null;
  hasAnyAnimation: boolean;
  viewIndex: number;
}): string[] {
  const timeline = snapshots.map((snapshot, index) =>
    getSnapshotTimelineImage(snapshot, index, viewIndex),
  );

  if (draftImage !== null && draftParentIndex !== null) {
    timeline.splice(draftParentIndex + 1, 0, draftImage);
  }

  if (hasAnyAnimation) timeline.push(VIDEO_TIMELINE_SENTINEL);
  return timeline;
}

export function buildDesignsMap(
  snapshots: Snapshot[],
  draftParentIndex: number | null,
): Map<number, DesignPayload> {
  const map = new Map<number, DesignPayload>();
  const hasDraft = draftParentIndex !== null;

  snapshots.forEach((snapshot, snapshotIndex) => {
    if (!snapshot.design) return;
    const timelineIndex = hasDraft && snapshotIndex > draftParentIndex ? snapshotIndex + 1 : snapshotIndex;
    map.set(timelineIndex, snapshot.design);
  });

  return map;
}

export function getNearbyOptimizedPreloadUrls(
  snapshots: Snapshot[],
  viewIndex: number,
): string[] {
  return [viewIndex - 2, viewIndex - 1, viewIndex + 1, viewIndex + 2]
    .filter(index => index >= 0 && index < snapshots.length)
    .map(index => snapshots[index])
    .filter((snapshot): snapshot is Snapshot => !!snapshot)
    .filter(snapshot => !snapshot.image || snapshot.image.startsWith('http'))
    .map(snapshot => snapshot.imageUrl || snapshot.image || '')
    .filter((url): url is string => !!url)
    .map(url => getOptimizedUrl(url));
}

export function getPreviousImageForCompare({
  snapshots,
  viewIndex,
  draftParentIndex,
  isViewingDraft,
}: {
  snapshots: Snapshot[];
  viewIndex: number;
  draftParentIndex: number | null;
  isViewingDraft: boolean;
}): string | undefined {
  let snapshot: Snapshot | undefined;

  if (isViewingDraft && draftParentIndex !== null) {
    snapshot = snapshots[draftParentIndex];
  } else {
    const snapshotIndex = snapFromTimeline(viewIndex, draftParentIndex) ?? 0;
    if (snapshotIndex > 0) snapshot = snapshots[snapshotIndex - 1];
  }

  if (!snapshot) return undefined;
  if (snapshot.image && !snapshot.image.startsWith('http')) return snapshot.image;

  const url = snapshot.image || snapshot.imageUrl || '';
  if (!url) return undefined;
  return getOptimizedUrl(url);
}
