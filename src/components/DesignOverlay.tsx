'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import Moveable from 'react-moveable';
import type { EditableField } from '@/types';

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

  // Drag snapshots
  const dragBaseOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragDomElRef = useRef<HTMLElement | null>(null);
  const dragScaleRef = useRef<{ w: number; h: number }>({ w: 1, h: 1 });

  // Apply stored position + scale to Remotion DOM elements
  // Uses independent CSS properties (translate/scale) to preserve Agent's transform animations
  const applyStoredOffsets = useCallback((elements: NodeListOf<Element>) => {
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id) return;
      const htmlEl = el as HTMLElement;
      const pos = props[`_pos_${id}`] as { x: number; y: number } | undefined;
      const sc = props[`_scale_${id}`] as { w: number; h: number } | undefined;
      htmlEl.style.translate = pos ? `${pos.x}px ${pos.y}px` : '';
      htmlEl.style.scale = sc ? `${sc.w} ${sc.h}` : '';
    });
  }, [props]);

  // Measure editable elements
  const measure = useCallback(() => {
    if (isDraggingRef.current || isMeasuringRef.current) return;
    if (!containerEl || !overlayRef.current) { setRects([]); return; }

    isMeasuringRef.current = true;

    const elements = containerEl.querySelectorAll('[data-editable]');
    applyStoredOffsets(elements);

    const baseRect = overlayRef.current.getBoundingClientRect();
    const newRects: MeasuredRect[] = [];
    const seen = new Set<string>();
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id || seen.has(id)) return;
      if (!editables.some(f => f.id === id)) return;
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
    isMeasuringRef.current = false;
  }, [containerEl, editables, applyStoredOffsets, props]);

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

  // Bind click + gesture isolation directly on each editable DOM element.
  // This replaces hit-target's role: stopPropagation prevents canvas gestures,
  // click handles select/edit.
  const onSelectFieldRef = useRef(onSelectField);
  onSelectFieldRef.current = onSelectField;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;
  const selectedFieldIdRef = useRef(selectedFieldId);
  selectedFieldIdRef.current = selectedFieldId;

  useEffect(() => {
    if (!containerEl) return;
    const elements = containerEl.querySelectorAll('[data-editable]');
    const cleanups: (() => void)[] = [];

    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id || !editables.some(f => f.id === id)) return;
      const htmlEl = el as HTMLElement;

      // Pointerdown: select immediately (enables direct drag on desktop).
      let lastTapTime = 0;
      let activeTouches = 0;
      const handlePointerDown = (e: PointerEvent) => {
        if (e.pointerType === 'touch') activeTouches++;
        const now = Date.now();
        // Only trigger double-tap edit with single finger — pinch fires 2 pointerdowns rapidly
        if (activeTouches <= 1 && selectedFieldIdRef.current === id && now - lastTapTime < 400) {
          onStartEditRef.current?.(id);
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
        if (selectedFieldIdRef.current !== id) {
          onSelectFieldRef.current(id);
        }
      };
      const handlePointerUp = (e: PointerEvent) => {
        if (e.pointerType === 'touch') activeTouches = Math.max(0, activeTouches - 1);
      };

      htmlEl.addEventListener('pointerdown', handlePointerDown);
      htmlEl.addEventListener('pointerup', handlePointerUp);

      cleanups.push(() => {
        htmlEl.removeEventListener('pointerdown', handlePointerDown);
        htmlEl.removeEventListener('pointerup', handlePointerUp);
      });
    });

    return () => cleanups.forEach(fn => fn());
  }, [containerEl, editables, rects]); // re-bind when DOM changes

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

      {/* Moveable: directly targets the real DOM element inside Remotion Player */}
      {selectedRect && selectedFieldId && (
        <Moveable
          ref={moveableRef}
          target={selectedRect.domEl}
          rootContainer={containerEl ?? undefined}
          draggable={true}
          scalable={true}
          keepRatio={true}
          renderDirections={['nw', 'ne', 'sw', 'se']}
          pinchable={true}
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
            set([0, 0]);
          }}
          onDrag={({ target, beforeTranslate }) => {
            const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
            target.style.translate = `${baseX + beforeTranslate[0]}px ${baseY + beforeTranslate[1]}px`;
          }}
          onDragEnd={({ lastEvent }) => {
            if (lastEvent) {
              const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
              onUpdateProp(`_pos_${selectedFieldId}`, {
                x: baseX + lastEvent.beforeTranslate[0],
                y: baseY + lastEvent.beforeTranslate[1],
              });
            }
          }}
          /* ── Scale ── */
          onScaleStart={({ set }) => {
            isDraggingRef.current = true;
            setIsDragging(true);
            dragDomElRef.current = selectedRect.domEl;
            // Snapshot base scale, reset Moveable to 1x (same pattern as drag's set([0,0]))
            const sc = props[`_scale_${selectedFieldId}`] as { w: number; h: number } | undefined;
            dragBaseOffsetRef.current = { x: sc?.w ?? 1, y: sc?.h ?? 1 };
            set([1, 1]);
          }}
          onScale={({ target, scale: scaleVec }) => {
            // Multiply Moveable's delta (from 1x) with base scale, apply via CSS scale property
            const { x: baseW, y: baseH } = dragBaseOffsetRef.current;
            target.style.scale = `${baseW * scaleVec[0]} ${baseH * scaleVec[1]}`;
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
