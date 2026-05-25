import { describe, expect, it } from 'vitest';
import { findEditableAtPoint } from '@/lib/editor/editable-hit-test';

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
});
