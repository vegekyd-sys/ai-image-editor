'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { AnnotationEntry } from '@/types';
import AnnotationCanvas from '@/components/AnnotationCanvas';
import { useLocale } from '@/lib/i18n';

const VIDEO_SENTINEL = '__VIDEO__';

// Compute image absolute rect within a container using object-contain semantics
function containRect(cW: number, cH: number, ar: number) {
  let w, h;
  if (ar > cW / cH) { w = cW; h = cW / ar; }
  else              { h = cH; w = cH * ar; }
  return { l: (cW - w) / 2, t: (cH - h) / 2, w, h };
}

interface ImageCanvasProps {
  timeline: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  isEditing: boolean;
  isDraft?: boolean;
  isDraftLoading?: boolean;
  draftTimelineIndex?: number;
  onDismissDraft?: () => void;
  previousImage?: string;
  onAnimate?: () => void;
  hasVideo?: boolean;
  isVideoEntry?: boolean;
  videoUrl?: string | null;
  videoProcessing?: boolean; // true when rendering but no videoUrl yet
  videoPosterImage?: string; // last snapshot image to show while processing
  isDesktop?: boolean;
  annotationMode?: boolean;
  annotationTool?: 'brush' | 'rect' | 'text';
  annotationEntries?: AnnotationEntry[];
  onAddAnnotationEntry?: (entry: AnnotationEntry) => void;
  onUpdateAnnotationEntry?: (id: string, data: Partial<AnnotationEntry['data']>) => void;
  onDeleteAnnotationEntry?: (id: string) => void;
  annotationColor?: string;
  annotationLineWidth?: number;
  onStartTextEdit?: (canvasX: number, canvasY: number) => void;
  textEditing?: { x: number; y: number; text: string; textColor: string; bgColor: string } | null;
}

