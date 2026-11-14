'use client';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Snapshot } from '@/types';
import { applyLayerizeFonts, layerizeFontsReference, parseLayerizeFontsResult, type LayerizeFontsResult } from '@/lib/layerize-fonts';

/** Background metadata never replaces a user's content or enters undo/redo history. */
export function useLayerizeFonts(projectId: string | undefined, snapshots: Snapshot[], setSnapshots: Dispatch<SetStateAction<Snapshot[]>>) {
  const completed = useRef(new Map<string, LayerizeFontsResult>());
  const active = useRef(new Map<string, AbortController>());
  useEffect(() => {
    for (const snapshot of snapshots) {
      const ref = snapshot.design && layerizeFontsReference(snapshot.design);
      if (!ref || ref.projectId !== projectId || ref.snapshotId !== snapshot.id || ref.status !== 'pending') continue;
      const cached = completed.current.get(snapshot.id);
      if (cached) {
        setSnapshots(current => current.map(item => item.id === snapshot.id && item.design ? { ...item, design: applyLayerizeFonts(item.design, cached) } : item));
        continue;
      }
      if (active.current.has(snapshot.id)) continue;
      const abort = new AbortController(); active.current.set(snapshot.id, abort);
      void (async () => {
        for (let attempt = 0; attempt < 60 && !abort.signal.aborted; attempt++) {
          try {
            const response = await fetch(`/api/projects/${ref.projectId}/snapshots/${ref.snapshotId}/fonts`, { cache: 'no-store', signal: abort.signal });
            if (response.ok) {
              const value = await response.json();
              if (value.status !== 'pending') {
                const result = parseLayerizeFontsResult(value);
                if (abort.signal.aborted) return;
                completed.current.set(snapshot.id, result);
                setSnapshots(current => current.map(item => item.id === snapshot.id && item.design && layerizeFontsReference(item.design)?.snapshotId === ref.snapshotId
                  ? { ...item, design: applyLayerizeFonts(item.design, result) } : item));
                return;
              }
            }
          } catch { if (abort.signal.aborted) return; }
          await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 2000); abort.signal.addEventListener('abort', done, { once: true }); });
        }
      })().finally(() => { if (active.current.get(snapshot.id) === abort) active.current.delete(snapshot.id); });
    }
  }, [projectId, snapshots, setSnapshots]);
  useEffect(() => {
    const requests = active.current, cache = completed.current;
    return () => { for (const abort of requests.values()) abort.abort(); requests.clear(); cache.clear(); };
  }, [projectId]);
}
