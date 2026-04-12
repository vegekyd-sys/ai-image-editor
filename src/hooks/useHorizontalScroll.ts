import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Shared hook for horizontal pill carousel scrolling.
 * Used by TipsBar, VideoResultCard, and DesignEditPanel.
 * Provides: wheel→horizontal, click-drag scroll, auto-scroll to selected item.
 */
export function useHorizontalScroll(isDesktop: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; scrollLeft: number; dragging: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Desktop: convert vertical wheel to horizontal scroll
  useEffect(() => {
    if (!isDesktop) return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isDesktop]);

  // Desktop: click-and-drag to scroll
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDesktop) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    dragState.current = { startX: e.clientX, scrollLeft: el.scrollLeft, dragging: false };
  }, [isDesktop]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    if (!dragState.current.dragging && Math.abs(dx) > 3) {
      dragState.current.dragging = true;
      setIsDragging(true);
    }
    if (!dragState.current.dragging) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft = dragState.current.scrollLeft - dx;
  }, []);

  const onMouseUp = useCallback(() => {
    if (dragState.current?.dragging) {
      // Delay reset so click handlers can check isDragging
      setTimeout(() => setIsDragging(false), 0);
    }
    dragState.current = null;
  }, []);

  // Scroll an element into view (centered)
  const scrollIntoView = useCallback((el: HTMLElement | null) => {
    const container = scrollRef.current;
    if (!container || !el) return;
    const scrollLeft = el.offsetLeft - container.clientWidth / 2 + el.offsetWidth / 2;
    container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
  }, []);

  return {
    scrollRef,
    isDragging,
    scrollIntoView,
    dragHandlers: isDesktop ? {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave: onMouseUp,
      style: isDragging ? { cursor: 'grabbing' as const } : undefined,
    } : {},
  };
}
