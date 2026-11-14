'use client';

import { useEffect, useRef, useState } from 'react';
import { pendingEditableAlphaAtPoint, pickPaintedEditable } from './editable-image-alpha';

type HoverRect = { id: string; domEl: HTMLElement };
type Hover = { id: string; element: HTMLElement; owner: HTMLElement; visible: boolean };

/** One alpha-aware pick per frame, with React updates only when the target changes. */
export function useEditableHover({ containerEl, interactionEl, rects, disabled, allowCanvasCoverSelection }: {
  containerEl: HTMLElement | null; interactionEl: HTMLElement | null; rects: HoverRect[];
  disabled: boolean; allowCanvasCoverSelection: boolean;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const latest = useRef({ rects, disabled, allowCanvasCoverSelection });
  latest.current = { rects, disabled, allowCanvasCoverSelection };
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerEl || !interactionEl) return;
    const capability = matchMedia('(any-hover: hover) and (any-pointer: fine)');
    let disposed = false, raf = 0, waiting = false;
    let point: { x: number; y: number } | null = null;
    const hide = () => setHover(previous => previous?.visible ? { ...previous, visible: false } : previous);
    const clear = () => { point = null; cancelAnimationFrame(raf); raf = 0; hide(); };
    const schedule = () => { if (!disposed && point && !raf) raf = requestAnimationFrame(pick); };
    const pick = () => {
      raf = 0;
      const state = latest.current;
      if (!point || !capability.matches || state.disabled || interactionEl.dataset.editableGesture || document.hidden) { hide(); return; }
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || !interactionEl.contains(hit) || hit.closest('button, input, textarea, [contenteditable="true"], .moveable-control')) { hide(); return; }
      const candidates = state.rects.filter(rect => rect.domEl.isConnected && containerEl.contains(rect.domEl));
      const id = pickPaintedEditable(candidates, point.x, point.y, { requireDecodedAlpha: true });
      const target = candidates.find(rect => rect.id === id);
      if (target && (state.allowCanvasCoverSelection || !target.domEl.hasAttribute('data-editable-canvas-cover'))) {
        setHover(previous => previous?.element === target.domEl && previous.visible && previous.owner === containerEl
          ? previous : { id: target.id, element: target.domEl, owner: containerEl, visible: true });
      } else hide();
      // Decode can finish after the mouse stops. Re-pick the latest location,
      // never the location that started an earlier asynchronous request.
      if (!target && !waiting) {
        const pending = pendingEditableAlphaAtPoint(candidates, point.x, point.y);
        if (pending) { waiting = true; void pending.then(() => { waiting = false; schedule(); }); }
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || !capability.matches) { clear(); return; }
      point = { x: event.clientX, y: event.clientY }; schedule();
    };
    const visibility = () => { if (document.hidden) clear(); };
    refreshRef.current = schedule;
    interactionEl.addEventListener('pointermove', move, { capture: true, passive: true });
    interactionEl.addEventListener('pointerleave', clear);
    interactionEl.addEventListener('pointerdown', clear, true);
    interactionEl.addEventListener('pointercancel', clear, true);
    interactionEl.addEventListener('load', schedule, true);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    capability.addEventListener('change', clear);
    return () => {
      disposed = true; point = null; cancelAnimationFrame(raf); refreshRef.current = null;
      interactionEl.removeEventListener('pointermove', move, true);
      interactionEl.removeEventListener('pointerleave', clear);
      interactionEl.removeEventListener('pointerdown', clear, true);
      interactionEl.removeEventListener('pointercancel', clear, true);
      interactionEl.removeEventListener('load', schedule, true);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      capability.removeEventListener('change', clear);
    };
  }, [containerEl, interactionEl]);

  useEffect(() => { refreshRef.current?.(); }, [rects, disabled, allowCanvasCoverSelection]);
  return hover?.owner === containerEl ? hover : null;
}
