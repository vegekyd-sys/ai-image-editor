'use client';

// Client side of a timeline video. The workspace design JSON (written by the
// timeline API and the Agent's edit_timeline tool) is the durable copy; this
// hook keeps an optimistic local doc in the Editor's snapshot state, batches
// user ops into transactions, folds in live Agent transactions, owns the undo
// stack (each Agent tx is one undo step) and drives the Remotion Player.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerRef } from '@remotion/player';
import type { Snapshot } from '@/types';
import { timelineToDesign } from '@/lib/timeline/design';
import { applyOps, parseTimelineDoc } from '@/lib/timeline/reducer';
import type { TimelineDoc, TimelineOp } from '@/lib/timeline/types';

export interface TimelineTxEvent {
  snapshotId: string;
  txId?: string;
  label?: string;
  baseRevision: number;
  revision: number;
  ops: TimelineOp[];
  inverse?: TimelineOp[];
  changed?: string[];
  focusTime?: number;
}

interface Options {
  projectId: string | null | undefined;
  snapshot: Snapshot | undefined;
  doc: TimelineDoc | null;
  setSnapshots: Dispatch<SetStateAction<Snapshot[]>>;
  isAgentActive: boolean;
  readOnly?: boolean;
  onSyncError?: () => void;
}

type UndoEntry = { inverse: TimelineOp[]; author: 'user' | 'agent' };

const FLUSH_MS = 350;

