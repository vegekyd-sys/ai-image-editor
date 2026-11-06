'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

/** Distance (px) from the box at which it starts reacting to a dragged file. */
const REACH = 280;

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * While files are being dragged anywhere over the window, report how close the
 * pointer is to `ref` (0 = far / not dragging, 1 = touching or inside), so the
 * drop target can grow more prominent as the file approaches.
 */
export function useDragProximity(ref: RefObject<HTMLElement | null>, enabled = true): { dragging: boolean; proximity: number } {
  const [state, setState] = useState({ dragging: false, proximity: 0 });
  const frameRef = useRef(0);
  const depthRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const reset = () => {
      depthRef.current = 0;
      cancelAnimationFrame(frameRef.current);
      setState(prev => (prev.dragging || prev.proximity ? { dragging: false, proximity: 0 } : prev));
    };
    const measure = (x: number, y: number) => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / REACH);
        const rounded = Math.round(proximity * 20) / 20;
        setState(prev => (prev.dragging && prev.proximity === rounded ? prev : { dragging: true, proximity: rounded }));
      });
    };
    const onEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depthRef.current += 1;
      measure(event.clientX, event.clientY);
    };
    const onOver = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      measure(event.clientX, event.clientY);
    };
    const onLeave = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) reset();
    };
    window.addEventListener('dragenter', onEnter, true);
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    return () => {
      window.removeEventListener('dragenter', onEnter, true);
      window.removeEventListener('dragover', onOver, true);
      window.removeEventListener('dragleave', onLeave, true);
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
      cancelAnimationFrame(frameRef.current);
    };
  }, [enabled, ref]);

  return state;
}
