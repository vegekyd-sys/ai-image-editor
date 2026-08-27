import { describe, expect, it } from 'vitest';
import {
  findEditableAtPoint,
  isEditableRectMeasurable,
  isEditableCanvasCover,
  resolveEditableEditActivation,
  resolveEditablePointerIntent,
} from '@/lib/editor/editable-hit-test';

describe('editable hit-test fallback', () => {
  it('rejects collapsed Remotion duplicates as Moveable targets', () => {
    expect(isEditableRectMeasurable({ width: 0.52, height: 248 })).toBe(false);
    expect(isEditableRectMeasurable({ width: 485, height: 66 })).toBe(true);
  });

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

describe('editable edit activation', () => {
  it('opens text editing after two completed stationary taps on the selected field', () => {
    const first = resolveEditableEditActivation({
      fieldId: 'title',
      fieldType: 'text',
      selectedFieldId: null,
      moved: false,
      now: 1_000,
      previousTap: null,
    });
    const second = resolveEditableEditActivation({
      fieldId: 'title',
      fieldType: 'text',
      selectedFieldId: 'title',
      moved: false,
      now: 1_280,
      previousTap: first.nextTap,
    });

    expect(first.shouldEdit).toBe(false);
    expect(second.shouldEdit).toBe(true);
    expect(second.nextTap).toBeNull();
  });

  it('never opens editing when the second gesture becomes a drag', () => {
    const result = resolveEditableEditActivation({
      fieldId: 'title',
      fieldType: 'text',
      selectedFieldId: 'title',
      moved: true,
      now: 1_200,
      previousTap: { fieldId: 'title', completedAt: 1_000 },
    });

    expect(result).toEqual({ shouldEdit: false, nextTap: null });
  });

  it('does not open non-text fields, stale taps, or a different field', () => {
    const previousTap = { fieldId: 'title', completedAt: 1_000 };

    expect(resolveEditableEditActivation({
      fieldId: 'image',
      fieldType: 'image',
      selectedFieldId: 'image',
      moved: false,
      now: 1_200,
      previousTap,
    }).shouldEdit).toBe(false);
    expect(resolveEditableEditActivation({
      fieldId: 'title',
      fieldType: 'text',
      selectedFieldId: 'title',
      moved: false,
      now: 1_500,
      previousTap,
    }).shouldEdit).toBe(false);
    expect(resolveEditableEditActivation({
      fieldId: 'subtitle',
      fieldType: 'text',
      selectedFieldId: 'subtitle',
      moved: false,
      now: 1_200,
      previousTap,
    }).shouldEdit).toBe(false);
  });
});