export function useTimelineEditor({ projectId, snapshot, doc, setSnapshots, isAgentActive, readOnly, onSyncError }: Options) {
  const snapshotId = doc ? snapshot?.id : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [agentClipId, setAgentClipId] = useState<string | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);

  const docRef = useRef<TimelineDoc | null>(doc);
  docRef.current = doc;
  const snapshotIdRef = useRef(snapshotId);
  snapshotIdRef.current = snapshotId;
  const serverRevision = useRef(new Map<string, number>());
  const pending = useRef<TimelineOp[]>([]);
  const inflight = useRef<TimelineOp[] | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const gestureOpen = useRef(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const fps = doc?.fps ?? 30;

  // Reset per-video state when the viewed timeline changes.
  useEffect(() => {
    setSelectedId(null);
    undoStack.current = [];
    setUndoDepth(0);
    gestureOpen.current = false;
    if (snapshotId && docRef.current && !serverRevision.current.has(snapshotId)) {
      serverRevision.current.set(snapshotId, docRef.current.revision);
    }
  }, [snapshotId]);

  const writeDoc = useCallback((id: string, next: TimelineDoc) => {
    if (id === snapshotIdRef.current) docRef.current = next;
    setSnapshots(prev => prev.map(s => (s.id === id && s.design ? { ...s, design: timelineToDesign(next, s.design) } : s)));
  }, [setSnapshots]);

  const resync = useCallback(async (id: string) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(id)}/timeline`, { credentials: 'same-origin' });
    const payload = await res.json().catch(() => null) as { timeline?: unknown } | null;
    const fresh = parseTimelineDoc(payload?.timeline);
    if (!fresh) return;
    serverRevision.current.set(id, fresh.revision);
    pending.current = [];
    writeDoc(id, fresh);
  }, [projectId, writeDoc]);

  const flush = useCallback(async (keepalive = false) => {
    const id = snapshotIdRef.current;
    if (!id || !projectId || readOnly || inflight.current || !pending.current.length) return;
    const ops = pending.current;
    pending.current = [];
    inflight.current = ops;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(id)}/timeline`, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRevision: serverRevision.current.get(id) ?? 0, ops }),
      });
      const payload = await res.json().catch(() => null) as { timeline?: unknown; revision?: number } | null;
      const server = parseTimelineDoc(payload?.timeline);
      if (!server) throw new Error(`timeline save failed (${res.status})`);
      serverRevision.current.set(id, server.revision);
      if (!res.ok) {
        // Conflict: the server copy wins; local edits made meanwhile are replayed if still valid.
        onSyncError?.();
      }
      let next = server;
      if (pending.current.length) {
        try { next = { ...applyOps(server, pending.current).doc, revision: server.revision }; } catch { pending.current = []; }
      }
      if (id === snapshotIdRef.current) writeDoc(id, next);
    } catch {
      onSyncError?.();
      await resync(id).catch(() => undefined);
    } finally {
      inflight.current = null;
      if (pending.current.length) flushTimer.current = setTimeout(() => void flush(), FLUSH_MS);
    }
  }, [projectId, readOnly, writeDoc, resync, onSyncError]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), FLUSH_MS);
  }, [flush]);

  useEffect(() => {
    const onHide = () => void flush(true);
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); void flush(true); };
  }, [flush, snapshotId]);

  /** Start a new undo step (a drag, a typing session, a button press). */
  const beginGesture = useCallback(() => {
    undoStack.current.push({ inverse: [], author: 'user' });
    if (undoStack.current.length > 60) undoStack.current.shift();
    gestureOpen.current = true;
    setUndoDepth(undoStack.current.length);
  }, []);

  const dispatchInternal = useCallback((ops: TimelineOp[], record: boolean) => {
    const id = snapshotIdRef.current;
    const current = docRef.current;
    if (!id || !current || readOnly) return false;
    let result;
    try { result = applyOps(current, ops); } catch { return false; }
    if (record) {
      if (!gestureOpen.current || !undoStack.current.length) beginGesture();
      const top = undoStack.current[undoStack.current.length - 1];
      top.inverse = [...result.inverse, ...top.inverse];
    }
    // Local optimistic edits keep the last server revision: revision always
    // means "last state confirmed by the server", which replay dedupe relies on.
    writeDoc(id, { ...result.doc, revision: current.revision });
    pending.current.push(...ops);
    scheduleFlush();
    return true;
  }, [readOnly, writeDoc, scheduleFlush, beginGesture]);

  const dispatch = useCallback((op: TimelineOp) => { dispatchInternal([op], true); }, [dispatchInternal]);

  const undo = useCallback(() => {
    gestureOpen.current = false;
    while (undoStack.current.length) {
      const entry = undoStack.current.pop()!;
      setUndoDepth(undoStack.current.length);
      if (entry.inverse.length && dispatchInternal(entry.inverse, false)) return;
    }
  }, [dispatchInternal]);

  // ── Player ──
  useEffect(() => {
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setTime(e.detail.frame / fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('seeked', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    setPlaying(player.isPlaying());
    setTime(player.getCurrentFrame() / fps);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('seeked', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [player, fps]);

  const seek = useCallback((t: number) => {
    const frame = Math.max(0, Math.round(t * fps));
    player?.seekTo(frame);
    setTime(frame / fps);
  }, [player, fps]);

  const pause = useCallback(() => { if (player?.isPlaying()) player.pause(); }, [player]);

  // ── Agent following ──
  const userInteracted = useCallback(() => {
    if (isAgentActive && followRef.current) setFollow(false);
  }, [isAgentActive]);

  useEffect(() => {
    if (!isAgentActive) { setAgentClipId(null); setFollow(true); }
  }, [isAgentActive]);

  const applyRemoteTx = useCallback((event: TimelineTxEvent) => {
    const isCurrent = event.snapshotId === snapshotIdRef.current && !!docRef.current;
    const known = serverRevision.current.get(event.snapshotId) ?? (isCurrent ? docRef.current!.revision : undefined);
    if (known !== undefined && event.revision <= known) return; // already folded in (replay / reconnect)
    serverRevision.current.set(event.snapshotId, event.revision);
    if (!isCurrent) {
      // Another (or not-yet-viewed) timeline: fold into its snapshot state when possible.
      setSnapshots(prev => prev.map(s => {
        if (s.id !== event.snapshotId || !s.design) return s;
        const tl = parseTimelineDoc(s.design.props?.timeline);
        if (!tl || tl.revision >= event.revision) return s;
        try {
          const next = { ...applyOps(tl, event.ops).doc, revision: event.revision };
          return { ...s, design: timelineToDesign(next, s.design) };
        } catch { return s; }
      }));
      return;
    }
    try {
      const applied = applyOps(docRef.current!, event.ops).doc;
      writeDoc(event.snapshotId, { ...applied, revision: event.revision });
    } catch {
      void resync(event.snapshotId);
      return;
    }
    if (event.inverse?.length) {
      undoStack.current.push({ inverse: event.inverse, author: 'agent' });
      gestureOpen.current = false;
      setUndoDepth(undoStack.current.length);
    }
    const focusId = event.changed?.find(cid => docRef.current?.clips[cid]) ?? null;
    setAgentClipId(focusId);
    if (followRef.current) {
      const target = event.focusTime ?? (focusId ? docRef.current?.clips[focusId]?.start : undefined);
      if (target !== undefined && player) {
        if (player.isPlaying()) player.pause();
        const clip = focusId ? docRef.current?.clips[focusId] : undefined;
        const t = clip ? Math.min(clip.start + clip.duration - 0.05, Math.max(clip.start, target + 0.05)) : target;
        player.seekTo(Math.max(0, Math.round(t * fps)));
      }
    }
  }, [setSnapshots, writeDoc, resync, player, fps]);

  return {
    doc,
    snapshotId,
    selectedId,
    select: setSelectedId,
    focusToken,
    focusInput: () => setFocusToken(t => t + 1),
    time,
    playing,
    setPlayer,
    seek,
    pause,
    dispatch,
    beginGesture,
    undo,
    canUndo: undoDepth > 0,
    agentClipId: isAgentActive ? agentClipId : null,
    followPaused: isAgentActive && !follow,
    resumeFollow: () => setFollow(true),
    userInteracted,
    applyRemoteTx,
  };
}

export type TimelineEditor = ReturnType<typeof useTimelineEditor>;
