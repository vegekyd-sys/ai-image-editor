'use client';

import { Tip } from '@/types';

interface TipsBarProps {
  tips: Tip[];
  isLoading: boolean;
  isEditing: boolean;
  onTipClick: (tip: Tip) => void;
}

const CATEGORY_ORDER: Tip['category'][] = ['enhance', 'creative', 'wild'];

export default function TipsBar({ tips, isLoading, isEditing, onTipClick }: TipsBarProps) {
  const grouped = CATEGORY_ORDER.map((cat) => tips.filter((t) => t.category === cat)).filter((g) => g.length > 0);
  const hasTips = tips.length > 0;

  return (
    <div className="flex items-end gap-2 px-3 py-3 overflow-x-auto hide-scrollbar">
      {/* Tip cards */}
      {hasTips && grouped.map((group, gi) => (
        group.map((tip, ti) => (
          <button
            key={`${gi}-${ti}`}
            onClick={() => onTipClick(tip)}
            disabled={isEditing}
            className="flex-shrink-0 max-w-[180px] px-3.5 py-2.5 rounded-2xl text-left hover:brightness-125 active:scale-95 disabled:opacity-40 transition-all border border-white/10 animate-tip-in"
            style={{
              background:
                tip.category === 'enhance'
                  ? 'rgba(217,70,239,0.06)'
                  : tip.category === 'creative'
                    ? 'rgba(217,70,239,0.12)'
                    : 'rgba(239,68,68,0.12)',
            }}
          >
            <div className="text-base leading-none mb-1">{tip.emoji}</div>
            <div className="text-white text-[13px] font-semibold leading-tight">{tip.label}</div>
            <div className="text-white/55 text-[11px] leading-snug mt-0.5 line-clamp-2">{tip.desc}</div>
          </button>
        ))
      ))}

      {/* Loading skeleton */}
      {!hasTips && isLoading && (
        <>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[160px] h-[72px] rounded-2xl bg-fuchsia-500/8 animate-pulse border border-fuchsia-500/10"
            />
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
