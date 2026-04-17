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
  // Prevents first click after selection from immediately opening text editor
  const justSelectedRef = useRef(false);

  // Apply stored position offsets to Remotion DOM elements (uses CSS translate property to preserve Agent's transform)
  const applyStoredOffsets = useCallback((elements: NodeListOf<Element>) => {
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id) return;
      const pos = props[`_pos_${id}`] as { x: number; y: number } | undefined;
      if (pos) {
        (el as HTMLElement).style.translate = `${pos.x}px ${pos.y}px`;
      } else {
        (el as HTMLElement).style.translate = '';
      }
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
      // No stopPropagation needed — ImageCanvas handlers return early in Design Editor mode.
      const handlePointerDown = () => {
        if (selectedFieldIdRef.current !== id) {
          onSelectFieldRef.current(id);
          justSelectedRef.current = true;
        }
      };

      // Click: edit text (if already selected and not just-selected)
      const handleClick = () => {
        if (isDraggingRef.current) return;
        if (justSelectedRef.current) { justSelectedRef.current = false; return; }
        if (selectedFieldIdRef.current === id) {
          onStartEditRef.current?.(id);
        }
      };

      htmlEl.addEventListener('pointerdown', handlePointerDown);
      htmlEl.addEventListener('click', handleClick);

      cleanups.push(() => {
        htmlEl.removeEventListener('pointerdown', handlePointerDown);
        htmlEl.removeEventListener('click', handleClick);
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
          draggable={true}
          scalable={true}
          keepRatio={true}
          renderDirections={['se']}
          rotatable={false}
          origin={false}
          throttleDrag={0}
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
          onScaleStart={() => {
            isDraggingRef.current = true;
            setIsDragging(true);
            dragDomElRef.current = selectedRect.domEl;
          }}
          onScale={({ target, transform }) => {
            target.style.transform = transform;
          }}
          onScaleEnd={({ lastEvent }) => {
            if (lastEvent?.transform) {
              const match = lastEvent.transform.match(/scale\(([^,)]+)(?:,\s*([^)]+))?\)/);
              if (match) {
                onUpdateProp(`_scale_${selectedFieldId}`, {
                  w: parseFloat(match[1]),
                  h: parseFloat(match[2] || match[1]),
                });
              }
            }
          }}
        />
      )}
    </div>
  );
}
