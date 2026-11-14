import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditableHover } from '@/lib/editor/use-editable-hover';
const masks = vi.hoisted(() => ({ pick: vi.fn(), pending: vi.fn() }));
vi.mock('@/lib/editor/editable-image-alpha', () => ({ pickPaintedEditable: masks.pick, pendingEditableAlphaAtPoint: masks.pending }));
let surface: HTMLDivElement, content: HTMLDivElement, target: HTMLDivElement, frames: Map<number, FrameRequestCallback>, nextFrame: number;
let fine: boolean;
function flush() { act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); }); }
function pointer(type: string, x = 10, pointerType = 'mouse', buttons = 0) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { clientX: x, clientY: 10, pointerType, buttons });
  act(() => target.dispatchEvent(event));
}
const props = () => ({ containerEl: content, interactionEl: surface, rects: [{ id: 'person', domEl: target }], disabled: false, allowCanvasCoverSelection: true });
beforeEach(() => {
  masks.pick.mockReset().mockReturnValue('person'); masks.pending.mockReset().mockReturnValue(null);
  fine = true; frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ get matches() { return fine; }, addEventListener() {}, removeEventListener() {} }));
  surface = document.createElement('div'); content = document.createElement('div'); target = document.createElement('div');
  content.append(target); surface.append(content); document.body.append(surface);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('coalesces pointer moves and never changes selection or stored props', () => {
  const { result } = renderHook(() => useEditableHover(props()));
  for (let x = 1; x <= 30; x++) pointer('pointermove', x);
  expect(masks.pick).not.toHaveBeenCalled(); flush();
  expect(masks.pick).toHaveBeenCalledOnce();
  expect(masks.pick).toHaveBeenLastCalledWith(expect.any(Array), 30, 10, { requireDecodedAlpha: true });
  expect(result.current).toMatchObject({ id: 'person', visible: true });
  pointer('pointerleave'); expect(result.current?.visible).toBe(false);
});
it('waits for a mask and rechecks the latest pointer, without reviving a departed hover', async () => {
  let resolve!: () => void;
  masks.pick.mockReturnValue(null); masks.pending.mockReturnValue(new Promise<void>(done => { resolve = done; }));
  const { result } = renderHook(() => useEditableHover(props()));
  pointer('pointermove', 10); flush(); pointer('pointermove', 80); flush();
  expect(masks.pending).toHaveBeenCalledOnce();
  masks.pick.mockReturnValue('person'); await act(async () => resolve()); flush();
  expect(masks.pick).toHaveBeenLastCalledWith(expect.any(Array), 80, 10, expect.any(Object));
  expect(result.current?.visible).toBe(true);
  let finish!: () => void; masks.pick.mockReturnValue(null); masks.pending.mockReturnValue(new Promise<void>(done => { finish = done; }));
  pointer('pointermove'); flush(); pointer('pointerleave');
  masks.pick.mockReturnValue('person'); await act(async () => finish()); flush();
  expect(result.current?.visible).toBe(false);
});
it('ignores touch/coarse pointers and clears hints for a press or window blur', () => {
  const { result } = renderHook(() => useEditableHover(props()));
  pointer('pointermove', 10, 'touch'); flush(); expect(result.current).toBeNull();
  fine = false; pointer('pointermove'); flush(); expect(result.current).toBeNull();
  fine = true; pointer('pointermove'); flush(); expect(result.current?.visible).toBe(true);
  pointer('pointerdown'); expect(result.current?.visible).toBe(false);
  pointer('pointermove'); flush(); act(() => window.dispatchEvent(new Event('blur')));
  expect(result.current?.visible).toBe(false);
  pointer('pointermove', 10, 'mouse', 1); flush(); expect(result.current?.visible).toBe(false);
});
it('clears stale snapshots, suppresses active gestures and rechecks removed/reordered layers', () => {
  const { result, rerender } = renderHook(useEditableHover, { initialProps: props() });
  pointer('pointermove'); flush(); expect(result.current?.visible).toBe(true);
  surface.dataset.editableGesture = 'scale'; pointer('pointermove'); flush(); expect(result.current?.visible).toBe(false);
  delete surface.dataset.editableGesture; pointer('pointermove'); flush(); expect(result.current?.visible).toBe(true);
  masks.pick.mockReturnValue(null); rerender({ ...props(), rects: [] }); flush(); expect(result.current?.visible).toBe(false);
  masks.pick.mockReturnValue('person'); pointer('pointermove'); flush();
  const next = document.createElement('div'); surface.append(next);
  rerender({ ...props(), containerEl: next }); expect(result.current).toBeNull(); flush(); expect(result.current).toBeNull();
});
it('does not advertise canvas-cover elements that cannot be selected by tapping', () => {
  target.setAttribute('data-editable-canvas-cover', '');
  const { result } = renderHook(() => useEditableHover({ ...props(), allowCanvasCoverSelection: false }));
  pointer('pointermove'); flush(); expect(result.current).toBeNull();
});
