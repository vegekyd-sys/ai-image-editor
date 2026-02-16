'use client';

import { Tip } from '@/types';

interface TipsBarProps {
  tips: Tip[];
  isLoading: boolean;
  isEditing: boolean;
  onTipClick: (tip: Tip, index: number) => void;
  previewingIndex: number | null;
}

const CATEGORY_ORDER: Tip['category'][] = ['enhance', 'creative', 'wild'];

export default function TipsBar({ tips, isLoading, isEditing, onTipClick, previewingIndex }: TipsBarProps) {
  // Flatten tips in category order, tracking original indices
  const orderedTips: { tip: Tip; originalIndex: number }[] = [];
  for (const cat of CATEGORY_ORDER) {
    tips.forEach((tip, i) => {
      if (tip.category === cat) orderedTips.push({ tip, originalIndex: i });
    });
  }
  const hasTips = tips.length > 0;

  return (
    <div className="flex items-end gap-2 px-3 py-3 min-h-[96px] overflow-x-auto hide-scrollbar">
      {/* Tip cards with thumbnails */}
      {hasTips && orderedTips.map(({ tip, originalIndex }) => {
        const isSelected = previewingIndex === originalIndex;
        return (
          <button
            key={originalIndex}
            onClick={() => onTipClick(tip, originalIndex)}
            disabled={isEditing}
            className={`flex-shrink-0 w-[200px] rounded-2xl text-left hover:brightness-110 active:scale-[0.97] disabled:opacity-40 transition-all border overflow-hidden animate-tip-in ${
              isSelected
                ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50'
                : 'border-white/10'
            }`}
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
                    src={tip.previewImage}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : tip.previewStatus === 'generating' ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
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
