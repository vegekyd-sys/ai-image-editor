'use client';

import { ReactNode, useEffect } from 'react';
import { useHorizontalScroll } from '@/hooks/useHorizontalScroll';
import { MOBILE_EDITOR_SLOT_HEIGHT } from '@/lib/editor/panel-layout';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useLocale } from '@/lib/i18n';

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
  const { scrollRef, dragHandlers, isDragging } = useHorizontalScroll(!!isDesktop);

  // Auto-scroll a target element into view
  useEffect(() => {
    scrollToRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [scrollToRef?.current]);

  return (
    <div
      className="flex flex-col"
      data-testid="pill-carousel"
      style={{ height: MOBILE_EDITOR_SLOT_HEIGHT }}
    >
      {/* Pill carousel */}
      <div
        ref={scrollRef}
        data-pill-row
        className={`flex h-[86px] shrink-0 items-end gap-2 px-3 pt-2 pb-1.5 overflow-x-auto hide-scrollbar ${isDesktop ? 'select-none' : ''}`}
        onClickCapture={event => { if (isDragging) { event.preventDefault(); event.stopPropagation(); } }}
        {...dragHandlers}
      >
        {children}
      </div>

      {/* Toolbar — always present for stable height */}
      <div data-pill-toolbar className="flex min-h-0 flex-1 items-center justify-center">
        {toolbar}
      </div>
    </div>
  );
}

export function EditablePanelSkeleton({ isDesktop: desktop }: { isDesktop?: boolean }) {
  const detectedDesktop = useIsDesktop();
  const isDesktop = desktop ?? detectedDesktop;
  const { t } = useLocale();
  return <div role="status" aria-label={t('design.loadingEditables')} aria-busy="true" data-testid="editable-panel-loading">
    <PillCarousel isDesktop={isDesktop} toolbar={<span className="text-[11px] text-white/40">{t('design.loadingEditables')}</span>}>
      {[0, 1, 2].map(index => <div key={index} aria-hidden="true" className={`mkr-liquid-placeholder mkr-liquid-placeholder-passive flex shrink-0 overflow-hidden rounded-2xl border border-fuchsia-500/10 ${isDesktop ? 'w-[176px] h-[64px]' : 'w-[200px] h-[72px]'}`}>
        <div className={`h-full bg-white/5 ${isDesktop ? 'w-[64px]' : 'w-[72px]'}`} />
        <div className="flex flex-col justify-center gap-2 px-3"><div className="mkr-liquid-placeholder-line h-3 w-16 rounded"/><div className="mkr-liquid-placeholder-line h-2.5 w-20 rounded"/></div>
      </div>)}
    </PillCarousel>
  </div>;
}
