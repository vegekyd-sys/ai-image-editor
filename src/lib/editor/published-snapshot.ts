import type { Snapshot } from '@/types';

/** Recover a server-published result when navigation arrives before its render event. */
export async function loadPublishedSnapshot(projectId: string, snapshotId: string): Promise<Snapshot | null> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/media`, { cache: 'no-store' });
  if (!response.ok) return null;
  const { media } = await response.json();
  const item = media?.find((entry: { snapshotId?: string }) => entry.snapshotId === snapshotId);
  if (!item?.url || !item.codePath) return null;
  const snapshot: Snapshot = { id: snapshotId, image: item.url, imageUrl: item.url,
    tips: [], messageId: '', description: item.description, designPath: item.codePath };
  const file = await fetch(`/api/workspace/read?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(item.codePath)}`, { cache: 'no-store' });
  if (file.ok) {
    const { content } = await file.json();
    if (typeof content === 'string') {
      const { normalizeLoadedDesignManifest } = await import('./loaded-design-manifest');
      snapshot.design = await normalizeLoadedDesignManifest(JSON.parse(content));
    }
  }
  return snapshot;
}
