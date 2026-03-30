'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { AnnotationEntry } from '@/types';
import AnnotationCanvas from '@/components/AnnotationCanvas';
import { containRect } from '@/lib/image/geometry';
import { useLocale } from '@/lib/i18n';

const VIDEO_SENTINEL = '__VIDEO__';

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
  pullDownActive?: boolean;
  onPullDown?: (dx: number, dy: number, progress: number) => void;
  onPullDownEnd?: (committed: boolean) => void;
  /** Increment to trigger video playback from external source (e.g. CUI second click) */
  videoPlayTrigger?: number;
}

export default function ImageCanvas({
  timeline, currentIndex, onIndexChange, isEditing,
  isDraft, isDraftLoading, draftTimelineIndex, onDismissDraft, previousImage, onAnimate,
  hasVideo, isVideoEntry, videoUrl, videoProcessing, videoPosterImage, isDesktop,
  annotationMode, annotationTool, annotationEntries, onAddAnnotationEntry,
  onUpdateAnnotationEntry, onDeleteAnnotationEntry,
  annotationColor, annotationLineWidth, onStartTextEdit, textEditing,
  pullDownActive, onPullDown, onPullDownEnd,
  videoPlayTrigger,
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

  // Image loading state
  const [imageLoaded, setImageLoaded] = useState(false);

  // Video playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBuffered, setVideoBuffered] = useState(0); // 0-1 progress
  const [videoError, setVideoError] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const videoPlayingRef = useRef(false);
  const [videoFrameLoadedUrl, setVideoFrameLoadedUrl] = useState<string | null>(null);
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const seekDragging = useRef(false);
  // Pull-down gesture (mobile only: free-drag like iOS Photos dismiss)
  const isPullDown = useRef(false);
  const pullDownStartX = useRef(0);
  const pullDownStartY = useRef(0);
  const PULL_ACTIVATE = 20;   // px vertical before activating
  const PULL_MAX = 300;        // px for progress=1
  const PULL_COMMIT = 0.3;     // release threshold

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

      // Pull-down gesture detection (mobile only, scale===1, not panning/pinching/video/draft/annotation/desktop)
      const rawDy = touch.clientY - touchStartY.current;
      const rawDx = Math.abs(touch.clientX - touchStartX.current);
      if (!isPullDown.current && !isPanning.current && !isPinching.current
        && !isVideoEntry && !isDesktop && !annotationMode
        && scale === 1 && onPullDown
        && rawDy > PULL_ACTIVATE && rawDy > rawDx * 2) {
        isPullDown.current = true;
        pullDownStartX.current = touchStartX.current;
        pullDownStartY.current = touchStartY.current + PULL_ACTIVATE;
        swiping.current = false;
      }
      if (isPullDown.current && onPullDown) {
        const dx = touch.clientX - pullDownStartX.current;
        const dy = touch.clientY - pullDownStartY.current;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const progress = Math.max(0, Math.min(1, dist / PULL_MAX));
        onPullDown(dx, dy, progress);
        return;
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
  }, [scale, isComparing, clearLongPress, annotationMode, isVideoEntry, isDraft, isDesktop, onPullDown]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (annotationMode) return;
    clearLongPress();

    // End pull-down gesture
    if (isPullDown.current) {
      const finalDx = e.changedTouches[0].clientX - pullDownStartX.current;
      const finalDy = e.changedTouches[0].clientY - pullDownStartY.current;
      const dist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
      const progress = Math.max(0, Math.min(1, dist / PULL_MAX));
      isPullDown.current = false;
      skipClick.current = true;
      onPullDownEnd?.(progress >= PULL_COMMIT);
      return;
    }

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
  }, [currentIndex, timeline.length, onIndexChange, isComparing, clearLongPress, annotationMode, onPullDownEnd]);

  const handleClick = useCallback(() => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (annotationMode) return;
    if (isDraft) onDismissDraft?.();
  }, [isDraft, onDismissDraft, annotationMode]);

  // Desktop: unified mouse handler — mirrors all touch interactions
  // (pan when zoomed, long-press compare, swipe navigate, double-click reset zoom)
  const mouseStartPos = useRef<{ x: number; y: number } | null>(null);
  const mouseDidDrag = useRef(false);
  const mousePanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastClickTime = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (annotationMode || e.button !== 0 || isVideoEntry) { mouseStartPos.current = null; return; }
    mouseStartPos.current = { x: e.clientX, y: e.clientY };
    mouseDidDrag.current = false;

    if (scale > 1) {
      // Pan mode when zoomed (same as touch)
      mousePanning.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    // Long press → compare (works at any zoom level, same as touch)
    if (previousImage) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        setIsComparing(true);
        mousePanning.current = false; // stop panning when comparing
      }, 200);
    }
  }, [previousImage, isVideoEntry, clearLongPress, annotationMode, scale]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseStartPos.current) return;
    const dx = Math.abs(e.clientX - mouseStartPos.current.x);
    const dy = Math.abs(e.clientY - mouseStartPos.current.y);

    if (dx > 8 || dy > 8) {
      mouseDidDrag.current = true;
      clearLongPress();
      if (isComparing) setIsComparing(false);
    }

    // Pan when zoomed (same as touch)
    if (mousePanning.current && scale > 1) {
      const panDx = e.clientX - lastMousePos.current.x;
      const panDy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      setTranslate(prev => ({
        x: prev.x + panDx / scale,
        y: prev.y + panDy / scale,
      }));
    }
  }, [clearLongPress, isComparing, scale]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    clearLongPress();
    if (isComparing) { setIsComparing(false); mouseStartPos.current = null; skipClick.current = true; return; }

    // End pan — only skip click if finger actually moved (same as touch)
    if (mousePanning.current) {
      mousePanning.current = false;
      const panDx = Math.abs(e.clientX - mouseStartPos.current!.x);
      const panDy = Math.abs(e.clientY - mouseStartPos.current!.y);
      if (panDx > 5 || panDy > 5) {
        skipClick.current = true;
        mouseStartPos.current = null;
        return;
      }
      // Barely moved — fall through to double-click check
    }

    // Double-click detection → reset zoom (same as touch double-tap)
    const now = Date.now();
    if (now - lastClickTime.current < 300) {
      lastClickTime.current = 0;
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      skipClick.current = true;
      mouseStartPos.current = null;
      return;
    }
    lastClickTime.current = now;

    // Swipe detection (same threshold as touch: 40px horizontal, must exceed vertical)
    if (mouseStartPos.current && mouseDidDrag.current && scale <= 1) {
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
  }, [clearLongPress, isComparing, currentIndex, timeline.length, onIndexChange, scale]);

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

  // Desktop: keyboard left/right arrow keys → switch snapshot (skip when focused on input/textarea)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
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

  // Video helpers
  function formatTime(s: number) {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  const resetControlsTimer = useCallback(() => {
    if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
    setShowControls(true);
    if (videoPlayingRef.current) {
      controlsHideTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, []);

  const doSeek = useCallback((clientX: number) => {
    const bar = seekBarRef.current;
    const v = videoRef.current;
    if (!bar || !v) return;
    const dur = v.duration;
    if (!dur || !isFinite(dur)) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * dur;
    setVideoCurrentTime(pct * dur);
  }, []);

  const videoFrameLoaded = videoFrameLoadedUrl === videoUrl;

  // External trigger to start video playback (e.g. second click in CUI)
  const prevPlayTrigger = useRef(videoPlayTrigger ?? 0);
  useEffect(() => {
    if (videoPlayTrigger && videoPlayTrigger !== prevPlayTrigger.current) {
      prevPlayTrigger.current = videoPlayTrigger;
      const v = videoRef.current;
      if (v && isVideoEntry && videoUrl) {
        v.play(); // onWaiting/onCanPlay handle loading state
      }
    }
  }, [videoPlayTrigger, isVideoEntry, videoUrl]);

  // Non-Supabase video URLs (Kling CDN etc.) are proxied to avoid CORS and expiry issues
  const effectiveVideoUrl = videoUrl && !videoUrl.includes('supabase.co')
    ? `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`
    : videoUrl;

  const getLabel = (index: number) => {
    // Video entry
    if (timeline[index] === VIDEO_SENTINEL) return 'Video';
    // isDraft=true means we're currently viewing the draft slot
    if (isDraft) return 'Draft';
    // 1-based index matching <<<image_N>>> convention
    const editNum = (draftTimelineIndex !== undefined && index > draftTimelineIndex)
      ? index
      : index + 1;
    return `@${editNum}`;
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
          <div
            className="relative w-full h-full flex items-center justify-center"
            onPointerMove={resetControlsTimer}
            onClick={(e) => {
              e.stopPropagation();
              if (!showControls) { resetControlsTimer(); return; }
              if (videoPlaying) { videoRef.current?.pause(); }
              else { setVideoLoading(true); videoRef.current?.play(); }
            }}
          >
            <video
              key={effectiveVideoUrl}
              ref={videoRef}
              src={effectiveVideoUrl ?? undefined}
              playsInline
              preload="metadata"
              className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-150 ${
                animDir === 'left' ? 'opacity-0 -translate-x-8' :
                animDir === 'right' ? 'opacity-0 translate-x-8' :
                'opacity-100 translate-x-0'
              }`}
              onPlay={() => {
                setVideoPlaying(true); setVideoLoading(false);
                videoPlayingRef.current = true;
                resetControlsTimer();
              }}
              onPause={() => {
                setVideoPlaying(false);
                videoPlayingRef.current = false;
                if (controlsHideTimer.current) { clearTimeout(controlsHideTimer.current); controlsHideTimer.current = null; }
                setShowControls(true);
              }}
              onEnded={() => {
                setVideoPlaying(false);
                videoPlayingRef.current = false;
                if (controlsHideTimer.current) { clearTimeout(controlsHideTimer.current); controlsHideTimer.current = null; }
                setShowControls(true);
              }}
              onWaiting={() => setVideoLoading(true)}
              onCanPlay={() => setVideoLoading(false)}
              onError={() => setVideoError(true)}
              onTimeUpdate={() => {
                const v = videoRef.current;
                if (v) setVideoCurrentTime(v.currentTime);
              }}
              onLoadedData={() => setVideoFrameLoadedUrl(videoUrl ?? null)}
              onLoadedMetadata={() => {
                const v = videoRef.current;
                if (v && isFinite(v.duration)) setVideoDuration(v.duration);
              }}
              onProgress={() => {
                const v = videoRef.current;
                if (v && v.buffered.length > 0 && v.duration) {
                  setVideoBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
                }
              }}
            />

            {/* Snapshot poster overlay — shown until video first frame loads */}
            {!videoFrameLoaded && !videoPlaying && (() => {
              const prev = timeline[timeline.length - 2];
              const posterSrc = prev && prev !== VIDEO_SENTINEL ? prev : undefined;
              return posterSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posterSrc}
                  alt=""
                  className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                />
              ) : null;
            })()}

            {/* Buffering spinner (mid-playback) */}
            {videoLoading && videoPlaying && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}

            {/* Video error overlay */}
            {videoError && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="bg-black/60 backdrop-blur-sm rounded-2xl px-6 py-4 text-center">
                  <p className="text-white/80 text-sm">{t('canvas.videoExpired')}</p>
                </div>
              </div>
            )}

            {/* Center play button (paused, controls visible, no error) */}
            {!videoPlaying && !videoLoading && !videoError && showControls && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 10 10" fill="white">
                    <polygon points="3,1 9,5 3,9" />
                  </svg>
                </div>
              </div>
            )}

            {/* Time badge — bottom-right, fades with controls */}
            {!videoError && (
              <div
                className={`absolute z-20 pointer-events-none transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
                style={{ bottom: 14, right: 10 }}
              >
                <span
                  className="tabular-nums rounded-md bg-black/35 backdrop-blur-sm select-none"
                  style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', padding: '2px 6px' }}
                >
                  {formatTime(videoCurrentTime)}<span style={{ opacity: 0.4, margin: '0 2px' }}>/</span>{formatTime(videoDuration)}
                </span>
              </div>
            )}

            {/* Seek bar — sits at canvas/tips boundary (bottom-0), always visible */}
            {!videoError && (
              <div
                ref={seekBarRef}
                className="absolute bottom-0 left-0 right-0 z-20 cursor-pointer"
                style={{ height: 20, touchAction: 'none' }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  seekDragging.current = true;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  doSeek(e.clientX);
                  resetControlsTimer();
                }}
                onPointerMove={(e) => {
                  if (!seekDragging.current) return;
                  doSeek(e.clientX);
                }}
                onPointerUp={(e) => {
                  seekDragging.current = false;
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* 2px visual track at very bottom */}
                <div className="absolute bottom-0 left-0 right-0" style={{ height: 2 }}>
                  <div className="absolute inset-0 bg-white/12" />
                  <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${videoBuffered * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-fuchsia-500/75" style={{ width: `${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%` }} />
                </div>
                {/* Subtle handle dot */}
                <div
                  className="absolute rounded-full bg-white/45"
                  style={{
                    width: 6, height: 6,
                    bottom: -2,
                    left: `${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%`,
                    transform: 'translateX(-50%)',
                  }}
                />
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
              pullDownActive ? 'opacity-[0.15] grayscale' :
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
            key={annotationTool || 'brush'}
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

      {/* Timeline indicators — bottom of canvas, capsule pill */}
      {(timeline.length > 1 || onAnimate) && (
        <div className={`absolute left-1/2 -translate-x-1/2 flex items-center justify-center z-10 ${isDesktop ? 'bottom-3' : 'bottom-3'}`}>
          <div className={`flex items-center rounded-full ${isDesktop ? 'gap-1.5 px-3 py-1.5' : 'gap-[5px] px-[10px] py-[5px]'}`}
            style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          >
            {timeline.map((entry, i) => (
              entry === VIDEO_SENTINEL ? (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`flex items-center justify-center cursor-pointer transition-all ${isDesktop ? 'w-5 h-5 hover:opacity-80' : 'w-3 h-3'}`}
                  style={{ color: i === currentIndex ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)' }}
                >
                  <svg width={isDesktop ? "11" : "8"} height={isDesktop ? "11" : "8"} viewBox="0 0 8 8" fill="currentColor">
                    <polygon points="2,1 7,4 2,7" />
                  </svg>
                </button>
              ) : (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`transition-all cursor-pointer ${
                    i === currentIndex
                      ? isDesktop ? 'w-5 h-2 rounded-full bg-white/70 hover:bg-white/90' : 'w-3 h-1 rounded-full bg-white/70'
                      : isDesktop ? 'w-2 h-2 rounded-full bg-white/25 hover:bg-white/40' : 'w-1 h-1 rounded-full bg-white/25'
                  }`}
                />
              )
            ))}
            <span className={`font-medium whitespace-nowrap ${isDesktop ? 'text-xs ml-2' : 'text-[10px] ml-1'}`}
              style={{ color: 'rgba(255,255,255,0.4)' }}
            >
              {getLabel(currentIndex)}
            </span>
          </div>
        </div>
      )}

    </div>
  );
}
