'use client';

import { Tip } from '@/types';
import { getThumbnailUrl } from '@/lib/supabase/storage';

interface TipsBarProps {
  tips: Tip[];
  isLoading: boolean;
  isEditing: boolean;
  onTipClick: (tip: Tip, index: number) => void;
  onRetryPreview?: (tip: Tip, index: number) => void;
  previewingIndex: number | null;
}

const CATEGORY_ORDER: Tip['category'][] = ['enhance', 'creative', 'wild'];

export default function TipsBar({ tips, isLoading, isEditing, onTipClick, onRetryPreview, previewingIndex }: TipsBarProps) {
  // Flatten tips in category order, tracking original indices
  const orderedTips: { tip: Tip; originalIndex: number }[] = [];
  for (const cat of CATEGORY_ORDER) {
    tips.forEach((tip, i) => {
      if (tip.category === cat) orderedTips.push({ tip, originalIndex: i });
    });
  }
  const hasTips = tips.length > 0;

  return (
    <div className="flex items-end gap-2 pl-3 pr-14 py-3 min-h-[96px] overflow-x-auto hide-scrollbar">
      {/* Tip cards with thumbnails */}
      {hasTips && orderedTips.map(({ tip, originalIndex }) => {
        const isSelected = previewingIndex === originalIndex;
        const showCommit = isSelected && tip.previewStatus === 'done' && !!tip.previewImage;
        return (
          <div key={originalIndex} className="flex-shrink-0 flex items-stretch gap-0 animate-tip-in">
            <button
              onClick={() => onTipClick(tip, originalIndex)}
              disabled={isEditing}
              className={`w-[200px] rounded-2xl text-left hover:brightness-110 active:scale-[0.97] disabled:opacity-40 transition-all border overflow-hidden ${
                isSelected
                  ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50'
                  : 'border-white/10'
              } ${showCommit ? 'rounded-r-none border-r-0' : ''}`}
              style={{
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
                  {tip.previewStatus === 'done' && tip.previewImage ? (
                    <img
                      src={tip.previewImage.startsWith('http') ? getThumbnailUrl(tip.previewImage, 150) : tip.previewImage}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : tip.previewStatus === 'generating' ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
                    </div>
                  ) : tip.previewStatus === 'error' ? (
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
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl opacity-50">
                      {tip.emoji}
                    </div>
                  )}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0 px-2.5 py-2 flex flex-col justify-center">
                  <div className="text-white text-[13px] font-semibold leading-tight truncate">{tip.label}</div>
                  <div className="text-white/50 text-[11px] leading-snug mt-0.5 line-clamp-2">{tip.desc}</div>
                </div>
              </div>
            </button>

            {/* Commit ">" button */}
            {showCommit && (
              <button
                onClick={() => onTipClick(tip, originalIndex)}
                className="w-[36px] flex flex-col items-center justify-center rounded-r-2xl border border-l-0 border-fuchsia-500 bg-fuchsia-500/20 text-fuchsia-300 hover:bg-fuchsia-500/30 active:scale-95 transition-all animate-glow"
              >
                <span className="text-lg font-bold leading-none">&gt;</span>
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
