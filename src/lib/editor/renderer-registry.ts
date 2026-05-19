import type { Snapshot, ProjectAnimation, EditableField } from '@/types';

// ── Context passed to renderers for matching + prop derivation ──

export interface RendererContext {
  viewIndex: number;
  draftParentIndex: number | null;
  isAtDraftSlot: boolean;
  timelineVersion: number;
  animations: ProjectAnimation[];
  selectedVideoId: string | null;
}

// ── Canvas overrides that renderers supply to ImageCanvas ──

export interface CanvasOverrides {
  isVideoEntry?: boolean;
  videoUrl?: string | null;
  videoProcessing?: boolean;
  videoFailed?: boolean;
  videoPosterImage?: string;
  editableFields?: EditableField[];
  designProps?: Record<string, unknown>;
}

// ── Content type returned by resolution ──

export type ContentType = 'video' | 'design' | 'image';

// ── Matcher: pure logic, no React dependency ──

export interface SnapshotMatcher {
  type: ContentType;
  matchesSnapshot(snap: Snapshot, ctx: RendererContext): boolean;
  getCanvasProps(snap: Snapshot, ctx: RendererContext): CanvasOverrides;
}

// ── Registry (matchers ordered by priority — first match wins) ──

import { videoMatcher } from './renderers/video';
import { designMatcher } from './renderers/design';
import { imageMatcher } from './renderers/image';

const matchers: SnapshotMatcher[] = [
  videoMatcher,
  designMatcher,
  imageMatcher, // default, always matches
];

export function resolveContentType(snap: Snapshot | undefined, ctx: RendererContext): ContentType {
  if (!snap) return 'image';
  for (const m of matchers) {
    if (m.matchesSnapshot(snap, ctx)) return m.type;
  }
  return 'image';
}

export function getCanvasOverrides(snap: Snapshot | undefined, ctx: RendererContext): CanvasOverrides {
  if (!snap) return {};
  for (const m of matchers) {
    if (m.matchesSnapshot(snap, ctx)) return m.getCanvasProps(snap, ctx);
  }
  return {};
}
