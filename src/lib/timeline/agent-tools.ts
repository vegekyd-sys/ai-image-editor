// Agent tools for timeline videos: create_timeline, get_timeline, edit_timeline.
// Each edit_timeline call is one user-perceivable step (one transaction): it is
// applied server-side with the shared reducer, persisted to the design JSON,
// and streamed to open pages as a `timeline_tx` event for live display.
import { randomUUID } from 'crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveMediaMarkersInValue } from '@/lib/media-markers';
import type { DesignPayload } from '@/types';
import { timelineToDesign } from './design';
import { applyOps, applyTx, clipEnd, createTimelineDoc, newClipId, timelineDuration, TimelineError } from './reducer';
import { loadTimelineFile, writeTimelineFile } from './server';
import { TimelineOpSchema, type Clip, type TimelineDoc, type TimelineOp } from './types';

/** Minimal slice of AgentContext these tools rely on (kept structural to avoid import cycles). */
export interface TimelineToolContext {
  projectId: string;
  supabase?: any;
  userId?: string;
  snapshotImages: string[];
  currentDesignPath?: string;
}

export type TimelineTxStreamEvent = {
  type: 'timeline_tx';
  snapshotId: string;
  txId: string;
  label?: string;
  baseRevision: number;
  revision: number;
  ops: TimelineOp[];
  inverse: TimelineOp[];
  changed: string[];
  focusTime?: number;
};

type Cached = { doc: TimelineDoc; designPath: string; file?: Record<string, unknown> };
function cache(ctx: TimelineToolContext): Map<string, Cached> {
  const c = ctx as TimelineToolContext & { __timelines?: Map<string, Cached> };
  c.__timelines ??= new Map();
  return c.__timelines;
}
export function queueTimelineEvent(ctx: TimelineToolContext, event: TimelineTxStreamEvent) {
  const c = ctx as TimelineToolContext & { __timelineEvents?: TimelineTxStreamEvent[] };
  (c.__timelineEvents ??= []).push(event);
}
export function drainTimelineEvents(ctx: unknown): TimelineTxStreamEvent[] {
  const c = ctx as { __timelineEvents?: TimelineTxStreamEvent[] };
  const events = c.__timelineEvents || [];
  c.__timelineEvents = [];
  return events;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Compact, model-friendly view of a timeline. */
export function describeTimeline(doc: TimelineDoc, snapshotId: string): Record<string, unknown> {
  const kindOf = Object.fromEntries(doc.tracks.map(t => [t.id, t.kind]));
  const clips = Object.values(doc.clips)
    .sort((a, b) => doc.tracks.findIndex(t => t.id === a.trackId) - doc.tracks.findIndex(t => t.id === b.trackId) || a.start - b.start)
    .map((c: Clip) => {
      const base: Record<string, unknown> = { id: c.id, track: c.trackId, kind: c.kind, start: r2(c.start), end: r2(clipEnd(c)) };
      if (c.label) base.label = c.label;
      if (c.kind === 'video' || c.kind === 'audio') { base.src = c.src; if (c.sourceIn) base.sourceIn = c.sourceIn; }
      if (c.kind === 'image') base.src = c.src;
      if (c.kind === 'text') { base.text = c.text; base.box = c.box; if (c.style) base.style = c.style; }
      if (c.kind === 'caption') { base.segments = c.segments.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text })); if (c.style) base.style = c.style; }
      if (c.kind === 'pending') { base.target = c.target; base.progress = c.progress; }
      if ('box' in c && c.box && c.kind !== 'text') base.box = c.box;
      if (c.enter) base.enter = c.enter;
      return base;
    });
  return {
    snapshot_id: snapshotId,
    revision: doc.revision,
    size: `${doc.width}x${doc.height}`,
    fps: doc.fps,
    duration: timelineDuration(doc),
    tracks: doc.tracks.map(t => `${t.id}(${kindOf[t.id]})`),
    clips,
  };
}

