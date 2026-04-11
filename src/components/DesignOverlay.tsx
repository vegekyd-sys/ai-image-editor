'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { EditableField } from '@/types';

interface DesignOverlayProps {
  containerEl: HTMLDivElement | null;
  editables: EditableField[];
  props: Record<string, unknown>;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onUpdateProp: (key: string, value: unknown) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  playerRef?: any;
}

interface MeasuredRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const DRAG_THRESHOLD = 3;

export default function DesignOverlay({
  containerEl,
  editables,
  props,
  selectedFieldId,
  onSelectField,
  onUpdateProp,
  playerRef,
}: DesignOverlayProps) {
  const [rects, setRects] = useState<MeasuredRect[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const rafRef = useRef<number>(0);

  // Drag state
  const dragRef = useRef<{
    fieldId: string;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    active: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });

  // Measure positions of [data-editable] elements inside the container
  const measure = useCallback(() => {
    if (!containerEl) { setRects([]); return; }
    const containerRect = containerEl.getBoundingClientRect();
    const elements = containerEl.querySelectorAll('[data-editable]');
    const newRects: MeasuredRect[] = [];
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id) return;
      // Only show overlay for declared editables
      if (!editables.some(f => f.id === id)) return;
      const elRect = el.getBoundingClientRect();
      newRects.push({
        id,
        left: elRect.left - containerRect.left,
        top: elRect.top - containerRect.top,
        width: elRect.width,
        height: elRect.height,
      });
    });
    setRects(newRects);
  }, [containerEl, editables]);

  // Measure on mount, on prop changes, and periodically for animations
  useEffect(() => {
    measure();
  }, [measure, props]);

  // Listen for frameupdate from Remotion Player (for animated designs)
  useEffect(() => {
    if (!playerRef) return;
    const handleFrame = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    try {
      playerRef.addEventListener('frameupdate', handleFrame);
    } catch { /* playerRef may not support this */ }
    return () => {
      try {
        playerRef.removeEventListener('frameupdate', handleFrame);
      } catch { /* ignore */ }
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
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    });
    observer.observe(containerEl, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [containerEl, measure]);

  // Drag handlers (document-level for smooth dragging)
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dx = clientX - d.startX;
      const dy = clientY - d.startY;
      if (!d.active) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        d.active = true;
        setIsDragging(true);
      }
      setDragDelta({ x: dx, y: dy });
    };
    const onUp = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d || !d.active) {
        dragRef.current = null;
        return;
      }
      const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
      const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;

      // Calculate new normalized position
      if (containerEl) {
        const containerRect = containerEl.getBoundingClientRect();
        const field = editables.find(f => f.id === d.fieldId);
        if (field?.positionProps) {
          const newLeft = d.origLeft + (clientX - d.startX);
          const newTop = d.origTop + (clientY - d.startY);
          const normX = newLeft / containerRect.width;
          const normY = newTop / containerRect.height;
          onUpdateProp(field.positionProps.x, Math.max(0, Math.min(1, normX)));
          onUpdateProp(field.positionProps.y, Math.max(0, Math.min(1, normY)));
        }
      }

      dragRef.current = null;
      setIsDragging(false);
      setDragDelta({ x: 0, y: 0 });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
  }, [containerEl, editables, onUpdateProp]);

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent, rect: MeasuredRect) => {
    const field = editables.find(f => f.id === rect.id);
    if (!field?.positionProps) return; // not draggable
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = {
      fieldId: rect.id,
      startX: clientX,
      startY: clientY,
      origLeft: rect.left,
      origTop: rect.top,
      active: false,
    };
  }, [editables]);

  if (rects.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
    >
      {rects.map((rect) => {
        const field = editables.find(f => f.id === rect.id);
        if (!field) return null;
        const isSelected = selectedFieldId === rect.id;
        const isHovered = hoveredId === rect.id;
        const isDraggable = !!field.positionProps;
        const isBeingDragged = isDragging && dragRef.current?.fieldId === rect.id;

        const left = isBeingDragged ? rect.left + dragDelta.x : rect.left;
        const top = isBeingDragged ? rect.top + dragDelta.y : rect.top;

        return (
          <div
            key={rect.id}
            className="absolute pointer-events-auto"
            style={{
              left,
              top,
              width: rect.width,
              height: rect.height,
              border: isSelected
                ? '1px dashed rgb(217,70,239)'
                : isHovered
                  ? '1px dashed rgba(255,255,255,0.6)'
                  : '1px dashed rgba(255,255,255,0.3)',
              cursor: isDraggable ? (isBeingDragged ? 'grabbing' : 'grab') : 'pointer',
              transition: isBeingDragged ? 'none' : 'border-color 0.15s',
              boxSizing: 'border-box',
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!isDragging) onSelectField(isSelected ? null : rect.id);
            }}
            onMouseEnter={() => setHoveredId(rect.id)}
            onMouseLeave={() => setHoveredId(null)}
            onMouseDown={(e) => handlePointerDown(e, rect)}
            onTouchStart={(e) => handlePointerDown(e, rect)}
          >
            {/* Label tag at top */}
            {isSelected && (
              <div
                className="absolute -top-5 left-0 px-1.5 py-0.5 text-[10px] font-medium rounded-sm whitespace-nowrap"
                style={{
                  backgroundColor: 'rgb(217,70,239)',
                  color: 'white',
                }}
              >
                {field.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
