import { afterEach, expect, it, vi } from 'vitest';
import { createEditableTouchHold, EDITABLE_HOLD_MS, editableLabelPosition } from '@/lib/editor/editable-touch-hold';
afterEach(() => vi.useRealTimers());
it('lets a navigation swipe cancel drag before it can claim the layer', () => {
  vi.useFakeTimers(); const activate = vi.fn(), hold = createEditableTouchHold(activate);
  hold.start(1, 200, 300); vi.advanceTimersByTime(80); hold.move(1, 150, 302); vi.advanceTimersByTime(1000);
  expect(activate).not.toHaveBeenCalled();
});
it('claims a held pointer, while tap/end, a second finger and cleanup cancel pending holds', () => {
  vi.useFakeTimers(); const activate = vi.fn(), hold = createEditableTouchHold(activate);
  hold.start(1, 200, 300); hold.move(1, 203, 303); vi.advanceTimersByTime(EDITABLE_HOLD_MS);
  expect(activate).toHaveBeenCalledWith(1);
  hold.start(2, 200, 300); hold.cancel(); vi.advanceTimersByTime(1000); expect(activate).toHaveBeenCalledTimes(1);
});
it('keeps labels inside the top, left and right of the visible canvas', () => {
  expect(editableLabelPosition({left:-20,top:0},390,700)).toEqual({left:4,top:4,maxWidth:382});
  const p = editableLabelPosition({left:380,top:10},390,700);
  expect(p.top).toBeGreaterThanOrEqual(0); expect(p.left+p.maxWidth).toBeLessThanOrEqual(386);
});
