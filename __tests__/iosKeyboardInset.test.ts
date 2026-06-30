import { describe, expect, it } from 'vitest';
import { calculateVisualViewportKeyboardInset } from '@/lib/ios-keyboard';

describe('iOS keyboard inset calculation', () => {
  it('returns the visual viewport overlap rounded to pixels', () => {
    expect(calculateVisualViewportKeyboardInset({
      layoutHeight: 852,
      viewportHeight: 520.4,
      offsetTop: 0.2,
    })).toBe(331);
  });

  it('subtracts viewport offsetTop when Safari shifts the visual viewport', () => {
    expect(calculateVisualViewportKeyboardInset({
      layoutHeight: 852,
      viewportHeight: 620,
      offsetTop: 48,
    })).toBe(184);
  });

  it('clamps negative or full-height values to zero', () => {
    expect(calculateVisualViewportKeyboardInset({
      layoutHeight: 852,
      viewportHeight: 900,
      offsetTop: 0,
    })).toBe(0);
  });
});
