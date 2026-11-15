import type { DesignPayload, Snapshot } from '@/types';

export interface GuestEditableDraft {
  version: 1;
  projectId: string;
  cachedAt: number;
  designs: Record<string, DesignPayload>;
}

export function updateGuestEditableDraft(projectId: string, draft: GuestEditableDraft | null, snapshotId: string, design: DesignPayload): GuestEditableDraft {
  return {
    version: 1, projectId,
    cachedAt: Date.now(),
    designs: { ...draft?.designs, [snapshotId]: design },
  };
}

// Apply only after fresh access checks and design hydration. A changed source
// composition must not silently inherit edits intended for its previous code.
export function applyGuestEditableDraft(snapshots: Snapshot[], draft: GuestEditableDraft | null): Snapshot[] {
  if (!draft) return snapshots;
  return snapshots.map(snapshot => {
    const edited = draft.designs[snapshot.id];
    if (!snapshot.design || !edited || snapshot.design.code !== edited.code) return snapshot;
    return { ...snapshot, design: { ...edited, __makaronEditableRevision: Math.max(draft.cachedAt, edited.__makaronEditableRevision || 0) } };
  });
}
