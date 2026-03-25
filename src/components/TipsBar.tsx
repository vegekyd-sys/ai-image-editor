'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocale } from '@/lib/i18n';
import { Tip } from '@/types';
import { CATEGORIES } from '@/lib/categories';
import { getThumbnailUrl } from '@/lib/supabase/storage';

interface TipsBarProps {
  tips: Tip[];
  isLoading: boolean;
  isEditing: boolean;
  onTipClick: (tip: Tip, index: number) => void;
  onTipCommit?: (tip: Tip, index: number) => void;
  onTipDeselect?: () => void;
  onRetryPreview?: (tip: Tip, index: number) => void;
  previewingIndex: number | null;
  onLoadMore?: (category: Tip['category']) => void;
  onCategorySelect?: (category: Tip['category']) => void;
  loadingMoreCategories?: Set<Tip['category']>;
  isDesktop?: boolean;
  initialCategory?: Tip['category'];
  failedCategories?: Set<Tip['category']>;
  onRetryCategory?: (category: Tip['category']) => void;
  onRetryAll?: () => void;
}

function TipThumbnail({ tip, onRetryPreview, originalIndex }: {
  tip: Tip;
  onRetryPreview?: (tip: Tip, index: number) => void;
  originalIndex: number;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const isStorageUrl = tip.previewImage?.startsWith('http') ?? false;

  if (tip.previewStatus === 'done' && tip.previewImage) {
    // Use tiny thumbnail for the 72x72 TipsBar display; full image loads on click (canvas draft)
    const displayUrl = isStorageUrl
      ? getThumbnailUrl(tip.previewImage, 144, 60, 144)
      : tip.previewImage;
    return (
      <div className="w-full h-full relative">
        {isStorageUrl && !imgLoaded && (
          <div className="absolute inset-0 bg-white/5 animate-pulse" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrl}
          alt=""
          className={`w-full h-full object-cover ${isStorageUrl && !imgLoaded ? 'opacity-0' : ''}`}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
        />
      </div>
    );
  }

  if (tip.previewStatus === 'generating') {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (tip.previewStatus === 'error') {
    return (
      <div
        className="w-full h-full flex items-center justify-center text-2xl cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onRetryPreview?.(tip, originalIndex);
        }}
      >
        {tip.emoji}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center text-2xl opacity-50">
      {tip.emoji}
    </div>
  );
}

export default function TipsBar({ tips, isLoading, isEditing, onTipClick, onTipCommit, onTipDeselect, onRetryPreview, previewingIndex, onLoadMore, onCategorySelect, loadingMoreCategories, isDesktop, initialCategory, failedCategories, onRetryCategory, onRetryAll }: TipsBarProps) {
  const { t } = useLocale();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tipRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [activeCategory, setActiveCategory] = useState<Tip['category']>('enhance');

  // Flatten tips in category order (driven by CATEGORIES config), tracking original indices
  const orderedTips = useMemo(() => {
    const result: { tip: Tip; originalIndex: number }[] = [];
    for (const { id } of CATEGORIES) {
      tips.forEach((tip, i) => {
        if (tip.category === id) result.push({ tip, originalIndex: i });
      });
    }
    return result;
  }, [tips]);
  const hasTips = tips.length > 0;
  // Which categories currently have at least one tip
  const enabledCategories = useMemo(() => new Set<string>(tips.map(t => t.category)), [tips]);

  // Track the dominant category — whichever category occupies the most visible width in the viewport
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || orderedTips.length === 0) return;
    const containerRect = container.getBoundingClientRect();

    const visibleWidth: Partial<Record<Tip['category'], number>> = {};
    for (const { tip, originalIndex } of orderedTips) {
      const el = tipRefs.current.get(originalIndex);
      if (!el) continue;
      const elRect = el.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(elRect.right, containerRect.right) - Math.max(elRect.left, containerRect.left));
      if (overlap > 0) {
        visibleWidth[tip.category] = (visibleWidth[tip.category] ?? 0) + overlap;
      }
    }

    let dominant: Tip['category'] | null = null;
    let maxW = 0;
    for (const [cat, w] of Object.entries(visibleWidth) as [Tip['category'], number][]) {
      if (w > maxW) { maxW = w; dominant = cat; }
    }
    if (dominant) setActiveCategory(dominant);
  }, [orderedTips]);

  // Scroll to the first tip of a given category
  const scrollToCategory = useCallback((category: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const first = orderedTips.find(({ tip }) => tip.category === category);
    if (!first) return;
    const el = tipRefs.current.get(first.originalIndex);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetScrollLeft = container.scrollLeft + (elRect.left - containerRect.left) - 12;
    container.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
  }, [orderedTips]);

  // Scroll to initialCategory when tips first appear for a new snapshot
  const prevTipsLen = useRef(tips.length);
  useEffect(() => {
    const wasEmpty = prevTipsLen.current === 0;
    prevTipsLen.current = tips.length;
    if (wasEmpty && tips.length > 0 && initialCategory && initialCategory !== 'enhance') {
      // Delay slightly so DOM has rendered the new tips
      setTimeout(() => scrollToCategory(initialCategory), 80);
    }
  }, [tips.length, initialCategory, scrollToCategory]);

  // Scroll selected tip to center — delayed 220ms so button animation finishes first
  useEffect(() => {
    if (previewingIndex === null) return;
    const timer = setTimeout(() => {
      const container = scrollContainerRef.current;
      const tipEl = tipRefs.current.get(previewingIndex);
      if (!container || !tipEl) return;
      const scrollLeft = tipEl.offsetLeft - container.clientWidth / 2 + tipEl.offsetWidth / 2;
      container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
    }, 220);
    return () => clearTimeout(timer);
  }, [previewingIndex]);

  // Desktop: convert vertical wheel to horizontal scroll
  useEffect(() => {
    if (!isDesktop) return;
    const el = scrollContainerRef.current;
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

  // Desktop: click-and-drag to scroll horizontally
  const dragState = useRef<{ startX: number; scrollLeft: number; dragging: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDesktop) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    e.preventDefault(); // prevent browser default drag (text select / grab cursor)
    dragState.current = { startX: e.clientX, scrollLeft: el.scrollLeft, dragging: false };
  }, [isDesktop]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    if (Math.abs(dx) > 4 && !dragState.current.dragging) {
      dragState.current.dragging = true;
      setIsDragging(true);
    }
    if (!dragState.current.dragging) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollLeft = dragState.current.scrollLeft - dx;
  }, []);

  const onMouseUp = useCallback(() => {
    if (dragState.current?.dragging) {
      // Suppress the next click so dragging doesn't trigger a tip click
      const suppress = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', suppress, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', suppress, { capture: true }), 0);
    }
    dragState.current = null;
    setIsDragging(false);
  }, []);

  // Collect the set of categories present in current tips (for nav bar)
  return (
    <div data-testid="tips-bar" className="flex flex-col">
      {/* Carousel */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className={`flex items-end gap-2 px-3 pt-2 pb-1.5 overflow-x-auto hide-scrollbar ${isDesktop ? 'min-h-[70px] select-none' : 'min-h-[78px]'}`}
        style={isDragging ? { cursor: 'grabbing' } : undefined}
        data-dragging={isDragging || undefined}
      >
        {/* Tip cards with thumbnails */}
        {hasTips && orderedTips.map(({ tip, originalIndex }, i) => {
          const isSelected = previewingIndex === originalIndex;
          const showCommit = isSelected && tip.previewStatus === 'done' && !!tip.previewImage;
          const isLastInCategory = orderedTips[i + 1]?.tip.category !== tip.category;
          const meta = CATEGORIES.find(c => c.id === tip.category) ?? CATEGORIES[0];

          const missingPrompt = !tip.editPrompt;
          const handleCardClick = () => {
            if (missingPrompt) return; // not ready yet
            if (showCommit) {
              onTipDeselect?.();
            } else {
              onTipClick(tip, originalIndex);
            }
          };

          return (
            <div
              key={originalIndex}
              ref={(el) => {
                if (el) tipRefs.current.set(originalIndex, el);
                else tipRefs.current.delete(originalIndex);
              }}
              className="flex-shrink-0 flex items-stretch gap-2"
            >
              <div className="flex-shrink-0 flex items-stretch animate-tip-in">
                {/* Main tip card */}
                <button
                  data-testid={`tip-card-${originalIndex}`}
                  data-tip-category={tip.category}
                  data-tip-label={tip.label}
                  data-tip-status={tip.previewStatus || 'pending'}
                  onClick={handleCardClick}
                  disabled={isEditing}
                  className={`${isDesktop ? 'w-[176px]' : 'w-[200px]'} text-left hover:brightness-110 active:scale-[0.97] disabled:opacity-40 border overflow-hidden cursor-pointer ${
                    missingPrompt
                      ? 'border-white/5 opacity-50'
                      : isSelected
                        ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50'
                        : 'border-white/10'
                  }`}
                  style={{
                    borderRadius: showCommit ? '16px 0 0 16px' : '16px',
                    transition: 'border-radius 0.2s ease-out, filter 0.15s, transform 0.1s, border-color 0.15s',
                    background:
                      tip.category === 'enhance'
                        ? 'rgba(217,70,239,0.06)'
                        : tip.category === 'creative'
                          ? 'rgba(217,70,239,0.12)'
                          : tip.category === 'wild'
                            ? 'rgba(239,68,68,0.12)'
                            : 'rgba(245,158,11,0.12)',
                  }}
                >
                  <div className="flex">
                    {/* Thumbnail */}
                    <div className={`${isDesktop ? 'w-[64px] h-[64px]' : 'w-[72px] h-[72px]'} flex-shrink-0 bg-white/5 relative overflow-hidden`}>
                      {missingPrompt ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="flex gap-0.5">
                            <div className="w-1 h-1 bg-white/30 rounded-full typing-dot" />
                            <div className="w-1 h-1 bg-white/30 rounded-full typing-dot" />
                            <div className="w-1 h-1 bg-white/30 rounded-full typing-dot" />
                          </div>
                        </div>
                      ) : (
                        <TipThumbnail tip={tip} onRetryPreview={onRetryPreview} originalIndex={originalIndex} />
                      )}
                    </div>

                    {/* Text */}
                    <div className={`flex-1 min-w-0 flex flex-col justify-center ${isDesktop ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}>
                      <div className={`text-white font-semibold leading-tight truncate ${isDesktop ? 'text-[12px]' : 'text-[13px]'}`}>{tip.label}</div>
                      <div className={`text-white/50 leading-snug mt-0.5 line-clamp-2 ${isDesktop ? 'text-[11px]' : 'text-[11px]'}`}>{tip.desc}</div>
                    </div>
                  </div>
                </button>

                {/* Commit button — slides out from right with width animation */}
                <div
                  className="overflow-hidden flex-shrink-0"
                  style={{
                    width: showCommit ? (isDesktop ? 64 : 72) : 0,
                    transition: 'width 0.2s ease-out',
                  }}
                >
                  <button
                    onClick={() => onTipCommit?.(tip, originalIndex)}
                    className={`${isDesktop ? 'w-[64px]' : 'w-[72px]'} h-full flex flex-col items-center justify-center gap-1.5 rounded-r-2xl border border-l-0 border-fuchsia-500 active:scale-95 overflow-hidden relative group cursor-pointer`}
                    style={{
                      background: 'linear-gradient(135deg, rgba(217,70,239,0.18) 0%, rgba(192,38,211,0.32) 100%)',
                      transition: 'transform 0.1s',
                    }}
                  >
                    {/* Hover shimmer */}
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none"
                      style={{
                        background: 'linear-gradient(135deg, rgba(217,70,239,0.12) 0%, rgba(192,38,211,0.22) 100%)',
                        transition: 'opacity 0.2s',
                      }}
                    />
                    {/* Arrow icon */}
                    <svg
                      width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="text-fuchsia-300 relative z-10"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                    {/* Label */}
                    <span className="text-fuchsia-200 text-[10px] font-semibold tracking-wide leading-tight text-center relative z-10 whitespace-nowrap">
                      {t('tips.continueEditing')}
                    </span>
                  </button>
                </div>
              </div>

              {/* "更多" button at the end of each category group */}
              {isLastInCategory && onLoadMore && (
                <button
                  onClick={() => onLoadMore(tip.category)}
                  disabled={isEditing || loadingMoreCategories?.has(tip.category)}
                  className={`flex-shrink-0 rounded-2xl border border-dashed border-white/15 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-40 cursor-pointer ${isDesktop ? 'w-[44px] h-[64px]' : 'w-[52px] h-[72px]'}`}
                  style={{ background: meta.activeBg.replace('0.18', '0.08') }}
                >
                  {loadingMoreCategories?.has(tip.category) ? (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="opacity-50">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span className="text-[9px] font-medium" style={{ color: meta.activeText, opacity: 0.7 }}>{t('tips.more')}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}

        {/* Loading skeleton */}
        {!hasTips && isLoading && (
          <>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={`flex-shrink-0 rounded-2xl bg-fuchsia-500/8 animate-pulse border border-fuchsia-500/10 flex ${isDesktop ? 'w-[176px] h-[64px]' : 'w-[200px] h-[72px]'}`}
              >
                <div className={`${isDesktop ? 'w-[64px]' : 'w-[72px]'} h-full bg-white/5`} />
                <div className="flex-1 p-2.5 space-y-1.5">
                  <div className="h-3 w-16 bg-white/10 rounded" />
                  <div className="h-2.5 w-24 bg-white/5 rounded" />
                </div>
              </div>
            ))}
          </>
        )}

        {/* More tips loading indicator */}
        {hasTips && isLoading && tips.length < 6 && (
          <div className="flex-shrink-0 w-[60px] h-[72px] rounded-2xl bg-fuchsia-500/5 border border-fuchsia-500/10 flex items-center justify-center animate-pulse">
            <div className="flex gap-0.5">
              <div className="w-1 h-1 bg-fuchsia-400/40 rounded-full typing-dot" />
              <div className="w-1 h-1 bg-fuchsia-400/40 rounded-full typing-dot" />
              <div className="w-1 h-1 bg-fuchsia-400/40 rounded-full typing-dot" />
            </div>
          </div>
        )}

        {/* All tips failed — retry button */}
        {!hasTips && !isLoading && !!failedCategories?.size && (
          <button
            onClick={onRetryAll}
            className="flex-shrink-0 mx-auto flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/10 active:scale-95 transition-transform cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M21 21v-5h-5" />
            </svg>
            <span className="text-[13px] text-white/60">{t('tips.reload')}</span>
          </button>
        )}
      </div>

      {/* Category toolbar — always visible, driven by CATEGORIES config */}
      <div className="flex">
        {CATEGORIES.map(({ id, label, activeText }) => {
          const enabled = enabledCategories.has(id);
          const isFailed = !enabled && !!failedCategories?.has(id as Tip['category']);
          const isActive = enabled && activeCategory === id;
          return (
            <button
              key={id}
              onClick={() => {
                if (isFailed) { onRetryCategory?.(id as Tip['category']); return; }
                if (!enabled) return;
                scrollToCategory(id); onCategorySelect?.(id as Tip['category']);
              }}
              className="flex-1 flex items-center justify-center py-2 transition-opacity cursor-pointer"
              style={{
                color: isFailed ? 'rgba(239,68,68,0.6)' : isActive ? activeText : enabled ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)',
                pointerEvents: enabled || isFailed ? 'auto' : 'none',
              }}
            >
              <span className={`text-[11px] tracking-wide ${isActive ? 'font-semibold' : 'font-medium'}`}>{isFailed ? `${label} ↻` : label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
