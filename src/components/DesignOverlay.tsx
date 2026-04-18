'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import Moveable from 'react-moveable';
import type { EditableField } from '@/types';
import { buildEditableTransform } from '@/lib/evalRemotionJSX';

interface DesignOverlayProps {
  containerEl: HTMLDivElement | null;
  editables: EditableField[];
  props: Record<string, unknown>;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onUpdateProp: (key: string, value: unknown) => void;
  onStartEdit?: (fieldId: string) => void;
  onVisibleFieldsChange?: (visibleIds: string[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  playerRef?: any;
}

interface MeasuredRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  domEl: HTMLElement;
}

export default function DesignOverlay({
  containerEl,
  editables,
  props,
  selectedFieldId,
  onSelectField,
  onUpdateProp,
  onStartEdit,
  onVisibleFieldsChange,
  playerRef,
}: DesignOverlayProps) {
  const [rects, setRects] = useState<MeasuredRect[]>([]);
  const rafRef = useRef<number>(0);
  const onVisibleFieldsChangeRef = useRef(onVisibleFieldsChange);
  onVisibleFieldsChangeRef.current = onVisibleFieldsChange;

  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayMountedRef = useRef(false);
  const moveableRef = useRef<Moveable>(null);

  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const isMeasuringRef = useRef(false);
  // Incremented when DOM elements change (Sequence remount) — forces listener rebinding
  const [bindGeneration, setBindGeneration] = useState(0);
  const prevDomElsRef = useRef<Set<HTMLElement>>(new Set());

  // Drag snapshots
  const dragBaseOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragDomElRef = useRef<HTMLElement | null>(null);
  const dragScaleRef = useRef(1);

  // Measure editable elements
  // Transforms (_pos_*/_scale_*) are applied by the HOC in evalRemotionJSX.ts,
  // so DOM positions are already correct when we measure here.
  const measure = useCallback(() => {
    if (isDraggingRef.current || isMeasuringRef.current) return;
    if (!containerEl || !overlayRef.current) { setRects([]); return; }

    isMeasuringRef.current = true;

    const elements = containerEl.querySelectorAll('[data-editable]');

    const baseRect = overlayRef.current.getBoundingClientRect();
    const newRects: MeasuredRect[] = [];
    const seen = new Set<string>();
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id || seen.has(id)) return;
      if (!editables.some(f => f.id === id)) return;
      // Fix inline elements — Moveable needs a box model to work correctly
      const htmlEl = el as HTMLElement;
      if (getComputedStyle(htmlEl).display === 'inline') {
        htmlEl.style.display = 'inline-block';
      }
      const elRect = el.getBoundingClientRect();
      const storedPos = props[`_pos_${id}`] as { x: number; y: number } | undefined;

      let rectLeft = Math.round(elRect.left - baseRect.left);
      let rectTop = Math.round(elRect.top - baseRect.top);
      let rectWidth = Math.round(elRect.width);
      let rectHeight = Math.round(elRect.height);

      if (elRect.width < 1 || elRect.height < 1) {
        if (!storedPos) return;
        const prevRect = rects.find(r => r.id === id);
        if (prevRect) {
          rectLeft = prevRect.left;
          rectTop = prevRect.top;
          rectWidth = prevRect.width;
          rectHeight = prevRect.height;
        } else {
          return;
        }
      }
      seen.add(id);
      newRects.push({ id, left: rectLeft, top: rectTop, width: rectWidth, height: rectHeight, domEl: el as HTMLElement });
    });
    setRects(newRects);
    onVisibleFieldsChangeRef.current?.(newRects.map(r => r.id));
    // Detect DOM element replacement (Sequence remount) → force listener rebind
    const newDomEls = new Set(newRects.map(r => r.domEl));
    const prev = prevDomElsRef.current;
    if (newDomEls.size !== prev.size || [...newDomEls].some(el => !prev.has(el))) {
      prevDomElsRef.current = newDomEls;
      setBindGeneration(g => g + 1);
    }
    isMeasuringRef.current = false;
  }, [containerEl, editables, props]);

  // Mark selected element (CSS hides hover outline when Moveable frame shows)
  useEffect(() => {
    const el = selectedFieldId ? rects.find(r => r.id === selectedFieldId)?.domEl : null;
    if (el) el.setAttribute('data-editable-selected', '');
    return () => { if (el) el.removeAttribute('data-editable-selected'); };
  }, [selectedFieldId, rects]);

  // Measure triggers
  useEffect(() => { isDraggingRef.current = false; setIsDragging(false); measure(); }, [measure, props]);
  useEffect(() => { if (overlayRef.current && !overlayMountedRef.current) { overlayMountedRef.current = true; measure(); } }, [measure]);
  useEffect(() => {
    if (!playerRef) return;
    const h = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); };
    try { playerRef.addEventListener('frameupdate', h); } catch { /* */ }
    return () => { try { playerRef.removeEventListener('frameupdate', h); } catch { /* */ } cancelAnimationFrame(rafRef.current); };
  }, [playerRef, measure]);
  useEffect(() => { const h = () => measure(); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [measure]);
  useEffect(() => {
    if (!containerEl) return;
    const o = new MutationObserver(() => { if (isDraggingRef.current) return; cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); });
    o.observe(containerEl, { childList: true, subtree: true, attributes: true });
    return () => o.disconnect();
  }, [containerEl, measure]);
  useEffect(() => { const t = setTimeout(measure, 50); return () => clearTimeout(t); }, [selectedFieldId, measure]);
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); });
    ro.observe(containerEl); return () => ro.disconnect();
  }, [containerEl, measure]);

  // Bind click + double-tap-to-edit on each editable DOM element
  const onSelectFieldRef = useRef(onSelectField);
  onSelectFieldRef.current = onSelectField;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;
  const selectedFieldIdRef = useRef(selectedFieldId);
  selectedFieldIdRef.current = selectedFieldId;

  // Event delegation: single listener on container, works for any DOM element regardless of remount
  useEffect(() => {
    if (!containerEl) return;
    let lastTapTime = 0;
    let lastTapId = '';
    let activeTouches = 0;

    const handlePointerDown = (e: PointerEvent) => {
      const target = (e.target as HTMLElement).closest?.('[data-editable]');
      if (!target) return;
      const id = target.getAttribute('data-editable');
      if (!id || !editables.some(f => f.id === id)) return;

      if (e.pointerType === 'touch') activeTouches++;
      const now = Date.now();
      if (activeTouches <= 1 && selectedFieldIdRef.current === id && lastTapId === id && now - lastTapTime < 400) {
        onStartEditRef.current?.(id);
        lastTapTime = 0;
        lastTapId = '';
        return;
      }
      lastTapTime = now;
      lastTapId = id;
      if (selectedFieldIdRef.current !== id) {
        onSelectFieldRef.current(id);
      }
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') activeTouches = Math.max(0, activeTouches - 1);
    };

    // Use capture phase — Remotion Player's double-click prevention registers
    // document-level pointerup listeners that delay mouse events by 200ms.
    // Capture runs before Player's bubble-phase handler, ensuring selection works.
    containerEl.addEventListener('pointerdown', handlePointerDown, { capture: true });
    containerEl.addEventListener('pointerup', handlePointerUp);
    return () => {
      containerEl.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      containerEl.removeEventListener('pointerup', handlePointerUp);
    };
  }, [containerEl, editables]);

  // ── Container-level pinch-to-scale ──
  // Single implementation: works regardless of where fingers land.
  // Moveable's pinchable is disabled — this is the only pinch handler.
  const pinchRef = useRef<{ startDist: number; baseW: number; baseH: number } | null>(null);

  useEffect(() => {
    if (!containerEl) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (!selectedFieldIdRef.current || e.touches.length !== 2) return;
      const sc = props[`_scale_${selectedFieldIdRef.current}`] as { w: number; h: number } | undefined;
      pinchRef.current = {
        startDist: getDist(e.touches),
        baseW: sc?.w ?? 1,
        baseH: sc?.h ?? 1,
      };
      isDraggingRef.current = true;
      setIsDragging(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (!p || e.touches.length < 2 || !selectedFieldIdRef.current) return;
      e.preventDefault();

      const ratio = getDist(e.touches) / p.startDist;
      const newW = p.baseW * ratio;
      const newH = p.baseH * ratio;

      // Apply scale via transform (renderMediaOnWeb only reads style.transform)
      const el = containerEl.querySelector(
        `[data-editable="${selectedFieldIdRef.current}"]`
      ) as HTMLElement | null;
      if (el) {
        const pos = props[`_pos_${selectedFieldIdRef.current}`] as { x: number; y: number } | undefined;
        el.style.transform = buildEditableTransform(pos, { w: newW, h: newH });
      }

      // Update Moveable frame to follow
      moveableRef.current?.updateRect();
    };

    const onTouchEnd = () => {
      if (!pinchRef.current) return;
      const fieldId = selectedFieldIdRef.current;
      pinchRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);

      if (!fieldId) return;
      // Persist the pinched scale (read from pinch state, not DOM)
      const el = containerEl.querySelector(
        `[data-editable="${fieldId}"]`
      ) as HTMLElement | null;
      if (el) {
        // Parse scale from the transform string we set during pinch
        const match = el.style.transform.match(/scale\(([\d.]+),\s*([\d.]+)\)/);
        if (match) {
          onUpdateProp(`_scale_${fieldId}`, { w: parseFloat(match[1]), h: parseFloat(match[2]) });
        }
      }
    };

    containerEl.addEventListener('touchstart', onTouchStart, { passive: true });
    containerEl.addEventListener('touchmove', onTouchMove, { passive: false });
    containerEl.addEventListener('touchend', onTouchEnd, { passive: true });
    containerEl.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      containerEl.removeEventListener('touchstart', onTouchStart);
      containerEl.removeEventListener('touchmove', onTouchMove);
      containerEl.removeEventListener('touchend', onTouchEnd);
      containerEl.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerEl, props, onUpdateProp]);

  const selectedRect = rects.find(r => r.id === selectedFieldId);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
    >
      {/* Label tag for selected element — hidden during drag */}
      {selectedRect && selectedFieldId && !isDragging && (() => {
        const field = editables.find(f => f.id === selectedFieldId);
        if (!field) return null;
        return (
          <div
            className="absolute px-1.5 py-0.5 text-[10px] font-medium rounded-sm whitespace-nowrap pointer-events-none"
            style={{
              left: selectedRect.left,
              top: selectedRect.top - 20,
              backgroundColor: 'rgb(217,70,239)',
              color: 'white',
            }}
          >
            {field.label}
          </div>
        );
      })()}

      {/* Moveable: drag + desktop scale handles. Pinch handled by container touch listener above. */}
      {selectedRect && selectedFieldId && (
        <Moveable
          ref={moveableRef}
          target={selectedRect.domEl}
          rootContainer={containerEl ?? undefined}
          draggable={true}
          scalable={true}
          keepRatio={true}
          renderDirections={['nw', 'ne', 'sw', 'se']}
          pinchable={false}
          rotatable={false}
          origin={false}
          throttleDrag={0}
          throttleScale={0}
          hideDefaultLines={false}
          edge={false}
          padding={{ left: 0, top: 0, right: 0, bottom: 0 }}
          /* ── Snap & Guidelines ── */
          snappable={true}
          snapThreshold={8}
          snapGap={true}
          isDisplaySnapDigit={true}
          snapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
          elementSnapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
          horizontalGuidelines={overlayRef.current ? [Math.round(overlayRef.current.clientHeight / 2)] : []}
          verticalGuidelines={overlayRef.current ? [Math.round(overlayRef.current.clientWidth / 2)] : []}
          elementGuidelines={rects.filter(r => r.id !== selectedFieldId).map(r => r.domEl)}
          /* ── Drag ── */
          onDragStart={({ set }) => {
            isDraggingRef.current = true;
            setIsDragging(true);
            const pos = props[`_pos_${selectedFieldId}`] as { x: number; y: number } | undefined;
            dragBaseOffsetRef.current = { x: pos?.x ?? 0, y: pos?.y ?? 0 };
            dragDomElRef.current = selectedRect.domEl;
            const sc = props[`_scale_${selectedFieldId}`] as { w: number; h: number } | undefined;
            dragScaleRef.current = sc?.w ?? 1;
            set([0, 0]);
          }}
          onDrag={({ target, beforeTranslate }) => {
            const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
            const s = dragScaleRef.current;
            const newPos = { x: baseX + beforeTranslate[0] * s, y: baseY + beforeTranslate[1] * s };
            const sc = props[`_scale_${selectedFieldId}`] as { w: number; h: number } | undefined;
            target.style.transform = buildEditableTransform(newPos, sc);
          }}
          onDragEnd={({ lastEvent }) => {
            if (lastEvent) {
              const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
              const s = dragScaleRef.current;
              onUpdateProp(`_pos_${selectedFieldId}`, {
                x: baseX + lastEvent.beforeTranslate[0] * s,
                y: baseY + lastEvent.beforeTranslate[1] * s,
              });
            }
          }}
          /* ── Scale (desktop handle drag only) ── */
          onScaleStart={({ set }) => {
            isDraggingRef.current = true;
            setIsDragging(true);
            dragDomElRef.current = selectedRect.domEl;
            const sc = props[`_scale_${selectedFieldId}`] as { w: number; h: number } | undefined;
            dragBaseOffsetRef.current = { x: sc?.w ?? 1, y: sc?.h ?? 1 };
            set([1, 1]);
          }}
          onScale={({ target, scale: scaleVec }) => {
            const { x: baseW, y: baseH } = dragBaseOffsetRef.current;
            const newSc = { w: baseW * scaleVec[0], h: baseH * scaleVec[1] };
            const pos = props[`_pos_${selectedFieldId}`] as { x: number; y: number } | undefined;
            target.style.transform = buildEditableTransform(pos, newSc);
          }}
          onScaleEnd={({ lastEvent }) => {
            if (lastEvent) {
              const { x: baseW, y: baseH } = dragBaseOffsetRef.current;
              onUpdateProp(`_scale_${selectedFieldId}`, {
                w: baseW * lastEvent.scale[0],
                h: baseH * lastEvent.scale[1],
              });
            }
          }}
        />
      )}
    </div>
  );
}
