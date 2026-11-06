import { describe, expect, it } from 'vitest';
import { applyOps, applyTx, createTimelineDoc, timelineDuration, TimelineError } from '@/lib/timeline/reducer';
import type { Clip, TimelineDoc, TimelineOp } from '@/lib/timeline/types';

const video = (id: string, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, trackId: 'main', kind: 'video', src: `https://cdn.example/${id}.mp4`, start: 99, duration, ...extra }) as Clip;

function seed(): TimelineDoc {
  let doc = createTimelineDoc();
  doc = applyOps(doc, [
    { op: 'insert', clip: video('a', 3) },
    { op: 'insert', clip: video('b', 2) },
    { op: 'insert', clip: { id: 't', trackId: 'text', kind: 'text', text: 'Hi', start: 0.5, duration: 2, box: { x: 0, y: 0, w: 500, h: 200 } } },
  ]).doc;
  return doc;
}

describe('timeline reducer', () => {
  it.each([
    { op: 'update', id: 'missing', patch: { kind: 'image' } },
    { op: 'remove', id: 'missing' },
    { op: 'split', id: 'missing', at: -1, newId: 'a' },
  ] satisfies TimelineOp[])('keeps the missing-clip error contract for $op', op => {
    const doc = seed();
    const before = structuredClone(doc);
    for (const run of [
      () => applyOps(doc, [op]),
      () => applyTx(doc, { baseRevision: doc.revision, ops: [op] }),
      () => applyOps(doc, [{ op: 'update', id: 'a', patch: { duration: 1 } }, op]),
    ]) {
      let caught: unknown;
      try { run(); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(TimelineError);
      expect(caught).toMatchObject({ name: 'TimelineError', code: 'not_found', message: 'Clip "missing" not found', clipIds: ['missing'] });
      expect(doc).toEqual(before);
    }
  });

  it('packs the main track back-to-back in insertion order', () => {
    const doc = seed();
    expect(doc.clips.a.start).toBe(0);
    expect(doc.clips.b.start).toBe(3);
    expect(timelineDuration(doc)).toBe(5);
    expect(doc.revision).toBe(1);
  });

  it('inserts at a start time between main clips and ripples the rest', () => {
    const doc = applyOps(seed(), [{ op: 'insert', clip: video('mid', 1, { start: 3 }) }]).doc;
    expect([doc.clips.a.start, doc.clips.mid.start, doc.clips.b.start]).toEqual([0, 3, 4]);
  });

  it('trimming a main clip ripples later clips; undo restores', () => {
    const before = seed();
    const { doc, inverse } = applyOps(before, [{ op: 'update', id: 'a', patch: { duration: 2, sourceIn: 1 } }]);
    expect(doc.clips.b.start).toBe(2);
    const undone = applyOps(doc, inverse).doc;
    expect(undone.clips.a.duration).toBe(3);
    expect(undone.clips.a).not.toHaveProperty('sourceIn');
    expect(undone.clips.b.start).toBe(3);
  });

  it('splits video clips and offsets the source', () => {
    const { doc, inverse } = applyOps(seed(), [{ op: 'split', id: 'a', at: 1.25, newId: 'a2' }]);
    expect(doc.clips.a.duration).toBe(1.25);
    expect(doc.clips.a2).toMatchObject({ start: 1.25, duration: 1.75, sourceIn: 1.25 });
    expect(doc.clips.b.start).toBe(3);
    const undone = applyOps(doc, inverse).doc;
    expect(undone.clips.a2).toBeUndefined();
    expect(undone.clips.a.duration).toBe(3);
  });

  it('splits caption segments relative to each half', () => {
    let doc = seed();
    doc = applyOps(doc, [{ op: 'insert', clip: { id: 'cap', trackId: 'caption', kind: 'caption', start: 0, duration: 4, segments: [{ id: 's1', start: 0, end: 2, text: 'one' }, { id: 's2', start: 2, end: 4, text: 'two' }] } }]).doc;
    doc = applyOps(doc, [{ op: 'split', id: 'cap', at: 1, newId: 'cap2' }]).doc;
    const first = doc.clips.cap as Extract<Clip, { kind: 'caption' }>;
    const second = doc.clips.cap2 as Extract<Clip, { kind: 'caption' }>;
    expect(first.segments).toEqual([{ id: 's1', start: 0, end: 1, text: 'one' }]);
    expect(second.segments.map(s => [s.start, s.end, s.text])).toEqual([[0, 1, 'one'], [1, 3, 'two']]);
  });

  it('resolves a pending clip into a video and can undo back to pending', () => {
    let doc = applyOps(seed(), [{ op: 'insert', clip: { id: 'p', trackId: 'overlay', kind: 'pending', target: 'video', start: 1, duration: 3, progress: 0.2 } }]).doc;
    const res = applyOps(doc, [{ op: 'update', id: 'p', patch: { kind: 'video', src: 'https://cdn.example/p.mp4', progress: null, target: null } }]);
    expect(res.doc.clips.p).toMatchObject({ kind: 'video', src: 'https://cdn.example/p.mp4' });
    expect(res.doc.clips.p).not.toHaveProperty('target');
    doc = applyOps(res.doc, res.inverse).doc;
    expect(doc.clips.p).toMatchObject({ kind: 'pending', target: 'video', progress: 0.2 });
    expect(doc.clips.p).not.toHaveProperty('src');
  });

  it('rejects clips on the wrong track and kind changes on real clips', () => {
    expect(() => applyOps(seed(), [{ op: 'insert', clip: { ...video('x', 1), trackId: 'text' } }])).toThrow(TimelineError);
    expect(() => applyOps(seed(), [{ op: 'update', id: 'a', patch: { kind: 'image' } }])).toThrow(/only pending/);
  });

  it('is atomic: a failing op leaves the document untouched', () => {
    const doc = seed();
    expect(() => applyOps(doc, [{ op: 'update', id: 'a', patch: { duration: 1 } }, { op: 'remove', id: 'missing' }])).toThrow(TimelineError);
    expect(doc.clips.a.duration).toBe(3);
  });

  it('rebases transactions that touch different clips and rejects real conflicts', () => {
    const base = seed(); // revision 1
    const userEdit = applyTx(base, { baseRevision: 1, ops: [{ op: 'update', id: 't', patch: { text: 'User text' } }] }).doc;
    // Agent read revision 1, edits a different clip → kept alongside the user's edit
    const merged = applyTx(userEdit, { baseRevision: 1, ops: [{ op: 'update', id: 'b', patch: { duration: 4 } }] }).doc;
    expect((merged.clips.t as Extract<Clip, { kind: 'text' }>).text).toBe('User text');
    expect(merged.clips.b.duration).toBe(4);
    // Agent edits the clip the user changed → conflict
    expect(() => applyTx(userEdit, { baseRevision: 1, ops: [{ op: 'update', id: 't', patch: { text: 'Agent' } }] })).toThrow(/changed since revision 1/);
  });
});
