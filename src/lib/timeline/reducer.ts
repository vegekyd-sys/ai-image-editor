// MTP v1 reducer. Runs identically on the server (edit_timeline tool, API)
// and in the browser (optimistic edits, live Agent tx), so both converge.
import {
  ClipSchema,
  DEFAULT_TRACKS,
  TIMELINE_VERSION,
  TRACK_ACCEPTS,
  TimelineDocSchema,
  type Clip,
  type TimelineDoc,
  type TimelineOp,
  type TimelineTx,
} from './types';

export class TimelineError extends Error {
  constructor(public code: 'invalid' | 'not_found' | 'conflict' | 'stale', message: string, public clipIds: string[] = []) {
    super(message);
    this.name = 'TimelineError';
  }
}

export interface ApplyResult {
  doc: TimelineDoc;
  /** Ops that undo this change when applied to the result. */
  inverse: TimelineOp[];
  changed: string[];
}

const MIN_DURATION = 0.04;
const round = (v: number) => Math.round(v * 1000) / 1000;

export function createTimelineDoc(init: Partial<Pick<TimelineDoc, 'width' | 'height' | 'fps' | 'background'>> = {}): TimelineDoc {
  return {
    version: TIMELINE_VERSION,
    revision: 0,
    width: init.width ?? 1080,
    height: init.height ?? 1920,
    fps: init.fps ?? 30,
    ...(init.background ? { background: init.background } : {}),
    tracks: DEFAULT_TRACKS.map(t => ({ ...t })),
    clips: {},
  };
}

