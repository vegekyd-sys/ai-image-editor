// Makaron Timeline Protocol (MTP) v1 — the single source of truth for a
// timeline video. Stored in DesignPayload.props.timeline and rendered by the
// constant runtime in ./runtime-code.ts through the existing design pipeline
// (Player preview, browser export, Lambda dynamic-design).
// Times are seconds (rounded to milliseconds); boxes are composition pixels.
import { z } from 'zod';

export const TIMELINE_VERSION = 1 as const;

export const TRACK_KINDS = ['overlay', 'text', 'caption', 'main', 'audio'] as const;
export type TrackKind = typeof TRACK_KINDS[number];

/** Top → bottom in the dock; also paint order (earlier = drawn on top). */
export const DEFAULT_TRACKS: { id: string; kind: TrackKind }[] = [
  { id: 'overlay', kind: 'overlay' },
  { id: 'text', kind: 'text' },
  { id: 'caption', kind: 'caption' },
  { id: 'main', kind: 'main' },
  { id: 'audio', kind: 'audio' },
];

const seconds = z.number().finite().min(0).max(3600);
const positive = z.number().finite().min(0.04).max(3600);

export const BoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(8),
  h: z.number().finite().min(8),
  radius: z.number().finite().min(0).optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().finite().optional(),
});
export type Box = z.infer<typeof BoxSchema>;

export const ENTER_EFFECTS = ['none', 'fade', 'rise', 'pop'] as const;
export type EnterEffect = typeof ENTER_EFFECTS[number];

export const TextStyleSchema = z.object({
  fontSize: z.number().min(8).max(600).optional(),
  fontWeight: z.number().min(100).max(900).optional(),
  fontFamily: z.string().max(80).optional(),
  color: z.string().max(40).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  background: z.string().max(40).optional(),
  shadow: z.boolean().optional(),
  letterSpacing: z.number().min(-20).max(80).optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const CAPTION_PRESETS = ['pill', 'outline', 'plain', 'highlight'] as const;
export const CaptionStyleSchema = z.object({
  preset: z.enum(CAPTION_PRESETS).optional(),
  position: z.enum(['bottom', 'center', 'top']).optional(),
  fontSize: z.number().min(12).max(200).optional(),
  color: z.string().max(40).optional(),
  accent: z.string().max(40).optional(),
  fontFamily: z.string().max(80).optional(),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const CaptionSegmentSchema = z.object({
  id: z.string().min(1).max(64),
  /** Relative to the caption clip start. */
  start: seconds,
  end: seconds,
  text: z.string().max(400),
});
export type CaptionSegment = z.infer<typeof CaptionSegmentSchema>;

const clipBase = {
  id: z.string().min(1).max(64),
  trackId: z.string().min(1).max(64),
  start: seconds,
  duration: positive,
  label: z.string().max(80).optional(),
  createdBy: z.enum(['user', 'agent']).optional(),
  /** Revision that last changed this clip (set by the reducer; used for rebase). */
  rev: z.number().int().min(0).optional(),
  enter: z.enum(ENTER_EFFECTS).optional(),
};

export const VideoClipSchema = z.object({
  ...clipBase,
  kind: z.literal('video'),
  src: z.string().min(1).max(2000),
  poster: z.string().max(2000).optional(),
  /** Seconds into the source where the clip starts. */
  sourceIn: seconds.optional(),
  sourceDuration: positive.optional(),
  volume: z.number().min(0).max(2).optional(),
  muted: z.boolean().optional(),
  fit: z.enum(['cover', 'contain']).optional(),
  box: BoxSchema.optional(),
});

export const ImageClipSchema = z.object({
  ...clipBase,
  kind: z.literal('image'),
  src: z.string().min(1).max(2000),
  fit: z.enum(['cover', 'contain']).optional(),
  box: BoxSchema.optional(),
  /** Slow Ken Burns zoom for stills on the main track. */
  zoom: z.boolean().optional(),
});

export const AudioClipSchema = z.object({
  ...clipBase,
  kind: z.literal('audio'),
  src: z.string().min(1).max(2000),
  sourceIn: seconds.optional(),
  volume: z.number().min(0).max(2).optional(),
  fadeIn: z.number().min(0).max(30).optional(),
  fadeOut: z.number().min(0).max(30).optional(),
});

export const TextClipSchema = z.object({
  ...clipBase,
  kind: z.literal('text'),
  text: z.string().max(400),
  box: BoxSchema,
  style: TextStyleSchema.optional(),
});

export const CaptionClipSchema = z.object({
  ...clipBase,
  kind: z.literal('caption'),
  segments: z.array(CaptionSegmentSchema).max(500),
  style: CaptionStyleSchema.optional(),
});

export const PendingClipSchema = z.object({
  ...clipBase,
  kind: z.literal('pending'),
  /** What the pending clip will become once the job resolves. */
  target: z.enum(['video', 'image', 'audio']),
  jobId: z.string().max(200).optional(),
  progress: z.number().min(0).max(1).optional(),
  prompt: z.string().max(400).optional(),
  box: BoxSchema.optional(),
});

export const ClipSchema = z.discriminatedUnion('kind', [
  VideoClipSchema,
  ImageClipSchema,
  AudioClipSchema,
  TextClipSchema,
  CaptionClipSchema,
  PendingClipSchema,
]);
export type Clip = z.infer<typeof ClipSchema>;
export type ClipKind = Clip['kind'];
export type VideoClip = z.infer<typeof VideoClipSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
export type CaptionClip = z.infer<typeof CaptionClipSchema>;
export type PendingClip = z.infer<typeof PendingClipSchema>;

export const TrackSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(TRACK_KINDS),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
});
export type Track = z.infer<typeof TrackSchema>;

export const TimelineDocSchema = z.object({
  version: z.literal(TIMELINE_VERSION),
  revision: z.number().int().min(0),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  fps: z.number().int().min(12).max(60),
  background: z.string().max(40).optional(),
  tracks: z.array(TrackSchema).min(1).max(16),
  clips: z.record(z.string(), ClipSchema),
});
export type TimelineDoc = z.infer<typeof TimelineDocSchema>;

// ── operations ──
const ClipPatchSchema = z.record(z.string(), z.unknown());

export const TimelineOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), clip: ClipSchema }),
  z.object({ op: z.literal('update'), id: z.string(), patch: ClipPatchSchema }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({ op: z.literal('split'), id: z.string(), at: seconds, newId: z.string().min(1).max(64) }),
  z.object({
    op: z.literal('set_meta'),
    width: z.number().int().min(64).max(4096).optional(),
    height: z.number().int().min(64).max(4096).optional(),
    fps: z.number().int().min(12).max(60).optional(),
    background: z.string().max(40).optional(),
  }),
]);
export type TimelineOp = z.infer<typeof TimelineOpSchema>;

export interface TimelineTx {
  txId: string;
  baseRevision: number;
  label?: string;
  author: 'user' | 'agent';
  ops: TimelineOp[];
}

/** Which clip kinds each track kind accepts. */
export const TRACK_ACCEPTS: Record<TrackKind, ClipKind[]> = {
  main: ['video', 'image', 'pending'],
  overlay: ['video', 'image', 'pending'],
  text: ['text'],
  caption: ['caption'],
  audio: ['audio', 'pending'],
};