async function resolveTarget(ctx: TimelineToolContext, input: { snapshot_id?: string; media_index?: number }): Promise<{ snapshotId: string; designPath: string } | { error: string }> {
  if (!ctx.supabase || !ctx.userId) return { error: 'Timeline tools require an authenticated project workspace.' };
  if (input.snapshot_id) {
    const hit = cache(ctx).get(input.snapshot_id);
    if (hit) return { snapshotId: input.snapshot_id, designPath: hit.designPath };
    const { data } = await ctx.supabase.from('snapshots').select('id, design_path').eq('project_id', ctx.projectId).eq('id', input.snapshot_id).maybeSingle();
    if (!data?.design_path) return { error: `Snapshot ${input.snapshot_id} is not a timeline video.` };
    return { snapshotId: data.id, designPath: data.design_path };
  }
  if (input.media_index !== undefined) {
    const { data } = await ctx.supabase.from('snapshots').select('id, design_path').eq('project_id', ctx.projectId).order('sort_order', { ascending: true });
    const snap = data?.[input.media_index - 1];
    if (!snap?.design_path) return { error: `<<<media_${input.media_index}>>> is not a timeline video.` };
    return { snapshotId: snap.id, designPath: snap.design_path };
  }
  const last = [...cache(ctx).entries()].pop();
  if (last) return { snapshotId: last[0], designPath: last[1].designPath };
  if (ctx.currentDesignPath) {
    const { data } = await ctx.supabase.from('snapshots').select('id').eq('project_id', ctx.projectId).eq('design_path', ctx.currentDesignPath).maybeSingle();
    if (data?.id) return { snapshotId: data.id, designPath: ctx.currentDesignPath };
  }
  return { error: 'No timeline video selected. Pass snapshot_id (from create_timeline) or media_index.' };
}

async function load(ctx: TimelineToolContext, target: { snapshotId: string; designPath: string }): Promise<Cached | { error: string }> {
  // Always re-read: the user may have edited the timeline in the GUI meanwhile.
  const loaded = await loadTimelineFile(ctx.supabase, ctx.userId!, target.designPath).catch(() => null);
  if (loaded) {
    const entry = { doc: loaded.doc, designPath: target.designPath, file: loaded.file };
    cache(ctx).set(target.snapshotId, entry);
    return entry;
  }
  const hit = cache(ctx).get(target.snapshotId);
  if (hit) return hit;
  return { error: 'That snapshot is not a timeline video (it may be a classic composition; edit those with run_code).' };
}

