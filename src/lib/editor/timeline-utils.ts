import { Snapshot } from '@/types';

// Semaphore to limit concurrent /api/tips requests across all snapshots.
// Single image: 4 categories run in parallel (fine). Multi-image: 10 images × 4 = 40 concurrent → rate limit risk.
// With maxConcurrent=4, multi-image tips are effectively serialized per snapshot.
const _tipsQueue: Array<() => void> = [];
let _tipsRunning = 0;
const TIPS_MAX_CONCURRENT = 20;

export function acquireTipsSlot(): Promise<void> {
  if (_tipsRunning < TIPS_MAX_CONCURRENT) { _tipsRunning++; return Promise.resolve(); }
  return new Promise(resolve => _tipsQueue.push(resolve));
}

export function releaseTipsSlot() {
  _tipsRunning--;
  const next = _tipsQueue.shift();
  if (next) { _tipsRunning++; next(); }
}

export function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

/** Map a timeline index to the corresponding snapshot index.
 *  Returns null when the timeline index points at the virtual draft entry. */
export function snapFromTimeline(timelineIdx: number, draftParentIdx: number | null): number | null {
  if (draftParentIdx === null) return timelineIdx;
  if (timelineIdx === draftParentIdx + 1) return null; // draft slot
  if (timelineIdx <= draftParentIdx) return timelineIdx;
  return timelineIdx - 1; // shift back past the draft slot
}

/** Map a snapshot index to its timeline index (accounting for draft slot). */
export function timelineFromSnap(snapIdx: number, draftParentIdx: number | null): number {
  if (draftParentIdx === null || snapIdx <= draftParentIdx) return snapIdx;
  return snapIdx + 1;
}

/** Get best image representation for API calls: URL if available (tiny payload), else raw image (base64) */
export function getImageForApi(snapshot: Snapshot | undefined): string {
  return snapshot?.imageUrl || snapshot?.image || '';
}
