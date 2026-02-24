'use client';

import { useRef, useState, useCallback } from 'react';

const VIDEO_SENTINEL = '__VIDEO__';

interface ImageCanvasProps {
  timeline: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  isEditing: boolean;
  isDraft?: boolean;
  draftTimelineIndex?: number;
  onDismissDraft?: () => void;
  previousImage?: string;
  onAnimate?: () => void;
  hasVideo?: boolean;
  isVideoEntry?: boolean;
  videoUrl?: string | null;
}

export default function ImageCanvas({
  timeline, currentIndex, onIndexChange, isEditing,
  isDraft, draftTimelineIndex, onDismissDraft, previousImage, onAnimate,
  hasVideo, isVideoEntry, videoUrl,
}: ImageCanvasProps) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiping = useRef(false);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);

  // Zoom state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const isPinching = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);

  // Long press compare
  const [isComparing, setIsComparing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double tap
  const lastTapTime = useRef(0);

  // Image loading state
  const [imageLoaded, setImageLoaded] = useState(false);

  // Video playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBuffered, setVideoBuffered] = useState(0); // 0-1 progress

  // Prevent click after handled touch gestures
  const skipClick = useRef(false);

  const SWIPE_THRESHOLD = 40;

  // Reset zoom and loading state when image changes (derived state pattern per React docs)
  const [prevIdx, setPrevIdx] = useState(currentIndex);
  const [prevSrc, setPrevSrc] = useState('');
  const currentSrc = timeline[currentIndex] ?? '';
  if (prevIdx !== currentIndex || prevSrc !== currentSrc) {
    setPrevIdx(currentIndex);
    setPrevSrc(currentSrc);
    if (scale !== 1) setScale(1);
    if (translate.x !== 0 || translate.y !== 0) setTranslate({ x: 0, y: 0 });
    // Only reset loading if source actually changed (avoids flicker on re-render)
    if (prevSrc !== currentSrc) setImageLoaded(false);
    // Reset video state when navigating away
    if (videoPlaying) setVideoPlaying(false);
  }

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start — skip for video entry
      if (isVideoEntry) return;
      clearLongPress();
      isPinching.current = true;
      swiping.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
      return;
    }

    // Single touch
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;

    if (!isVideoEntry && scale > 1) {
      // Pan mode when zoomed (not for video)
      isPanning.current = true;
      lastPanPos.current = { x: touch.clientX, y: touch.clientY };
      swiping.current = false;
    } else if (timeline.length > 1) {
      // Swipe mode (available when multiple timeline entries exist)
      swiping.current = true;
    }

    // Long press detection — skip for video entry
    if (previousImage && !isVideoEntry) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        setIsComparing(true);
        swiping.current = false;
      }, 200);
    }
  }, [timeline.length, scale, previousImage, clearLongPress, isVideoEntry]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPinching.current) {
      // Pinch move
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / lastPinchDist.current;
      lastPinchDist.current = dist;
      setScale(prev => Math.min(5, Math.max(1, prev * ratio)));
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartX.current);
      const dy = Math.abs(touch.clientY - touchStartY.current);

      // Cancel long press if moved too much
      if (dx > 10 || dy > 10) {
        clearLongPress();
        if (isComparing) setIsComparing(false);
      }

      // Pan when zoomed
      if (isPanning.current && scale > 1) {
        const panDx = touch.clientX - lastPanPos.current.x;
        const panDy = touch.clientY - lastPanPos.current.y;
        lastPanPos.current = { x: touch.clientX, y: touch.clientY };
        setTranslate(prev => ({
          x: prev.x + panDx / scale,
          y: prev.y + panDy / scale,
        }));
      }
    }
  }, [scale, isComparing, clearLongPress]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    clearLongPress();

    // End comparing
    if (isComparing) {
      setIsComparing(false);
      skipClick.current = true;
      return;
    }

    // End pinch
    if (isPinching.current) {
      isPinching.current = false;
      skipClick.current = true;
      // Snap to 1x if barely zoomed
      setScale(prev => {
        if (prev < 1.1) {
          setTranslate({ x: 0, y: 0 });
          return 1;
        }
        return prev;
      });
      return;
    }

    // End pan — only skip double-tap if the finger actually moved
    if (isPanning.current) {
      isPanning.current = false;
      const panDx = Math.abs(e.changedTouches[0].clientX - touchStartX.current);
      const panDy = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
      if (panDx > 5 || panDy > 5) {
        skipClick.current = true;
        return;
      }
      // Finger barely moved — fall through to double-tap check
    }

    // Double tap detection
    const now = Date.now();
    if (now - lastTapTime.current < 300 && e.changedTouches.length === 1) {
      lastTapTime.current = 0;
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      swiping.current = false;
      skipClick.current = true;
      return;
    }
    lastTapTime.current = now;

    // Swipe logic (only when not zoomed)
    if (!swiping.current) return;
    swiping.current = false;

    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;

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
  }, [currentIndex, timeline.length, onIndexChange, isComparing, clearLongPress]);

  const handleClick = useCallback(() => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (isDraft) onDismissDraft?.();
  }, [isDraft, onDismissDraft]);

  const goTo = useCallback((index: number) => {
    if (index === currentIndex) return;
    setAnimDir(index > currentIndex ? 'left' : 'right');
    setTimeout(() => {
      onIndexChange(index);
      setAnimDir(null);
    }, 150);
  }, [currentIndex, onIndexChange]);

  const getLabel = (index: number) => {
    // Video entry
    if (timeline[index] === VIDEO_SENTINEL) return 'Video';
    if (index === 0) return 'Original';
    // isDraft=true means we're currently viewing the draft slot
    if (isDraft) return 'Draft';
    // Adjust edit number: snapshots after the draft slot have a +1 offset in timeline index
    const editNum = (draftTimelineIndex !== undefined && index > draftTimelineIndex)
      ? index - 1
      : index;
    return `Edit ${editNum}`;
  };

  const baseImage = timeline[currentIndex];
  const displayImage = isComparing && previousImage ? previousImage : baseImage;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center touch-none select-none"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      {isEditing && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl px-6 py-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-fuchsia-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-white text-sm font-medium">AI editing...</span>
          </div>
        </div>
      )}

      {/* Zoom wrapper */}
      <div
        className="w-full h-full"
        style={!isVideoEntry && scale > 1 ? {
          transform: `scale(${scale}) translate(${translate.x}px, ${translate.y}px)`,
          transformOrigin: 'center center',
        } : undefined}
      >
        {/* Grey placeholder while loading */}
        {!isVideoEntry && !imageLoaded && (
          <div className="absolute inset-0 bg-zinc-900 animate-pulse" />
        )}

        {/* Video entry */}
        {isVideoEntry && videoUrl ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              src={videoUrl}
              playsInline
              preload="auto"
              poster={(() => { const prev = timeline[timeline.length - 2]; return prev && prev !== '__VIDEO__' ? prev : undefined; })()}
              className={`w-full h-full object-contain select-none pointer-events-auto transition-all duration-150 ${
                animDir === 'left' ? 'opacity-0 -translate-x-8' :
                animDir === 'right' ? 'opacity-0 translate-x-8' :
                'opacity-100 translate-x-0'
              }`}
              onPlay={() => { setVideoPlaying(true); setVideoLoading(false); }}
              onPause={() => setVideoPlaying(false)}
              onEnded={() => setVideoPlaying(false)}
              onWaiting={() => setVideoLoading(true)}
              onCanPlay={() => setVideoLoading(false)}
              onProgress={() => {
                const v = videoRef.current;
                if (v && v.buffered.length > 0 && v.duration) {
                  setVideoBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (videoPlaying) {
                  videoRef.current?.pause();
                }
              }}
            />
            {/* Loading indicator — shows during buffering */}
            {videoLoading && (
              <div className="absolute bottom-0 left-0 right-0 z-10">
                <div style={{ height: 3, background: 'rgba(255,255,255,0.1)' }}>
                  <div style={{
                    height: '100%', background: 'rgba(217,70,239,0.8)',
                    width: `${Math.round(videoBuffered * 100)}%`,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            )}
            {/* Play button overlay */}
            {!videoPlaying && !videoLoading && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setVideoLoading(true);
                  videoRef.current?.play();
                }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center z-10 active:scale-95 transition-transform"
              >
                <svg width="22" height="22" viewBox="0 0 10 10" fill="white">
                  <polygon points="3,1 9,5 3,9" />
                </svg>
              </button>
            )}
            {/* Buffering spinner when loading during playback */}
            {videoLoading && videoPlaying && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>
        ) : (
          /* Image */
          <img
            src={displayImage}
            alt="preview"
            className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-150 ${
              animDir === 'left' ? 'opacity-0 -translate-x-8' :
              animDir === 'right' ? 'opacity-0 translate-x-8' :
              imageLoaded ? 'opacity-100 translate-x-0' : 'opacity-0'
            }`}
            draggable={false}
            onLoad={() => setImageLoaded(true)}
          />
        )}
      </div>

      {/* Before badge (long press compare) — not for video */}
      {isComparing && !isVideoEntry && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10">
          <span className="text-white text-xs font-medium bg-blue-600/80 backdrop-blur-sm rounded-full px-3 py-1.5">
            Before
          </span>
        </div>
      )}

      {/* Bottom indicators */}
      {timeline.length > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            {timeline.map((entry, i) => {
              // Skip the video sentinel in dot rendering — it has its own dot below
              if (entry === VIDEO_SENTINEL) return null;
              return (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`rounded-full transition-all ${
                    i === currentIndex
                      ? 'w-5 h-2 bg-white'
                      : 'w-2 h-2 bg-white/40'
                  }`}
                />
              );
            })}
            {/* Animate button — right side of timeline dots */}
            {onAnimate && !isDraft && (
              <button
                onClick={() => {
                  if (hasVideo) {
                    const videoIdx = timeline.indexOf(VIDEO_SENTINEL);
                    if (videoIdx >= 0) goTo(videoIdx);
                  } else {
                    onAnimate();
                  }
                }}
                title="生成视频"
                className={`ml-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                  isVideoEntry
                    ? 'bg-fuchsia-500'
                    : 'bg-fuchsia-500/80 hover:bg-fuchsia-500'
                }`}
                style={{ flexShrink: 0 }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="white">
                  <polygon points="3,2 8,5 3,8" />
                </svg>
              </button>
            )}
          </div>
          <span className="text-white/80 text-xs font-medium bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 whitespace-nowrap">
            {getLabel(currentIndex)}
          </span>
        </div>
      )}

      {/* Arrow buttons (desktop) */}
      {timeline.length > 1 && (
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