/** Fill ids, resolve <<<media_N>>> markers, and default track ids by kind. */
function prepareOps(ctx: TimelineToolContext, doc: TimelineDoc, rawOps: unknown[]): TimelineOp[] {
  const resolved = resolveMediaMarkersInValue(rawOps, ctx.snapshotImages) as Record<string, unknown>[];
  const defaultTrack: Record<string, string | undefined> = {
    video: doc.tracks.find(t => t.kind === 'main')?.id,
    image: doc.tracks.find(t => t.kind === 'main')?.id,
    text: doc.tracks.find(t => t.kind === 'text')?.id,
    caption: doc.tracks.find(t => t.kind === 'caption')?.id,
    audio: doc.tracks.find(t => t.kind === 'audio')?.id,
    pending: doc.tracks.find(t => t.kind === 'main')?.id,
  };
  return resolved.map((op) => {
    const o = { ...op } as Record<string, unknown>;
    if (o.op === 'insert' && o.clip && typeof o.clip === 'object') {
      const clip = { ...(o.clip as Record<string, unknown>) };
      clip.id ??= newClipId(String(clip.kind || 'c')[0]);
      clip.trackId ??= clip.track ?? defaultTrack[String(clip.kind)];
      delete clip.track;
      clip.createdBy = 'agent';
      if (clip.kind === 'caption' && Array.isArray(clip.segments)) {
        clip.segments = (clip.segments as Record<string, unknown>[]).map((s, i) => ({ id: s.id ?? `s${i + 1}`, ...s }));
      }
      o.clip = clip;
    }
    if (o.op === 'split') o.newId ??= o.new_id ?? newClipId('s');
    delete o.new_id;
    const parsed = TimelineOpSchema.safeParse(o);
    if (!parsed.success) {
      throw new TimelineError('invalid', `Invalid op ${JSON.stringify(o).slice(0, 200)}: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    return parsed.data;
  });
}

function focusOf(doc: TimelineDoc, changed: string[]): number | undefined {
  const starts = changed.map(id => doc.clips[id]?.start).filter((v): v is number => typeof v === 'number');
  return starts.length ? Math.min(...starts) : undefined;
}

const OP_GUIDE = `Ops (applied atomically, in order):
- {"op":"insert","clip":{...}} — clip fields: kind (video|image|audio|text|caption|pending), start, duration (seconds), optional id, track (defaults by kind), label, enter (none|fade|rise|pop).
  video: src (URL or <<<media_N>>>), sourceIn (seconds into source), sourceDuration, volume 0-2, muted, fit (cover|contain), box (for picture-in-picture: {x,y,w,h,radius} in composition px; put PiP on track "overlay").
  image: src, fit, box, zoom (slow Ken Burns). audio: src, sourceIn, volume, fadeIn, fadeOut.
  text: text, box {x,y,w,h}, style {fontSize, fontWeight, fontFamily, color, align, background, shadow, letterSpacing}.
  caption: segments [{start,end,text}] relative to the clip start, style {preset: pill|outline|plain|highlight, position: bottom|center|top, fontSize, color, accent}.
  pending: target (video|image|audio), progress 0-1, prompt, box — a placeholder while media generates; later update it with {"kind":"video","src":...,"target":null,"progress":null}.
- {"op":"update","id":"...","patch":{...}} — change any fields; null removes a field.
- {"op":"remove","id":"..."}
- {"op":"split","id":"...","at":seconds}
- {"op":"set_meta","width":..,"height":..,"fps":..,"background":".."}
The main track is magnetic: its clips play back-to-back in start order, so to insert between two shots give a start equal to the next shot's start; trimming a main clip moves the following shots. Other tracks are free-positioned. Track order top→bottom = layer order: overlay, text, caption, main, audio. Audio past the last visual clip is cut.`;

export function createTimelineTools(ctx: TimelineToolContext) {
  const create_timeline = tool({
    description: `Create a new timeline video and publish it to the project timeline (the user sees it immediately, with an editable timeline under the canvas). Use timeline videos for video editing and assembly work — cutting/arranging footage or stills, captions/subtitles, titles, picture-in-picture, music — instead of hand-writing a Remotion composition. Hand-written run_code compositions remain for bespoke motion graphics.
Build it in a few steps rather than one giant call: create_timeline with the core cut (main track + music), then edit_timeline once per user-perceivable step (captions, title, picture-in-picture, …) — the user watches each step land live. Returns snapshot_id; preview frames with preview_frame({snapshot_id}).
${OP_GUIDE}`,
    inputSchema: z.object({
      name: z.string().max(80).describe('Short user-facing title for the video.'),
      width: z.number().int().min(64).max(4096).optional().describe('Default 1080.'),
      height: z.number().int().min(64).max(4096).optional().describe('Default 1920 (vertical). Use 1920x1080 for landscape.'),
      fps: z.number().int().min(12).max(60).optional(),
      background: z.string().optional(),
      ops: z.array(z.record(z.string(), z.unknown())).min(1).max(200).describe('Initial ops, usually inserts for the main track and music.'),
    }),
    execute: async ({ name, width, height, fps, background, ops }) => {
      if (!ctx.supabase || !ctx.userId) return { success: false, error: 'create_timeline requires an authenticated project workspace.' };
      try {
        const empty = createTimelineDoc({ width, height, fps, background });
        const prepared = prepareOps(ctx, empty, ops);
        const { doc } = applyOps(empty, prepared);
        const snapshotId = randomUUID();
        const designPath = `code/${snapshotId}.json`;
        await writeTimelineFile(ctx.supabase, ctx.userId, designPath, doc, { description: name });
        cache(ctx).set(snapshotId, { doc, designPath });
        const design: DesignPayload & { description?: string } = { ...timelineToDesign(doc), description: name };
        const c = ctx as unknown as Record<string, unknown>;
        c.__pendingDesign = design;
        c.__pendingDesignPublished = true;
        c.__pendingDesignSnapshotId = snapshotId;
        c.__pendingDesignSourcePath = designPath;
        c.__lastDesignPayload = design;
        return { success: true, published: true, artifactType: 'timeline_video', ...describeTimeline(doc, snapshotId) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  const get_timeline = tool({
    description: 'Read a timeline video: tracks, every clip with seconds, media, text, caption segments and boxes, plus the current revision. Call before editing a timeline you did not just create, because the user may have changed it in the GUI.',
    inputSchema: z.object({
      snapshot_id: z.string().optional(),
      media_index: z.number().int().optional().describe('1-based Media Index of the timeline video; omit both to use the video the user is viewing.'),
    }),
    execute: async (input) => {
      const target = await resolveTarget(ctx, input);
      if ('error' in target) return { success: false, error: target.error };
      const loaded = await load(ctx, target);
      if ('error' in loaded) return { success: false, error: loaded.error };
      return { success: true, ...describeTimeline(loaded.doc, target.snapshotId) };
    },
  });

  const edit_timeline = tool({
    description: `Apply one editing step to a timeline video. The change is saved and appears live in the user's editor (the playhead jumps to it), so use one call per user-perceivable step with a short label, e.g. "Trim the opening", "Add captions", "Picture-in-picture bottom-right". If the user edited a clip you are changing since base_revision you get a conflict: call get_timeline and retry.
${OP_GUIDE}`,
    inputSchema: z.object({
      snapshot_id: z.string().optional(),
      media_index: z.number().int().optional(),
      label: z.string().max(80).describe('Short description of this step in the user\'s language.'),
      base_revision: z.number().int().optional().describe('Revision you last read; omit to apply on the latest.'),
      ops: z.array(z.record(z.string(), z.unknown())).min(1).max(300),
    }),
    execute: async ({ snapshot_id, media_index, label, base_revision, ops }) => {
      const target = await resolveTarget(ctx, { snapshot_id, media_index });
      if ('error' in target) return { success: false, error: target.error };
      const loaded = await load(ctx, target);
      if ('error' in loaded) return { success: false, error: loaded.error };
      try {
        const prepared = prepareOps(ctx, loaded.doc, ops);
        const baseRevision = base_revision ?? loaded.doc.revision;
        const result = applyTx(loaded.doc, { baseRevision, ops: prepared });
        await writeTimelineFile(ctx.supabase, ctx.userId!, loaded.designPath, result.doc, loaded.file);
        cache(ctx).set(target.snapshotId, { doc: result.doc, designPath: loaded.designPath, file: loaded.file });
        queueTimelineEvent(ctx, {
          type: 'timeline_tx',
          snapshotId: target.snapshotId,
          txId: randomUUID(),
          label,
          baseRevision: loaded.doc.revision,
          revision: result.doc.revision,
          ops: prepared,
          inverse: result.inverse,
          changed: result.changed,
          focusTime: focusOf(result.doc, result.changed),
        });
        const changed = describeTimeline(result.doc, target.snapshotId).clips as Record<string, unknown>[];
        return {
          success: true,
          snapshot_id: target.snapshotId,
          revision: result.doc.revision,
          duration: timelineDuration(result.doc),
          changed: changed.filter(c => result.changed.includes(String(c.id))),
        };
      } catch (error) {
        if (error instanceof TimelineError) {
          return { success: false, code: error.code, error: error.message, current_revision: loaded.doc.revision };
        }
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  return { create_timeline, get_timeline, edit_timeline };
}

export function isTimelineDesignFile(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as { code?: unknown }).code === 'string'
    && String((value as { code: string }).code).startsWith('// makaron-timeline-runtime');
}