export function parseTimelineDoc(value: unknown): TimelineDoc | null {
  const parsed = TimelineDocSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function clipsOnTrack(doc: TimelineDoc, trackId: string): Clip[] {
  return Object.values(doc.clips).filter(c => c.trackId === trackId).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function mainTrackId(doc: TimelineDoc): string | undefined {
  return doc.tracks.find(t => t.kind === 'main')?.id;
}

/** Visible length of the video: last visual clip end; audio past it is cut. */
export function timelineDuration(doc: TimelineDoc): number {
  const clips = Object.values(doc.clips);
  const visual = clips.filter(c => c.kind !== 'audio' && !(c.kind === 'pending' && trackKind(doc, c.trackId) === 'audio'));
  const pool = visual.length ? visual : clips;
  if (!pool.length) return 1;
  return Math.max(0.5, round(Math.max(...pool.map(clipEnd))));
}

function trackKind(doc: TimelineDoc, trackId: string) {
  return doc.tracks.find(t => t.id === trackId)?.kind;
}

/** Main track is magnetic: clips sit back-to-back from 0 in start order. */
function packMain(doc: TimelineDoc, priority: Set<string>): TimelineDoc {
  const mainId = mainTrackId(doc);
  if (!mainId) return doc;
  const main = Object.values(doc.clips)
    .filter(c => c.trackId === mainId)
    .sort((a, b) => a.start - b.start || Number(priority.has(b.id)) - Number(priority.has(a.id)) || a.id.localeCompare(b.id));
  let t = 0;
  let clips = doc.clips;
  for (const c of main) {
    if (c.start !== t) {
      if (clips === doc.clips) clips = { ...doc.clips };
      clips[c.id] = { ...c, start: round(t) };
    }
    t += c.duration;
  }
  return clips === doc.clips ? doc : { ...doc, clips };
}

function validateClip(doc: TimelineDoc, clip: unknown): Clip {
  const parsed = ClipSchema.safeParse(clip);
  if (!parsed.success) {
    const id = (clip as { id?: string })?.id;
    throw new TimelineError('invalid', `Invalid clip${id ? ` "${id}"` : ''}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'clip'} ${i.message}`).join('; ')}`, id ? [id] : []);
  }
  const c = parsed.data;
  const kind = trackKind(doc, c.trackId);
  if (!kind) throw new TimelineError('invalid', `Track "${c.trackId}" does not exist. Tracks: ${doc.tracks.map(t => `${t.id}(${t.kind})`).join(', ')}`, [c.id]);
  if (!TRACK_ACCEPTS[kind].includes(c.kind)) {
    throw new TimelineError('invalid', `A ${c.kind} clip cannot go on the ${kind} track "${c.trackId}". ${kind} accepts: ${TRACK_ACCEPTS[kind].join(', ')}`, [c.id]);
  }
  return normalizeClip(c);
}

function normalizeClip<T extends Clip>(c: T): T {
  const out = { ...c, start: round(c.start), duration: round(Math.max(MIN_DURATION, c.duration)) } as T;
  if (out.kind === 'caption') {
    const segs = [...out.segments]
      .map(s => ({ ...s, start: round(Math.max(0, s.start)), end: round(Math.max(s.start + MIN_DURATION, s.end)) }))
      .sort((a, b) => a.start - b.start);
    (out as Clip & { kind: 'caption' }).segments = segs;
  }
  if ((out.kind === 'video' || out.kind === 'audio') && out.sourceIn !== undefined) {
    (out as { sourceIn?: number }).sourceIn = round(Math.max(0, out.sourceIn));
  }
  return out;
}

function applyPatch(clip: Clip, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...clip };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'rev') continue;
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}

function reversePatch(prev: Clip, patch: Record<string, unknown>): Record<string, unknown> {
  const rev: Record<string, unknown> = {};
  const prevRecord = prev as unknown as Record<string, unknown>;
  for (const k of Object.keys(patch)) {
    if (k === 'id' || k === 'rev') continue;
    rev[k] = k in prevRecord ? prevRecord[k] : null;
  }
  // Main-track packing may move the clip; restore its position too.
  if (!('start' in rev)) rev.start = prev.start;
  return rev;
}

function applyOne(doc: TimelineDoc, op: TimelineOp, inverse: TimelineOp[], changed: Set<string>): TimelineDoc {
  switch (op.op) {
    case 'insert': {
      if (doc.clips[op.clip.id]) throw new TimelineError('invalid', `Clip id "${op.clip.id}" already exists`, [op.clip.id]);
      const clip = validateClip(doc, op.clip);
      inverse.unshift({ op: 'remove', id: clip.id });
      changed.add(clip.id);
      return { ...doc, clips: { ...doc.clips, [clip.id]: clip } };
    }
    case 'update': {
      const prev = doc.clips[op.id];
      if (!prev) throw new TimelineError('not_found', `Clip "${op.id}" not found`, [op.id]);
      const nextKind = (op.patch.kind as string | undefined) ?? prev.kind;
      if (nextKind !== prev.kind && prev.kind !== 'pending') {
        throw new TimelineError('invalid', `Clip "${op.id}" is ${prev.kind}; only pending clips can change kind`, [op.id]);
      }
      const clip = validateClip(doc, applyPatch(prev, op.patch));
      if (prev.kind !== clip.kind) inverse.unshift({ op: 'remove', id: op.id }, { op: 'insert', clip: prev });
      else inverse.unshift({ op: 'update', id: op.id, patch: reversePatch(prev, op.patch) });
      changed.add(op.id);
      return { ...doc, clips: { ...doc.clips, [op.id]: clip } };
    }
    case 'remove': {
      const prev = doc.clips[op.id];
      if (!prev) throw new TimelineError('not_found', `Clip "${op.id}" not found`, [op.id]);
      const clips = { ...doc.clips };
      delete clips[op.id];
      inverse.unshift({ op: 'insert', clip: prev });
      changed.add(op.id);
      return { ...doc, clips };
    }
    case 'split': {
      const prev = doc.clips[op.id];
      if (!prev) throw new TimelineError('not_found', `Clip "${op.id}" not found`, [op.id]);
      if (doc.clips[op.newId]) throw new TimelineError('invalid', `Clip id "${op.newId}" already exists`, [op.newId]);
      if (prev.kind === 'pending') throw new TimelineError('invalid', 'Pending clips cannot be split', [op.id]);
      const offset = round(op.at - prev.start);
      if (offset < MIN_DURATION || offset > prev.duration - MIN_DURATION) {
        throw new TimelineError('invalid', `Split point ${op.at}s is outside clip "${op.id}" (${prev.start}–${clipEnd(prev)}s)`, [op.id]);
      }
      let first: Clip = { ...prev, duration: offset } as Clip;
      let second: Clip = { ...prev, id: op.newId, start: round(prev.start + offset), duration: round(prev.duration - offset) } as Clip;
      if (prev.kind === 'video' || prev.kind === 'audio') {
        second = { ...second, sourceIn: round((prev.sourceIn ?? 0) + offset) } as Clip;
      }
      if (prev.kind === 'caption') {
        first = { ...first, segments: prev.segments.filter(s => s.start < offset).map(s => ({ ...s, end: Math.min(s.end, offset) })) } as Clip;
        second = {
          ...second,
          segments: prev.segments.filter(s => s.end > offset).map(s => ({ ...s, id: s.start < offset ? `${s.id}-b` : s.id, start: Math.max(0, s.start - offset), end: s.end - offset })),
        } as Clip;
      }
      inverse.unshift({ op: 'remove', id: op.newId }, { op: 'update', id: op.id, patch: reversePatch(prev, { duration: 1, ...(prev.kind === 'caption' ? { segments: 1 } : {}) }) });
      changed.add(op.id);
      changed.add(op.newId);
      return { ...doc, clips: { ...doc.clips, [op.id]: validateClip(doc, first), [op.newId]: validateClip(doc, second) } };
    }
    case 'set_meta': {
      const { op: _op, ...meta } = op;
      const prevMeta: TimelineOp = { op: 'set_meta' };
      for (const k of Object.keys(meta) as (keyof typeof meta)[]) {
        if (meta[k] !== undefined) (prevMeta as Record<string, unknown>)[k] = doc[k];
      }
      inverse.unshift(prevMeta);
      return { ...doc, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) };
    }
  }
}

/** Apply ops atomically. Throws TimelineError; the input doc is never mutated. */
export function applyOps(doc: TimelineDoc, ops: TimelineOp[]): ApplyResult {
  const inverse: TimelineOp[] = [];
  const changed = new Set<string>();
  let next = doc;
  for (const op of ops) next = applyOne(next, op, inverse, changed);
  next = packMain(next, changed);
  const revision = doc.revision + 1;
  const clips = { ...next.clips };
  for (const id of changed) if (clips[id]) clips[id] = { ...clips[id], rev: revision };
  // Positions moved by main-track packing count as changes for observers.
  for (const c of Object.values(clips)) if (doc.clips[c.id] && doc.clips[c.id].start !== c.start) changed.add(c.id);
  return { doc: { ...next, clips, revision }, inverse, changed: [...changed] };
}

function touchedIds(ops: TimelineOp[]): string[] {
  return ops.flatMap(op => op.op === 'insert' ? [op.clip.id] : op.op === 'split' ? [op.id, op.newId] : op.op === 'set_meta' ? [] : [op.id]);
}

/**
 * Apply a transaction made against `tx.baseRevision`. Edits to other clips
 * made since then are kept (element-level rebase); if a clip this tx touches
 * changed after baseRevision, the tx is rejected as a conflict.
 */
export function applyTx(doc: TimelineDoc, tx: Pick<TimelineTx, 'baseRevision' | 'ops'>): ApplyResult {
  if (tx.baseRevision > doc.revision) throw new TimelineError('stale', `baseRevision ${tx.baseRevision} is ahead of current revision ${doc.revision}`);
  if (tx.baseRevision < doc.revision) {
    const conflicts = touchedIds(tx.ops).filter(id => (doc.clips[id]?.rev ?? 0) > tx.baseRevision);
    if (conflicts.length) {
      throw new TimelineError('conflict', `Clips changed since revision ${tx.baseRevision}: ${conflicts.join(', ')}. Re-read the timeline and retry.`, conflicts);
    }
  }
  return applyOps(doc, tx.ops);
}

export function newClipId(prefix = 'c'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}
