'use client';

import { ReactNode, useEffect } from 'react';
import { useHorizontalScroll } from '@/hooks/useHorizontalScroll';
import { MOBILE_EDITOR_SLOT_HEIGHT } from '@/lib/editor/panel-layout';

interface PillCarouselProps {
  children: ReactNode;
  toolbar?: ReactNode;
  isDesktop?: boolean;
  /** Element ref to scroll into view (e.g. selected pill) */
  scrollToRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Shared layout for TipsBar, DesignEditPanel, and VideoResultCard.
 * Provides:
 *   - Horizontal scroll carousel (top) with desktop drag-to-scroll
 *   - Fixed-height toolbar (bottom) — always rendered so total height is stable
 */
export default function PillCarousel({ children, toolbar, isDesktop, scrollToRef }: PillCarouselProps) {
  const { scrollRef, dragHandlers } = useHorizontalScroll(!!isDesktop);

  // Auto-scroll a target element into view
  useEffect(() => {
    scrollToRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [scrollToRef?.current]);

  return (
    <div
      className="flex flex-col"
      style={isDesktop ? undefined : { height: MOBILE_EDITOR_SLOT_HEIGHT }}
    >
      {/* Pill carousel */}
      <div
        ref={scrollRef}
        className={`flex items-end gap-2 px-3 pt-2 pb-1.5 overflow-x-auto hide-scrollbar ${isDesktop ? 'min-h-[70px] select-none' : 'min-h-[78px]'}`}
        {...dragHandlers}
      >
        {children}
      </div>

      {/* Toolbar — always present for stable height */}
      <div className="flex items-center justify-center py-2">
        {toolbar}
      </div>
    </div>
  );
}
