import { describe, expect, it } from 'vitest';
import {
  findEditableAtPoint,
  isEditableCanvasCover,
  resolveEditablePointerIntent,
} from '@/lib/editor/editable-hit-test';

describe('editable hit-test fallback', () => {
  it('returns the editable containing a point', () => {
    expect(findEditableAtPoint([
      { id: 'video1', left: 100, top: 50, width: 300, height: 180 },
    ], 200, 100)).toBe('video1');
  });

  it('returns null when no editable contains the point', () => {
    expect(findEditableAtPoint([
      { id: 'video1', left: 100, top: 50, width: 300, height: 180 },
    ], 20, 20)).toBeNull();
  });

  it('prefers the smaller editable when multiple rects overlap', () => {
    expect(findEditableAtPoint([
      { id: 'video1', left: 100, top: 50, width: 300, height: 180 },
      { id: 'label1', left: 120, top: 70, width: 80, height: 24 },
    ], 150, 80)).toBe('label1');
  });

  it('uses later rects as a tie-breaker for same-size overlaps', () => {
    expect(findEditableAtPoint([
      { id: 'back', left: 0, top: 0, width: 100, height: 100 },
      { id: 'front', left: 0, top: 0, width: 100, height: 100 },
    ], 50, 50)).toBe('front');
  });

  it('classifies a shifted layer as canvas-covering from its visible intersection', () => {
    expect(isEditableCanvasCover(
      { left: -8, top: 0, width: 100, height: 100 },
      { left: 0, top: 0, width: 100, height: 100 },
    )).toBe(true);
    expect(isEditableCanvasCover(
      { left: 10, top: 10, width: 40, height: 40 },
      { left: 0, top: 0, width: 100, height: 100 },
    )).toBe(false);
  });

  it('lets local editables win while canvas-cover layers behave like playback background', () => {
    expect(resolveEditablePointerIntent({
      hitFieldId: 'title',
      hitIsCanvasCover: false,
      selectedFieldId: null,
      moved: false,
    })).toBe('select');
    expect(resolveEditablePointerIntent({
      hitFieldId: 'background',
      hitIsCanvasCover: true,
      selectedFieldId: null,
      moved: false,
    })).toBe('canvas-tap');
  });

  it('keeps a pill-selected canvas-cover editable in manipulation mode', () => {
    expect(resolveEditablePointerIntent({
      hitFieldId: 'background',
      hitIsCanvasCover: true,
      selectedFieldId: 'background',
      moved: false,
    })).toBe('manipulate');
  });

  it('never turns a drag into a canvas playback tap', () => {
    expect(resolveEditablePointerIntent({
      hitFieldId: null,
      hitIsCanvasCover: false,
      selectedFieldId: null,
      moved: true,
    })).toBe('ignore');
  });
});
