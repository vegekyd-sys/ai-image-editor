import { describe, expect, it } from 'vitest';
import {
  VIDEO_TIMELINE_SENTINEL,
  buildDesignsMap,
  buildImageTimeline,
  getInitialEditorViewMode,
  getNearbyOptimizedPreloadUrls,
  getPreviousImageForCompare,
  getSnapshotTimelineImage,
  shouldShowCanvasPlaceholder,
} from '@/lib/editor/timeline-derivations';
import type { DesignPayload, Snapshot } from '@/types';

const storageUrl = (name: string) =>
  `https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/project/${name}.png`;

const snap = (id: string, image: string, extra: Partial<Snapshot> = {}): Snapshot => ({
  id,
  image,
  tips: [],
  messageId: `${id}-msg`,
  ...extra,
});

const design = (code: string): DesignPayload => ({ code, width: 1080, height: 1350 });

describe('editor timeline derivations', () => {
  it('opens an empty mobile editor in CUI without changing populated or desktop entry', () => {
    expect(getInitialEditorViewMode({ isDesktop: false, hasGuiContent: false })).toBe('cui');
    expect(getInitialEditorViewMode({ isDesktop: false, hasGuiContent: true })).toBe('gui');
    expect(getInitialEditorViewMode({ isDesktop: true, hasGuiContent: false })).toBe('gui');
  });

  it('prefers cached/base64 image for timeline entries', () => {
    expect(getSnapshotTimelineImage(snap('a', 'data:image/png;base64,abc'), 0, 5))
      .toBe('data:image/png;base64,abc');
  });

  it('uses optimized URLs for the current snapshot and neighbors, thumbnails for distant snapshots', () => {
    const current = getSnapshotTimelineImage(snap('current', storageUrl('current')), 2, 1);
    const distant = getSnapshotTimelineImage(snap('distant', storageUrl('distant')), 5, 1);

    expect(current).toContain('/storage/v1/render/image/public/');
    expect(current).toContain('width=2000');
    expect(distant).toContain('/storage/v1/render/image/public/');
    expect(distant).toContain('width=800');
    expect(distant).toContain('quality=75');
  });

  it('builds timeline with virtual draft after parent and optional video sentinel', () => {
    const timeline = buildImageTimeline({
      snapshots: [snap('a', 'base-a'), snap('b', 'base-b'), snap('c', 'base-c')],
      draftImage: 'draft-image',
      draftParentIndex: 1,
      hasAnyAnimation: true,
      viewIndex: 0,
    });

    expect(timeline).toEqual(['base-a', 'base-b', 'draft-image', 'base-c', VIDEO_TIMELINE_SENTINEL]);
  });

  it('keeps design timeline indices aligned when a draft shifts later snapshots', () => {
    const firstDesign = design('first');
    const secondDesign = design('second');
    const map = buildDesignsMap([
      snap('a', 'base-a', { design: firstDesign }),
      snap('b', 'base-b'),
      snap('c', 'base-c', { design: secondDesign }),
    ], 1);

    expect(map.get(0)).toBe(firstDesign);
    expect(map.get(3)).toBe(secondDesign);
    expect(map.has(2)).toBe(false);
  });

  it('does not show the converting placeholder for a renderable design without a poster', () => {
    expect(shouldShowCanvasPlaceholder({
      timeline: [''],
      viewIndex: 0,
      isViewingVideoV2: false,
      hasRenderableDesign: true,
    })).toBe(false);

    expect(shouldShowCanvasPlaceholder({
      timeline: [''],
      viewIndex: 0,
      isViewingVideoV2: false,
      hasRenderableDesign: false,
    })).toBe(true);
  });

  it('returns nearby optimized preload URLs while skipping cached/base64 snapshots', () => {
    const urls = getNearbyOptimizedPreloadUrls([
      snap('a', storageUrl('a')),
      snap('b', 'data:image/png;base64,b'),
      snap('c', storageUrl('c')),
      snap('d', storageUrl('d')),
      snap('e', storageUrl('e')),
    ], 2);

    expect(urls).toHaveLength(3);
    expect(urls.every(url => url.includes('width=2000'))).toBe(true);
    expect(urls.join('\n')).toContain('/a.png');
    expect(urls.join('\n')).toContain('/d.png');
    expect(urls.join('\n')).toContain('/e.png');
    expect(urls.join('\n')).not.toContain('base64');
  });

  it('uses draft parent as previous image while viewing a draft', () => {
    const previous = getPreviousImageForCompare({
      snapshots: [snap('a', storageUrl('a')), snap('b', storageUrl('b'))],
      viewIndex: 1,
      draftParentIndex: 0,
      isViewingDraft: true,
    });

    expect(previous).toContain('/a.png');
    expect(previous).toContain('width=2000');
  });

  it('maps timeline index back to snapshot index for previous-image compare', () => {
    const previous = getPreviousImageForCompare({
      snapshots: [snap('a', 'base-a'), snap('b', storageUrl('b')), snap('c', storageUrl('c'))],
      viewIndex: 3,
      draftParentIndex: 0,
      isViewingDraft: false,
    });

    expect(previous).toContain('/b.png');
    expect(previous).toContain('width=2000');
  });
});
