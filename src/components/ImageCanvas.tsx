'use client';

import { useRef, useState, useCallback } from 'react';

interface ImageCanvasProps {
  timeline: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  isEditing: boolean;
  previewImage?: string;
  onDismissPreview?: () => void;
}

export default function ImageCanvas({ timeline, currentIndex, onIndexChange, isEditing, previewImage, onDismissPreview }: ImageCanvasProps) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiping = useRef(false);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);

  const SWIPE_THRESHOLD = 40;
  const isPreview = !!previewImage;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isPreview || timeline.length <= 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swiping.current = true;
  }, [timeline.length, isPreview]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swiping.current) return;
    swiping.current = false;

    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;

    // Only count horizontal swipes (ignore vertical scrolling)
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) return;

    if (deltaX < 0 && currentIndex < timeline.length - 1) {
      setAnimDir('left');
      setTimeout(() => {
        onIndexChange(currentIndex + 1);
        setAnimDir(null);
      }, 150);
    } else if (deltaX > 0 && currentIndex > 0) {
      setAnimDir('right');
      setTimeout(() => {
        onIndexChange(currentIndex - 1);
        setAnimDir(null);
      }, 150);
    }
  }, [currentIndex, timeline.length, onIndexChange]);

  const goTo = useCallback((index: number) => {
    if (index === currentIndex) return;
    setAnimDir(index > currentIndex ? 'left' : 'right');
    setTimeout(() => {
      onIndexChange(index);
      setAnimDir(null);
    }, 150);
  }, [currentIndex, onIndexChange]);

  const getLabel = (index: number) => {
    if (index === 0) return 'Original';
    return `Edit ${index}`;
  };

  const displayImage = previewImage || timeline[currentIndex];

  return (
    <div
      className="absolute inset-0 flex items-center justify-center touch-pan-y"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={isPreview ? onDismissPreview : undefined}
    >
      {isEditing && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl px-6 py-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-fuchsia-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-white text-sm font-medium">AI editing...</span>
          </div>
        </div>
      )}

      {/* Image */}
      <img
        src={displayImage}
        alt="preview"
        className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-150 ${
          animDir === 'left' ? 'opacity-0 -translate-x-8' :
          animDir === 'right' ? 'opacity-0 translate-x-8' :
          'opacity-100 translate-x-0'
        }`}
        draggable={false}
      />

      {/* Preview badge */}
      {isPreview && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10">
          <span className="text-white text-xs font-medium bg-fuchsia-600/80 backdrop-blur-sm rounded-full px-3 py-1.5">
            Preview
          </span>
        </div>
      )}

      {/* Bottom indicators */}
      {timeline.length > 1 && !isPreview && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            {timeline.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all ${
                  i === currentIndex
                    ? 'w-5 h-2 bg-white'
                    : 'w-2 h-2 bg-white/40'
                }`}
              />
            ))}
          </div>
          <span className="text-white/80 text-xs font-medium bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 whitespace-nowrap">
            {getLabel(currentIndex)}
          </span>
        </div>
      )}

      {/* Arrow buttons (desktop) */}
      {timeline.length > 1 && !isPreview && (
        <>
          {currentIndex > 0 && (
            <button
              onClick={() => goTo(currentIndex - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white flex items-center justify-center z-10"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          {currentIndex < timeline.length - 1 && (
            <button
              onClick={() => goTo(currentIndex + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white flex items-center justify-center z-10"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}
