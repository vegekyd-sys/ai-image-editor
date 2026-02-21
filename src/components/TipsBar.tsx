'use client';

import { useState, useRef, useEffect } from 'react';
import { Tip } from '@/types';

interface TipsBarProps {
  tips: Tip[];
  isLoading: boolean;
  isEditing: boolean;
  onTipClick: (tip: Tip, index: number) => void;
  onTipCommit?: (tip: Tip, index: number) => void;
  onTipDeselect?: () => void;
  onRetryPreview?: (tip: Tip, index: number) => void;
  previewingIndex: number | null;
}

const CATEGORY_ORDER: Tip['category'][] = ['enhance', 'creative', 'wild'];

function TipThumbnail({ tip, onRetryPreview, originalIndex }: {
  tip: Tip;
  onRetryPreview?: (tip: Tip, index: number) => void;
  originalIndex: number;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const isStorageUrl = tip.previewImage?.startsWith('http') ?? false;

  if (tip.previewStatus === 'done' && tip.previewImage) {
    return (
      <div className="w-full h-full relative">
        {isStorageUrl && !imgLoaded && (
          <div className="absolute inset-0 bg-white/5 animate-pulse" />
        )}
        <img
          src={tip.previewImage}
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
        className="w-full h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onRetryPreview?.(tip, originalIndex);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
          <path d="M21 2v6h-6" />
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M3 22v-6h6" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
        <span className="text-[9px] text-white/30">重试</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center text-2xl opacity-50">
      {tip.emoji}
    </div>
  );
}

export default function TipsBar({ tips, isLoading, isEditing, onTipClick, onTipCommit, onTipDeselect, onRetryPreview, previewingIndex }: TipsBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tipRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Flatten tips in category order, tracking original indices
  const orderedTips: { tip: Tip; originalIndex: number }[] = [];
  for (const cat of CATEGORY_ORDER) {
    tips.forEach((tip, i) => {
      if (tip.category === cat) orderedTips.push({ tip, originalIndex: i });
    });
  }
  const hasTips = tips.length > 0;

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

  return (
    <div
      ref={scrollContainerRef}
      className="flex items-end gap-2 px-3 py-3 min-h-[96px] overflow-x-auto hide-scrollbar"
    >
      {/* Tip cards with thumbnails */}
      {hasTips && orderedTips.map(({ tip, originalIndex }) => {
        const isSelected = previewingIndex === originalIndex;
        const showCommit = isSelected && tip.previewStatus === 'done' && !!tip.previewImage;

        const handleCardClick = () => {
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
            className="flex-shrink-0 flex items-stretch animate-tip-in"
          >
            {/* Main tip card */}
            <button
              onClick={handleCardClick}
              disabled={isEditing}
              className={`w-[200px] text-left hover:brightness-110 active:scale-[0.97] disabled:opacity-40 border overflow-hidden ${
                isSelected
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
                      : 'rgba(239,68,68,0.12)',
              }}
            >
              <div className="flex">
                {/* Thumbnail */}
                <div className="w-[72px] h-[72px] flex-shrink-0 bg-white/5 relative overflow-hidden">
                  <TipThumbnail tip={tip} onRetryPreview={onRetryPreview} originalIndex={originalIndex} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0 px-2.5 py-2 flex flex-col justify-center">
                  <div className="text-white text-[13px] font-semibold leading-tight truncate">{tip.label}</div>
                  <div className="text-white/50 text-[11px] leading-snug mt-0.5 line-clamp-2">{tip.desc}</div>
                </div>
              </div>
            </button>

            {/* Commit button — slides out from right with width animation */}
            <div
              className="overflow-hidden flex-shrink-0"
              style={{
                width: showCommit ? 72 : 0,
                transition: 'width 0.2s ease-out',
              }}
            >
              <button
                onClick={() => onTipCommit?.(tip, originalIndex)}
                className="w-[72px] h-full flex flex-col items-center justify-center gap-1.5 rounded-r-2xl border border-l-0 border-fuchsia-500 active:scale-95 overflow-hidden relative group"
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
                  继续编辑
                </span>
              </button>
            </div>
          </div>
        );
      })}

      {/* Loading skeleton */}
      {!hasTips && isLoading && (
        <>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[200px] h-[72px] rounded-2xl bg-fuchsia-500/8 animate-pulse border border-fuchsia-500/10 flex"
            >
              <div className="w-[72px] h-full bg-white/5" />
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
    </div>
  );
}
