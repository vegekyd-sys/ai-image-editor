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
  /** The actual DOM element inside the Remotion Player */
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const rafRef = useRef<number>(0);
  const onVisibleFieldsChangeRef = useRef(onVisibleFieldsChange);
  onVisibleFieldsChangeRef.current = onVisibleFieldsChange;

  // Track overlay container ref — used as coordinate base in measure()
  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayMountedRef = useRef(false);

  // Moveable ref
  const moveableRef = useRef<Moveable>(null);

  // Track drag state to suppress re-measure during drag
  const isDraggingRef = useRef(false);
  // Guard to prevent measure ↔ MutationObserver infinite loop
  const isMeasuringRef = useRef(false);

  // Refs for overlay hit-target divs (keyed by editable id)
  const hitTargetRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Snapshot of stored offset at drag start — stable during the entire drag
  const dragBaseOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Snapshot of the real DOM element at drag start
  const dragDomElRef = useRef<HTMLElement | null>(null);
  // Snapshot of Player scale at drag start (screen-px / design-px)
  const dragScaleRef = useRef(1);



  // Apply stored position offsets to Remotion DOM elements
  const applyStoredOffsets = useCallback((elements: NodeListOf<Element>) => {
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id) return;
      const posKey = `_pos_${id}`;
      const pos = props[posKey] as { x: number; y: number } | undefined;
      if (pos) {
        (el as HTMLElement).style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      }
    });
  }, [props]);

  // Measure positions of [data-editable] elements relative to the overlay itself
  const measure = useCallback(() => {
    if (isDraggingRef.current || isMeasuringRef.current) return;
    if (!containerEl || !overlayRef.current) { setRects([]); return; }

    isMeasuringRef.current = true;

    // Clear any leftover Moveable transforms on hit-target divs
    Object.values(hitTargetRefs.current).forEach(el => {
      if (el) el.style.transform = '';
    });

    // Re-apply stored offsets before measuring (Remotion re-renders reset transforms)
    const elements = containerEl.querySelectorAll('[data-editable]');
    applyStoredOffsets(elements);

    const baseRect = overlayRef.current.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const newRects: MeasuredRect[] = [];
    const seen = new Set<string>();
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id || seen.has(id)) return;
      if (!editables.some(f => f.id === id)) return;
      const elRect = el.getBoundingClientRect();
      const storedPos = props[`_pos_${id}`] as { x: number; y: number } | undefined;

      // If element is clipped (overflow:hidden in Player) but has a stored offset,
      // calculate expected position from the original rect + offset instead of using
      // the clipped getBoundingClientRect.
      let rectLeft = elRect.left - baseRect.left;
      let rectTop = elRect.top - baseRect.top;
      let rectWidth = elRect.width;
      let rectHeight = elRect.height;

      if (elRect.width < 1 || elRect.height < 1) {
        if (!storedPos) return; // truly invisible and never moved — skip

        // Element is clipped by Player overflow. Use the previous rect if available,
        // or estimate from stored offset. We can't measure the actual size when clipped,
        // so find the last known rect for this id.
        const prevRect = rects.find(r => r.id === id);
        if (prevRect) {
          rectLeft = prevRect.left;
          rectTop = prevRect.top;
          rectWidth = prevRect.width;
          rectHeight = prevRect.height;
        } else {
          // No previous rect — element was always clipped. Skip for now.
          return;
        }
      }
      seen.add(id);
      newRects.push({
        id,
        left: rectLeft,
        top: rectTop,
        width: rectWidth,
        height: rectHeight,
        domEl: el as HTMLElement,
      });
    });
    setRects(newRects);
    const visibleIds = newRects.map(r => r.id);
    onVisibleFieldsChangeRef.current?.(visibleIds);

    isMeasuringRef.current = false;
  }, [containerEl, editables, applyStoredOffsets]);

  // Measure on mount, on prop changes — also clears isDragging (props updated = drag committed)
  useEffect(() => {
    isDraggingRef.current = false;
    measure();
  }, [measure, props]);

  // Re-measure once overlay div mounts
  useEffect(() => {
    if (overlayRef.current && !overlayMountedRef.current) {
      overlayMountedRef.current = true;
      measure();
    }
  }, [measure]);

  // Listen for frameupdate from Remotion Player (for animated designs)
  useEffect(() => {
    if (!playerRef) return;
    const handleFrame = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    try { playerRef.addEventListener('frameupdate', handleFrame); } catch { /* */ }
    return () => {
      try { playerRef.removeEventListener('frameupdate', handleFrame); } catch { /* */ }
      cancelAnimationFrame(rafRef.current);
    };
  }, [playerRef, measure]);

  // Re-measure on window resize
  useEffect(() => {
    const handleResize = () => measure();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [measure]);

  // Observe container for DOM changes (Remotion re-renders)
  useEffect(() => {
    if (!containerEl) return;
    const observer = new MutationObserver(() => {
      if (isDraggingRef.current) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    });
    observer.observe(containerEl, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [containerEl, measure]);

  // Re-measure when selection changes
  useEffect(() => {
    const t = setTimeout(measure, 50);
    return () => clearTimeout(t);
  }, [selectedFieldId, measure]);

  // ResizeObserver on containerEl
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl, measure]);

  const selectedRect = rects.find(r => r.id === selectedFieldId);
  const selectedHitTarget = selectedFieldId ? hitTargetRefs.current[selectedFieldId] : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
    >
      {rects.map((rect) => {
        const field = editables.find(f => f.id === rect.id);
        if (!field) return null;
        const isSelected = selectedFieldId === rect.id;
        const isHovered = hoveredId === rect.id;

        return (
          <div
            key={rect.id}
            ref={(el) => { hitTargetRefs.current[rect.id] = el; }}
            className="absolute pointer-events-auto"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              border: isHovered && !isSelected
                ? '1px dashed rgba(255,255,255,0.4)'
                : '1px solid transparent',
              cursor: isSelected ? 'move' : 'pointer',
              transition: isDraggingRef.current ? 'none' : 'border-color 0.15s',
              boxSizing: 'border-box',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (isDraggingRef.current) return;
              if (isSelected) {
                onStartEdit?.(rect.id);
              } else {
                onSelectField(rect.id);
              }
            }}
            onMouseEnter={() => setHoveredId(rect.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {isSelected && !isDraggingRef.current && (
              <div
                className="absolute -top-5 left-0 px-1.5 py-0.5 text-[10px] font-medium rounded-sm whitespace-nowrap"
                style={{ backgroundColor: 'rgb(217,70,239)', color: 'white' }}
              >
                {field.label}
              </div>
            )}
          </div>
        );
      })}

      {/* Moveable: targets the hit-target div, mirrors movement to real DOM element */}
      {selectedHitTarget && selectedRect && selectedFieldId && (
        <Moveable
          ref={moveableRef}
          target={selectedHitTarget}
          draggable={true}
          resizable={false}
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
          isDisplaySnapDigit={false}
          snapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
          elementSnapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
          horizontalGuidelines={overlayRef.current ? [0, overlayRef.current.offsetHeight / 2, overlayRef.current.offsetHeight] : []}
          verticalGuidelines={overlayRef.current ? [0, overlayRef.current.offsetWidth / 2, overlayRef.current.offsetWidth] : []}
          elementGuidelines={rects.filter(r => r.id !== selectedFieldId).map(r => hitTargetRefs.current[r.id]).filter(Boolean) as HTMLElement[]}
          onDragStart={({ set }) => {
            isDraggingRef.current = true;
            // Snapshot the current stored offset — stable for the entire drag
            const pos = props[`_pos_${selectedFieldId}`] as { x: number; y: number } | undefined;
            dragBaseOffsetRef.current = { x: pos?.x ?? 0, y: pos?.y ?? 0 };
            dragDomElRef.current = selectedRect.domEl;
            // Compute Player scale: compare DOM element's screen size vs layout size
            const el = selectedRect.domEl;
            if (el.offsetWidth > 0) {
              dragScaleRef.current = el.getBoundingClientRect().width / el.offsetWidth;
            } else {
              dragScaleRef.current = 1;
            }
            // Reset Moveable's internal translate tracking to [0,0]
            set([0, 0]);
          }}
          onDrag={({ target, beforeTranslate }) => {
            const tx = beforeTranslate[0];
            const ty = beforeTranslate[1];

            // Move hit-target
            target.style.transform = `translate(${tx}px, ${ty}px)`;

            // Mirror to real DOM element (convert screen-px → design-px).
            // The Remotion Player scales composition content to fit the container.
            // beforeTranslate is in screen-px, but DOM element transform is in design-px.
            const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
            if (dragDomElRef.current) {
              const scale = dragScaleRef.current;
              dragDomElRef.current.style.transform = `translate(${baseX + tx / scale}px, ${baseY + ty / scale}px)`;
            }
          }}
          onDragEnd={({ lastEvent }) => {
            if (lastEvent) {
              const tx = lastEvent.beforeTranslate[0];
              const ty = lastEvent.beforeTranslate[1];
              const scale = dragScaleRef.current;
              const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
              onUpdateProp(`_pos_${selectedFieldId}`, { x: baseX + tx / scale, y: baseY + ty / scale });
            }
            // isDragging cleared by useEffect([props]) when the prop update propagates
          }}
        />
      )}
    </div>
  );
}
