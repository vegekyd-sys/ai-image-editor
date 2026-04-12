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
}

export default function DesignOverlay({
  containerEl,
  editables,
  props,
  selectedFieldId,
  onSelectField,
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

  // Measure positions of [data-editable] elements relative to the overlay itself
  const measure = useCallback(() => {
    if (!containerEl || !overlayRef.current) { setRects([]); return; }
    const baseRect = overlayRef.current.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const elements = containerEl.querySelectorAll('[data-editable]');
    const newRects: MeasuredRect[] = [];
    const seen = new Set<string>();
    elements.forEach((el) => {
      const id = el.getAttribute('data-editable');
      if (!id || seen.has(id)) return;
      if (!editables.some(f => f.id === id)) return;
      const elRect = el.getBoundingClientRect();
      // Skip elements outside the visible Remotion Player area
      if (elRect.width < 1 || elRect.height < 1) return;
      if (elRect.right <= containerRect.left || elRect.left >= containerRect.right) return;
      if (elRect.bottom <= containerRect.top || elRect.top >= containerRect.bottom) return;
      seen.add(id);
      newRects.push({
        id,
        left: elRect.left - baseRect.left,
        top: elRect.top - baseRect.top,
        width: elRect.width,
        height: elRect.height,
      });
    });
    setRects(newRects);
    // Notify parent which fields are visible at the current frame
    const visibleIds = newRects.map(r => r.id);
    onVisibleFieldsChangeRef.current?.(visibleIds);
  }, [containerEl, editables]);

  // Measure on mount, on prop changes
  useEffect(() => {
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

  // Re-measure when selection changes (input bar toggles → layout shift)
  useEffect(() => {
    const t = setTimeout(measure, 50);
    return () => clearTimeout(t);
  }, [selectedFieldId, measure]);

  // ResizeObserver on containerEl to catch layout changes
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl, measure]);

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
            className="absolute pointer-events-auto"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              border: isSelected
                ? '1px dashed rgb(217,70,239)'
                : isHovered
                  ? '1px dashed rgba(255,255,255,0.4)'
                  : '1px solid transparent',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
              boxSizing: 'border-box',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (isSelected) {
                onStartEdit?.(rect.id); // already selected → enter edit
              } else {
                onSelectField(rect.id); // first click → select
              }
            }}
            onMouseEnter={() => setHoveredId(rect.id)}
            onMouseLeave={() => setHoveredId(null)}
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
