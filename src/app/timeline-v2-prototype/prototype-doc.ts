// Prototype-only timeline document + reducer for the V2 design review.
// The production protocol (MTP v1) lives in docs/video-timeline-v2-plan.md §3;
// this is a deliberately small subset (seconds-based) to drive the real UI shell.

export type TrackKind = 'main' | 'overlay' | 'text' | 'caption' | 'audio';
export type ClipKind = 'video' | 'image' | 'text' | 'caption' | 'audio' | 'pending';

export interface Box { x: number; y: number; w: number; h: number; radius?: number }

export interface CaptionSegment { id: string; start: number; end: number; text: string }

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  label: string;
  start: number;
  duration: number;
  sourceIn?: number;
  src?: string;
  poster?: string;
  text?: string;
  segments?: CaptionSegment[];
  box?: Box;
  progress?: number;
  createdBy?: 'user' | 'agent';
}

export interface Track { id: string; kind: TrackKind }

export interface TimelineDoc {
  revision: number;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
  clips: Record<string, Clip>;
}

export type TimelineOp =
  | { op: 'insert'; clip: Clip }
  | { op: 'update'; id: string; patch: Partial<Clip> }
  | { op: 'remove'; id: string };

export const TRACK_ORDER: Track[] = [
  { id: 't-overlay', kind: 'overlay' },
  { id: 't-text', kind: 'text' },
  { id: 't-caption', kind: 'caption' },
  { id: 't-main', kind: 'main' },
  { id: 't-audio', kind: 'audio' },
];

export const PIP_BOX: Box = { x: 640, y: 1180, w: 360, h: 640, radius: 36 };

export function initialDoc(): TimelineDoc {
  const clips: Clip[] = [
    { id: 'v1', trackId: 't-main', kind: 'video', label: '水母', start: 0, duration: 3.2, sourceIn: 0, src: '/home-hero/jellyfish-v2.mp4', poster: '/home-hero/jellyfish-v2.webp' },
    { id: 'v2', trackId: 't-main', kind: 'video', label: '机器人', start: 0, duration: 2.6, sourceIn: 0.5, src: '/home-hero/android-v2.mp4', poster: '/home-hero/android-v2.webp' },
    { id: 'v3', trackId: 't-main', kind: 'video', label: '时装', start: 0, duration: 2.8, sourceIn: 0, src: '/home-hero/fashion-v2.mp4', poster: '/home-hero/fashion-v2.webp' },
    { id: 'title', trackId: 't-text', kind: 'text', label: '标题', start: 0.2, duration: 2.6, text: '东京夜色', box: { x: 90, y: 300, w: 900, h: 260 } },
    { id: 'music', trackId: 't-audio', kind: 'audio', label: 'night.mp3', start: 0, duration: 8.6, src: '/home-studio/night.mp3' },
  ];
  return layout({
    revision: 12,
    fps: 30,
    width: 1080,
    height: 1920,
    tracks: TRACK_ORDER,
    clips: Object.fromEntries(clips.map(c => [c.id, c])),
  });
}

/** Main track is magnetic: clips are packed back-to-back in their current order. */
export function layout(doc: TimelineDoc): TimelineDoc {
  const main = Object.values(doc.clips).filter(c => c.trackId === 't-main').sort((a, b) => a.start - b.start);
  let t = 0;
  const clips = { ...doc.clips };
  for (const c of main) {
    clips[c.id] = { ...c, start: t };
    t += c.duration;
  }
  return { ...doc, clips };
}

export function docDuration(doc: TimelineDoc): number {
  return Math.max(1, ...Object.values(doc.clips).filter(c => c.kind !== 'audio').map(c => c.start + c.duration));
}

export function applyOp(doc: TimelineDoc, op: TimelineOp): TimelineDoc {
  const clips = { ...doc.clips };
  if (op.op === 'insert') clips[op.clip.id] = op.clip;
  if (op.op === 'update' && clips[op.id]) clips[op.id] = { ...clips[op.id], ...op.patch };
  if (op.op === 'remove') delete clips[op.id];
  return layout({ ...doc, clips, revision: doc.revision + 1 });
}

