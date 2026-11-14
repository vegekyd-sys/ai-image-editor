'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';

const matrix = (amount: number) => {
  const keep = 1 - amount;
  return `${keep} 0 0 0 ${amount} 0 ${keep} 0 0 ${amount * 130 / 255} 0 0 ${keep} 0 ${amount * 185 / 255} 0 0 0 1 0`;
};

/** RGB-only decoration in the layer's own paint order. Alpha, occlusion,
 * authored filters and persisted/exported design props remain unchanged. */
export default function EditableHoverTint({ element, fieldId, visible }: { element: HTMLElement; fieldId: string; visible: boolean }) {
  const filterId = `mkr-hover-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const colorRef = useRef<SVGFEColorMatrixElement>(null);
  const frameRef = useRef(0);
  const amountRef = useRef(0);
  const ownerRef = useRef<{ value: string; priority: string; expected: string; active: boolean } | null>(null);
  const restore = () => {
    const owner = ownerRef.current;
    if (owner?.active && element.style.filter === owner.expected) {
      if (owner.value) element.style.setProperty('filter', owner.value, owner.priority);
      else element.style.removeProperty('filter');
    }
    if (owner) owner.active = false;
  };
  const restoreRef = useRef(restore); restoreRef.current = restore;

  useLayoutEffect(() => {
    const base = getComputedStyle(element).filter;
    ownerRef.current = { value: element.style.filter, priority: element.style.getPropertyPriority('filter'),
      expected: `${base && base !== 'none' ? `${base} ` : ''}url("#${filterId}")`, active: false };
    amountRef.current = 0;
    return () => {
      cancelAnimationFrame(frameRef.current);
      // Capture this element's owner rather than a later render's callback.
      const owner = ownerRef.current;
      if (owner?.active && element.style.filter === owner.expected) {
        if (owner.value) element.style.setProperty('filter', owner.value, owner.priority);
        else element.style.removeProperty('filter');
      }
      ownerRef.current = null;
    };
  }, [element, filterId]);

  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    cancelAnimationFrame(frameRef.current);
    if (visible && (!owner.active || element.style.filter !== owner.expected)) {
      // An authored filter may have changed while this layer stayed mounted.
      // A later hover must compose with that latest value, not restore an old one.
      owner.value = element.style.filter; owner.priority = element.style.getPropertyPriority('filter');
      const base = getComputedStyle(element).filter;
      owner.expected = `${base && base !== 'none' ? `${base} ` : ''}url("#${filterId}")`;
      element.style.setProperty('filter', owner.expected, 'important'); owner.active = true;
    }
    const from = amountRef.current, to = visible ? .15 : 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const update = (now: number) => {
      if (!element.isConnected) return;
      if (owner.active && element.style.filter !== owner.expected) {
        owner.active = false; amountRef.current = 0; colorRef.current?.setAttribute('values', matrix(0)); return;
      }
      const progress = reduced ? 1 : Math.min(1, Math.max(0, (now - start) / 100));
      const amount = from + (to - from) * (1 - (1 - progress) ** 3);
      amountRef.current = amount;
      colorRef.current?.setAttribute('values', matrix(amount));
      if (progress < 1) frameRef.current = requestAnimationFrame(update);
      else if (!visible) restoreRef.current();
    };
    if (reduced) update(start); else frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [element, visible, filterId]);

  return <svg data-editable-hover-tint={fieldId} aria-hidden="true" width="0" height="0" className="absolute pointer-events-none">
    <defs><filter id={filterId} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
      <feColorMatrix ref={colorRef} type="matrix" values={matrix(0)} />
    </filter></defs>
  </svg>;
}
