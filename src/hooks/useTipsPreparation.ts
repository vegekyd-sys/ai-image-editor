'use client';

import { useCallback, useState } from 'react';

/** Track work before /api/tips starts, including persistence and compression. */
export function useTipsPreparation(hasPendingImages: boolean) {
  const [isStartupPending, setStartupPending] = useState(hasPendingImages);
  const [preparingSnapshotIds, setPreparingSnapshotIds] = useState<Set<string>>(() => new Set());
  const beginStartup = useCallback(() => setStartupPending(true), []);
  const finishStartup = useCallback(() => setStartupPending(false), []);
  const prepare = useCallback(async (snapshotId: string, task: () => Promise<void>) => {
    setPreparingSnapshotIds(previous => new Set(previous).add(snapshotId));
    try {
      await task();
    } finally {
      setPreparingSnapshotIds(previous => {
        const next = new Set(previous);
        next.delete(snapshotId);
        return next;
      });
    }
  }, []);

  return { isStartupPending, preparingSnapshotIds, beginStartup, finishStartup, prepare };
}