export default function ImageCanvas({
  timeline, currentIndex, onIndexChange, isEditing,
  isDraft, isDraftLoading, draftTimelineIndex, onDismissDraft, previousImage, onAnimate,
  hasVideo, isVideoEntry, videoUrl, videoProcessing, videoPosterImage, isDesktop,
  annotationMode, annotationTool, annotationEntries, onAddAnnotationEntry,
  onUpdateAnnotationEntry, onDeleteAnnotationEntry,
  annotationColor, annotationLineWidth, onStartTextEdit, textEditing,
}: ImageCanvasProps) {
  const { t } = useLocale();
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

  // Annotation: image rect for overlay positioning
  const imgElRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageRect, setImageRect] = useState({ l: 0, t: 0, w: 0, h: 0 });
  const [naturalDims, setNaturalDims] = useState({ w: 0, h: 0 });

  // Reset zoom when entering annotation mode
  const [prevAnnotationMode, setPrevAnnotationMode] = useState(false);
  if (annotationMode && !prevAnnotationMode) {
    setPrevAnnotationMode(!!annotationMode);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  } else if (!!annotationMode !== prevAnnotationMode) {
    setPrevAnnotationMode(!!annotationMode);
  }

  // Image loading state
  const [imageLoaded, setImageLoaded] = useState(false);

  // Video playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBuffered, setVideoBuffered] = useState(0); // 0-1 progress
  const [videoError, setVideoError] = useState(false);
  const [prevVideoUrl, setPrevVideoUrl] = useState(videoUrl);
  if (prevVideoUrl !== videoUrl) {
    setPrevVideoUrl(videoUrl);
    setVideoError(false);
    if (videoPlaying) setVideoPlaying(false);
    if (videoLoading) setVideoLoading(false);
    if (videoBuffered !== 0) setVideoBuffered(0);
  }

  // Prevent click after handled touch gestures
  const skipClick = useRef(false);

  // Update imageRect when image loads or container resizes
  const updateImageRect = useCallback(() => {
    const img = imgElRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth) return;
    const cr = container.getBoundingClientRect();
    const ar = img.naturalWidth / img.naturalHeight;
    const rect = containRect(cr.width, cr.height, ar);
    setImageRect(rect);
    setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(updateImageRect);
    ro.observe(container);
    return () => ro.disconnect();
  }, [updateImageRect]);

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
    if (annotationMode) return;
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
  }, [timeline.length, scale, previousImage, clearLongPress, isVideoEntry, annotationMode]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (annotationMode) return;
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
  }, [scale, isComparing, clearLongPress, annotationMode]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (annotationMode) return;
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
  }, [currentIndex, timeline.length, onIndexChange, isComparing, clearLongPress, annotationMode]);

  const handleClick = useCallback(() => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (annotationMode) return;
    if (isDraft) onDismissDraft?.();
  }, [isDraft, onDismissDraft, annotationMode]);

  // Desktop: unified mouse handler — mirrors all touch interactions
  // (long-press compare + swipe navigate, same logic as touch handlers)
  const mouseStartPos = useRef<{ x: number; y: number } | null>(null);
  const mouseDidDrag = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (annotationMode || e.button !== 0 || isVideoEntry) { mouseStartPos.current = null; return; }
    mouseStartPos.current = { x: e.clientX, y: e.clientY };
    mouseDidDrag.current = false;

    // Long press → compare (same as touch)
    if (previousImage) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        setIsComparing(true);
      }, 200);
    }
  }, [previousImage, isVideoEntry, clearLongPress, annotationMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseStartPos.current) return;
    const dx = Math.abs(e.clientX - mouseStartPos.current.x);
    const dy = Math.abs(e.clientY - mouseStartPos.current.y);
    if (dx > 8 || dy > 8) {
      mouseDidDrag.current = true;
      clearLongPress();
      if (isComparing) setIsComparing(false);
    }
  }, [clearLongPress, isComparing]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    clearLongPress();
    if (isComparing) { setIsComparing(false); mouseStartPos.current = null; skipClick.current = true; return; }

    // Swipe detection (same threshold as touch: 40px horizontal, must exceed vertical)
    if (mouseStartPos.current && mouseDidDrag.current) {
      const deltaX = e.clientX - mouseStartPos.current.x;
      const deltaY = e.clientY - mouseStartPos.current.y;
      if (Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
        skipClick.current = true;
        if (deltaX < 0 && currentIndex < timeline.length - 1) {
          setAnimDir('left');
          setTimeout(() => { onIndexChange(currentIndex + 1); setAnimDir(null); }, 150);
        } else if (deltaX > 0 && currentIndex > 0) {
          setAnimDir('right');
          setTimeout(() => { onIndexChange(currentIndex - 1); setAnimDir(null); }, 150);
        }
      }
    }
    mouseStartPos.current = null;
  }, [clearLongPress, isComparing, currentIndex, timeline.length, onIndexChange]);

  // Desktop: trackpad pinch-to-zoom (ctrl+wheel) + horizontal swipe (deltaX) → switch snapshot
  const wheelCooldown = useRef(false);
  const handleWheel = useCallback((e: WheelEvent) => {
    // Pinch-to-zoom: trackpad pinch fires wheel with ctrlKey + deltaY
    if (e.ctrlKey && !isVideoEntry && !annotationMode) {
      e.preventDefault();
      const zoomFactor = 1 - e.deltaY * 0.01;
      setScale(prev => {
        const next = Math.min(5, Math.max(1, prev * zoomFactor));
        if (next <= 1.05) { setTranslate({ x: 0, y: 0 }); return 1; }
        return next;
      });
      return;
    }

    // Horizontal scroll (trackpad swipe) → switch snapshot
    if (Math.abs(e.deltaX) < 30 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    if (wheelCooldown.current) return;
    wheelCooldown.current = true;
    setTimeout(() => { wheelCooldown.current = false; }, 300);

    if (e.deltaX > 0 && currentIndex < timeline.length - 1) {
      setAnimDir('left');
      setTimeout(() => { onIndexChange(currentIndex + 1); setAnimDir(null); }, 150);
    } else if (e.deltaX < 0 && currentIndex > 0) {
      setAnimDir('right');
      setTimeout(() => { onIndexChange(currentIndex - 1); setAnimDir(null); }, 150);
    }
  }, [currentIndex, timeline.length, onIndexChange, isVideoEntry, annotationMode]);

  // Attach native wheel listener (non-passive) so preventDefault works for pinch-to-zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Desktop: keyboard left/right arrow keys → switch snapshot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setAnimDir('right');
        setTimeout(() => { onIndexChange(currentIndex - 1); setAnimDir(null); }, 150);
      } else if (e.key === 'ArrowRight' && currentIndex < timeline.length - 1) {
        setAnimDir('left');
        setTimeout(() => { onIndexChange(currentIndex + 1); setAnimDir(null); }, 150);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
  // When viewing __VIDEO__ sentinel with no videoUrl, fallback to last real snapshot
  const fallbackImage = baseImage === VIDEO_SENTINEL && !videoUrl
    ? timeline.slice(0, -1).filter(t => t !== VIDEO_SENTINEL).pop() ?? baseImage
    : baseImage;
  const displayImage = isComparing && previousImage ? previousImage : fallbackImage;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-center justify-center touch-none select-none"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseUp}
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
        {/* Grey placeholder while loading (skip for drafts — they show a low-res thumbnail instead) */}
        {!isVideoEntry && !imageLoaded && !isDraftLoading && (
          <div className="absolute inset-0 bg-zinc-900 animate-pulse" />
        )}

        {/* Draft loading shimmer: low-res thumbnail visible underneath, shimmer overlay on top */}
        {isDraftLoading && (
          <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
            <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
          </div>
        )}

        {/* Video entry */}
        {isVideoEntry && videoUrl ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              key={videoUrl}
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
              onError={() => setVideoError(true)}
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
            {/* Video error overlay */}
            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-6 py-4 text-center">
                  <p className="text-white/80 text-sm">{t('canvas.videoExpired')}</p>
                </div>
              </div>
            )}
            {/* Play button overlay */}
            {!videoPlaying && !videoLoading && !videoError && (
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
        ) : isVideoEntry && !videoUrl && videoProcessing && videoPosterImage ? (
          /* Video processing state: show last snapshot + overlay */
          <div className="relative w-full h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={videoPosterImage}
              alt="preview"
              className="w-full h-full object-contain select-none pointer-events-none"
              draggable={false}
            />
            {/* Dim overlay on the whole image */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.35)' }} />
            {/* Gradient + status overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 45%, transparent 100%)' }}
            >
              <div className="flex flex-col items-center gap-3" style={{ marginBottom: '15%' }}>
                {/* Spinning ring */}
                <div className="relative w-[72px] h-[72px] flex items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 72 72" fill="none">
                    <circle cx="36" cy="36" r="32" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
                    <circle cx="36" cy="36" r="32" stroke="url(#rg)" strokeWidth="3.5"
                      strokeLinecap="round" strokeDasharray="50 151"
                      style={{ animation: 'renderSpin 1.4s linear infinite', transformOrigin: '36px 36px' }}
                    />
                    <defs>
                      <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#d946ef" />
                        <stop offset="100%" stopColor="#818cf8" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" />
                    <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
                  </svg>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-white font-semibold tracking-wide" style={{ fontSize: '1rem' }}>{t('canvas.videoRendering')}</span>
                  <span className="text-white/40 text-[12px]">{t('canvas.usuallyTakes')}</span>
                </div>
              </div>
            </div>
            <style>{`@keyframes renderSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={imgElRef}
            src={displayImage}
            alt="preview"
            className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-150 ${
              animDir === 'left' ? 'opacity-0 -translate-x-8' :
              animDir === 'right' ? 'opacity-0 translate-x-8' :
              imageLoaded ? 'opacity-100 translate-x-0' : 'opacity-0'
            }`}
            draggable={false}
            onLoad={() => { setImageLoaded(true); updateImageRect(); }}
          />
        )}

        {/* Annotation overlay */}
        {annotationMode && !isVideoEntry && imageRect.w > 0 && onAddAnnotationEntry && (
          <AnnotationCanvas
            imageRect={imageRect}
            naturalWidth={naturalDims.w}
            naturalHeight={naturalDims.h}
            activeTool={annotationTool || 'brush'}
            entries={annotationEntries || []}
            onAddEntry={onAddAnnotationEntry}
            onUpdateEntry={onUpdateAnnotationEntry || (() => {})}
            onDeleteEntry={onDeleteAnnotationEntry || (() => {})}
            color={annotationColor || '#dc2626'}
            lineWidth={annotationLineWidth || Math.max(20, Math.round(naturalDims.w * 0.028))}
            onStartTextEdit={onStartTextEdit}
            textEditing={textEditing}
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
      {(timeline.length > 1 || onAnimate) && (
        <div className={`absolute left-1/2 -translate-x-1/2 flex items-center z-10 ${isDesktop ? 'bottom-3 gap-2' : 'bottom-20 gap-3'}`}>
          <div className={`flex items-center bg-black/50 backdrop-blur-sm rounded-full ${isDesktop ? 'gap-1 px-2 py-1' : 'gap-1.5 px-3 py-1.5'}`}>
            {timeline.map((entry, i) => {
              // Skip the video sentinel in dot rendering — it has its own dot below
              if (entry === VIDEO_SENTINEL) return null;
              return (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`rounded-full transition-all cursor-pointer ${
                    i === currentIndex
                      ? isDesktop ? 'w-3.5 h-1.5 bg-white' : 'w-5 h-2 bg-white'
                      : isDesktop ? 'w-1.5 h-1.5 bg-white/40' : 'w-2 h-2 bg-white/40'
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
                  } else if (onAnimate) {
                    onAnimate();
                  }
                }}
                title={t('canvas.generateVideo')}
                className={`ml-0.5 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isDesktop ? 'w-5 h-5' : 'ml-1 w-6 h-6'
                } ${
                  isVideoEntry
                    ? 'bg-fuchsia-500'
                    : 'bg-fuchsia-500/80 hover:bg-fuchsia-500'
                }`}
                style={{ flexShrink: 0 }}
              >
                <svg width={isDesktop ? "8" : "10"} height={isDesktop ? "8" : "10"} viewBox="0 0 10 10" fill="white">
                  <polygon points="3,2 8,5 3,8" />
                </svg>
              </button>
            )}
          </div>
          <span className={`text-white/80 font-medium bg-black/50 backdrop-blur-sm rounded-full whitespace-nowrap ${isDesktop ? 'text-[10px] px-2 py-1' : 'text-xs px-3 py-1.5'}`}>
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
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white flex items-center justify-center z-10 cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          {currentIndex < timeline.length - 1 && (
            <button
              onClick={() => goTo(currentIndex + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white flex items-center justify-center z-10 cursor-pointer"
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
