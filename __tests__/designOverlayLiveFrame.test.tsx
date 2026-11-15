import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ target: null as HTMLElement | null, moveable: null as any, updateRect: vi.fn() }));
vi.mock('react-moveable', () => ({ default: React.forwardRef(function MockMoveable(props: any, ref: any) {
  runtime.moveable = props; React.useImperativeHandle(ref, () => ({ updateRect: runtime.updateRect, stopDrag() {} })); return null;
}) }));
vi.mock('@/lib/editor/scene-registry', async original => ({ ...await original<any>(), buildLegacySceneRegistry: () => ({ activeInstances: () => runtime.target ? [{ id: 'shape', element: runtime.target }] : [] }) }));
vi.mock('@/lib/editor/editable-image-alpha', () => ({ editableMediaImage: () => null, warmEditableAlpha() {}, pickPaintedEditable: () => 'shape', isPaintedEditableHit: () => true, pendingEditableAlphaAtPoint: () => null }));
vi.mock('@/lib/editor/use-editable-hover', () => ({ useEditableHover: () => null }));
vi.mock('@/components/EditableSelectionTint', () => ({ default: () => null }));
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
import DesignOverlay from '@/components/DesignOverlay';
let container: HTMLDivElement, target: HTMLDivElement, frames: Map<number, FrameRequestCallback>, next: number;
const flush = () => act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); });
function pointer(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 });
  act(() => (type === 'pointerdown' ? target : window).dispatchEvent(e));
}
beforeEach(() => {
  frames = new Map(); next = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); target = document.createElement('div'); target.dataset.editable = 'shape';
  Object.assign(target.style, { width: '100px', height: '80px', translate: '0px 0px', scale: '1' }); container.append(target); document.body.append(container); runtime.target = target;
  target.getBoundingClientRect = () => {
    const [x = 0, y = 0] = target.style.translate.split(' ').map(v => parseFloat(v) || 0), scale = parseFloat(target.style.scale) || 1;
    const left = 100 + x - 50 * (scale - 1), top = 150 + y - 40 * (scale - 1), width = 100 * scale, height = 80 * scale;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} };
  };
});
afterEach(() => { document.body.replaceChildren(); runtime.target = null; vi.unstubAllGlobals(); });
async function setup(onBeforeEdit?: () => boolean, type: 'text' | 'image' | 'video' = 'image') {
  const save = vi.fn();
  render(<DesignOverlay touchGestures containerEl={container} interactionEl={container} editables={[{ id: 'shape', propKey: 'shape', type, label: 'Shape' }]} props={{}} selectedFieldId="shape" onSelectField={() => {}} onUpdateProp={save} onBeforeEdit={onBeforeEdit} allowCanvasCoverSelection />);
  await waitFor(() => expect(runtime.moveable?.target).toBe(target)); flush();
  const frame = () => {
    const { left, top, width, height } = runtime.moveable.target.getBoundingClientRect();
    return { left, top, width, height };
  };
  return { save, frame };
}
it('moves the native frame target and corners during touch drag before pointer release, saving only once', async () => {
  const { save, frame } = await setup(); pointer('pointerdown', 120, 170); pointer('pointermove', 150, 190); flush();
  expect(frame()).toEqual({ left: 130, top: 170, width: 100, height: 80 }); expect(save).not.toHaveBeenCalled();
  pointer('pointermove', 175, 205); flush(); expect(frame().left).toBe(155); expect(frame().top).toBe(185);
  pointer('pointerup', 175, 205); expect(save).toHaveBeenCalledExactlyOnceWith('_pos_shape', { x: 55, y: 35 });
});
it('moves the native frame target during desktop drag before Moveable ends the gesture', async () => {
  const { save, frame } = await setup();
  act(() => runtime.moveable.onDragStart({ inputEvent: { target, clientX: 120, clientY: 170, type: 'mousedown' }, set() {}, stopDrag() {} }));
  act(() => runtime.moveable.onDrag({ target, beforeTranslate: [40, 25] }));
  expect(frame()).toEqual({ left: 140, top: 175, width: 100, height: 80 }); expect(save).not.toHaveBeenCalled();
  act(() => runtime.moveable.onDragEnd()); expect(save).toHaveBeenCalledExactlyOnceWith('_pos_shape', { x: 40, y: 25 });
});
it('resizes the native frame target during a two-finger pinch before either finger lifts', async () => {
  const { save, frame } = await setup();
  const touch = (type: string, points: Array<{ clientX: number; clientY: number }>) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { touches: points }); act(() => target.dispatchEvent(e)); };
  touch('touchstart', [{ clientX: 120, clientY: 170 }, { clientX: 160, clientY: 170 }]);
  touch('touchmove', [{ clientX: 110, clientY: 170 }, { clientX: 170, clientY: 170 }]);
  expect(frame()).toEqual({ left: 75, top: 130, width: 150, height: 120 }); expect(save).not.toHaveBeenCalled();
  touch('touchend', []); expect(save).toHaveBeenCalledExactlyOnceWith('_scale_shape', { w: 1.5, h: 1.5 });
});

it('remeasures the native frame after undo changes CSS transforms on the same node', async () => {
  await setup();
  runtime.updateRect.mockClear();
  target.style.scale = '1.5 1.5';
  act(() => window.dispatchEvent(new Event('resize')));
  expect(runtime.updateRect).toHaveBeenCalled();
  runtime.updateRect.mockClear();
  target.style.scale = '1 1';
  act(() => window.dispatchEvent(new Event('resize')));
  expect(runtime.updateRect).toHaveBeenCalled();
});

it.each(['image', 'text', 'video'] as const)('blocks %s gestures before DOM or persistent changes when access is denied', async type => {
  const authorize = vi.fn(() => false), stopDrag = vi.fn();
  const { save, frame } = await setup(authorize, type); const original = frame();
  act(() => runtime.moveable.onDragStart({ inputEvent: { target, clientX: 120, clientY: 170, type: 'mousedown' }, set() {}, stopDrag }));
  act(() => runtime.moveable.onDrag({ target, beforeTranslate: [40, 25] })); act(() => runtime.moveable.onDragEnd());
  act(() => runtime.moveable.onScaleStart({ direction: [1, 1], set() {}, stopDrag }));
  act(() => runtime.moveable.onScale({ target, scale: [2, 2] })); act(() => runtime.moveable.onScaleEnd());
  pointer('pointerdown', 120, 170); pointer('pointermove', 150, 190); flush(); pointer('pointerup', 150, 190);
  const touch = (name: string, touches: unknown[]) => { const e = new Event(name, { bubbles: true }); Object.assign(e, { touches }); act(() => target.dispatchEvent(e)); };
  touch('touchstart', [{ clientX: 120, clientY: 170 }, { clientX: 160, clientY: 170 }]);
  touch('touchmove', [{ clientX: 90, clientY: 170 }, { clientX: 190, clientY: 170 }]); touch('touchend', []);
  expect(authorize).toHaveBeenCalledTimes(4); expect(stopDrag).toHaveBeenCalledTimes(2);
  expect(frame()).toEqual(original); expect(save).not.toHaveBeenCalled();
});