export function clipsOnTrack(doc: TimelineDoc, trackId: string): Clip[] {
  return Object.values(doc.clips).filter(c => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export interface AgentStep {
  status: string;
  /** Row shown in the CUI (same layout as Studio Run timed rows). */
  row?: { time: string; text: string; clipId: string };
  ops?: TimelineOp[];
  focus?: { clipId: string; time: number };
  delay: number;
  /** Animate pending progress for this clip during the delay. */
  pendingFor?: string;
}

const seg = (id: string, start: number, end: number, text: string): CaptionSegment => ({ id, start, end, text });

export const AGENT_REQUEST = '开头剪短一点，加上字幕，右下角放一个画中画';

export const AGENT_SCRIPT: AgentStep[] = [
  { status: '读取时间线 · 3 段视频 · 1 个标题 · 1 条音乐', delay: 1100 },
  {
    status: '剪短开头：水母片段 3.2s → 2.2s，后面自动前移',
    row: { time: '0:00', text: '开头缩短 1 秒，后续片段前移', clipId: 'v1' },
    ops: [{ op: 'update', id: 'v1', patch: { duration: 2.2 } }],
    focus: { clipId: 'v1', time: 1.6 },
    delay: 1500,
  },
  {
    status: '加字幕：第 1 句',
    row: { time: '0:00', text: '字幕「夜色从海底开始」', clipId: 'cap' },
    ops: [{ op: 'insert', clip: { id: 'cap', trackId: 't-caption', kind: 'caption', label: '字幕', start: 0, duration: 2.2, createdBy: 'agent', segments: [seg('s1', 0, 2.2, '夜色从海底开始')] } }],
    focus: { clipId: 'cap', time: 1 },
    delay: 1300,
  },
  {
    status: '加字幕：第 2 句',
    row: { time: '0:02', text: '字幕「霓虹醒来」', clipId: 'cap' },
    ops: [{ op: 'update', id: 'cap', patch: { duration: 4.8, segments: [seg('s1', 0, 2.2, '夜色从海底开始'), seg('s2', 2.2, 4.8, '霓虹醒来')] } }],
    focus: { clipId: 'cap', time: 3.2 },
    delay: 1300,
  },
  {
    status: '加字幕：第 3 句',
    row: { time: '0:04', text: '字幕「这座城不睡」', clipId: 'cap' },
    ops: [{ op: 'update', id: 'cap', patch: { duration: 7.6, segments: [seg('s1', 0, 2.2, '夜色从海底开始'), seg('s2', 2.2, 4.8, '霓虹醒来'), seg('s3', 4.8, 7.6, '这座城不睡')] } }],
    focus: { clipId: 'cap', time: 5.6 },
    delay: 1300,
  },
  {
    status: '生成画中画素材 · 预计 3 秒',
    row: { time: '0:02', text: '画中画 · 生成中', clipId: 'pip' },
    ops: [{ op: 'insert', clip: { id: 'pip', trackId: 't-overlay', kind: 'pending', label: '画中画', start: 2.4, duration: 3.6, progress: 0, createdBy: 'agent', box: PIP_BOX } }],
    focus: { clipId: 'pip', time: 3 },
    pendingFor: 'pip',
    delay: 3200,
  },
  {
    status: '画中画已放入右下角',
    row: { time: '0:02', text: '画中画「云中小屋」放入右下角', clipId: 'pip' },
    ops: [{ op: 'update', id: 'pip', patch: { kind: 'video', label: '云中小屋', src: '/home-hero/cloud-house-v2.mp4', poster: '/home-hero/cloud-house-v2.webp', sourceIn: 0, progress: undefined } }],
    focus: { clipId: 'pip', time: 3.4 },
    delay: 1400,
  },
];
