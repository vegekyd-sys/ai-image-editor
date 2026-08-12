'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { PlayerRef } from '@remotion/player';
import type { AnnotationEntry, DesignPayload, EditableField } from '@/types';
import AnnotationCanvas from '@/components/AnnotationCanvas';
import DesignOverlay from '@/components/DesignOverlay';
import { containRect } from '@/lib/image/geometry';
import { useLocale } from '@/lib/i18n';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import { getVideoTrimPropKeys } from '@/lib/editor/video-trim';
import {
  compositionFrameToSourceFrame,
  deriveSequenceStartFrame,
  sourceFrameToCompositionFrame,
} from '@/lib/editor/video-trim-timeline';
import { isFastVideoRenderModel } from '@/lib/video-model-capabilities';
import { isRemotionExportTaskId } from '@/lib/remotion-export-flags';
import {
  buildLegacySceneRegistry,
  findSceneMediaElement,
} from '@/lib/editor/scene-registry';

const RemotionRenderer = dynamic(() => import('@/components/RemotionRenderer'), { ssr: false });

const VIDEO_SENTINEL = '__VIDEO__';

function isSimpleVideoWrapper(code: string): boolean {
  if (!/<(?:Video|OffthreadVideo)\s/.test(code)) return false;
  if (/<Img\s/.test(code) || /<Audio\s/.test(code) || /<Text[\s>]/.test(code)) return false;
  if (/trimBefore|trimAfter|startFrom|endAt/.test(code)) return false;
  if ((code.match(/<Sequence[\s>]/g) || []).length > 1) return false;
  return true;
}

interface ImageCanvasProps {
  projectId?: string;
  designSnapshotId?: string;
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
  videoFailed?: boolean;
  videoTaskId?: string | null;
  videoModel?: string | null;
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
  /** Start time (seconds) for video playback — synced from CUI inline player */
  videoStartTime?: number;
  /** Non-destructive external source interval represented by this Media List item. */
  videoClipStart?: number;
  videoClipEnd?: number;
  /** Number of reference snapshots at the start of the timeline */
  referenceCount?: number;
  /** Map of timeline index → DesignPayload for animated designs (rendered via Player) */
  animatedDesigns?: Map<number, DesignPayload>;
  /** Draft design from Agent — shown in canvas as preview, not committed to timeline */
  draftDesign?: DesignPayload | null;
  /** Editable fields declared by the Agent for the current design */
  editableFields?: EditableField[];
  /** Current design props for editable field values */
  designProps?: Record<string, unknown>;
  /** Currently selected editable field ID (bidirectional with DesignEditPanel) */
  selectedEditableId?: string | null;
  /** Callback when an editable field is selected/deselected in the canvas overlay */
  onSelectEditable?: (id: string | null) => void;
  /** Callback when a design prop is updated via canvas interaction */
  onUpdateProp?: (key: string, value: unknown) => void;
  /** Callback when user double-clicks (select then click again) an editable to start editing */
  onStartEditEditable?: (fieldId: string) => void;
  /** Callback with list of editable field IDs visible at the current frame */
  onVisibleEditableFields?: (visibleIds: string[]) => void;
  /** Browser-measured rendered design size, used to expand under-sized static designs */
  onDesignContentSize?: (size: { width: number; height: number; source: 'editables' | 'scroll' }) => void;
  /** Video editable currently opened in the trim editor. */
  activeTrimFieldId?: string | null;
  /** Hide canvas playback controls while a text/trim editor covers the canvas edge. */
  hidePlaybackControls?: boolean;
  /** Timeline indices that are video snapshots (v2) — show play icon instead of dot */
  videoTimelineIndices?: Set<number>;
  /** Called once when the video element loads data — captures a poster frame at 0.5s */
  onVideoPosterCapture?: (dataUrl: string) => void;
  /** Called as the current video playback position changes. */
  onVideoTimeUpdate?: (time: number, duration: number) => void;
  /** Incrementing token from parent to request a current-frame capture. */
  videoFrameCaptureRequest?: number;
  /** Called after the current video frame is captured from the playing element. */
  onVideoFrameCaptured?: (dataUrl: string, time: number, duration: number) => void;
}

export default function ImageCanvas({
  projectId,
  designSnapshotId,
  timeline, currentIndex, onIndexChange, isEditing,
  isDraft, isDraftLoading, draftTimelineIndex, onDismissDraft, previousImage, onAnimate,
  isVideoEntry, videoUrl, videoProcessing, videoFailed, videoTaskId, videoModel, videoPosterImage, isDesktop,
  annotationMode, annotationTool, annotationEntries, onAddAnnotationEntry,
  onUpdateAnnotationEntry, onDeleteAnnotationEntry,
  annotationColor, annotationLineWidth, onStartTextEdit, textEditing,
  pullDownActive, onPullDown, onPullDownEnd,
  videoPlayTrigger,
  videoStartTime,
  videoClipStart,
  videoClipEnd,
  referenceCount = 0,
  animatedDesigns,
  draftDesign,
  editableFields,
  designProps,
  selectedEditableId,
  onSelectEditable,
  onUpdateProp,
  onStartEditEditable,
  onVisibleEditableFields,
  onDesignContentSize,
  activeTrimFieldId,
  hidePlaybackControls = false,
  videoTimelineIndices,
  onVideoPosterCapture,
  onVideoTimeUpdate,
  videoFrameCaptureRequest,
  onVideoFrameCaptured,
}: ImageCanvasProps) {
  const { t } = useLocale();
  const videoRenderTimeHint = isRemotionExportTaskId(videoTaskId)
    ? t('canvas.remotionExportUsuallyTakes')
    : (isFastVideoRenderModel(videoModel)
      ? t('canvas.grokUsuallyTakes')
      : t('canvas.usuallyTakes'));
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

  // Design overlay refs (for editable designs)
  const [designContainerEl, setDesignContainerEl] = useState<HTMLDivElement | null>(null);
  const [designInteractionEl, setDesignInteractionEl] = useState<HTMLDivElement | null>(null);

  const [designPlayerRef, setDesignPlayerRef] = useState<any>(null);

  // When an editable is selected: pause player
  useEffect(() => {
    if (!selectedEditableId || !designPlayerRef) return;
    try { designPlayerRef.pause(); } catch { /* ignore */ }
    setRemotionPlaying(false);
  }, [selectedEditableId, designPlayerRef]);

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
  const [imageLoaded, setImageLoaded] = useState(true);

  const activeDraftDesign = isDraft ? draftDesign : null;
  const timelineDesign = animatedDesigns?.get(currentIndex) || null;
  const currentDesign = activeDraftDesign || timelineDesign;

  // Long content: height/width > 2.5 — disables zoom, enables scroll
  const isLongContent = (() => {
    const design = currentDesign;
    if (design) return design.height / design.width > 2.5;
    if (naturalDims.w && naturalDims.h) return naturalDims.h / naturalDims.w > 2.5;
    return false;
  })();
  const longScrollRef = useRef<HTMLDivElement>(null);
  const handleDesignInteractionRef = useCallback((el: HTMLDivElement | null) => {
    longScrollRef.current = el;
    setDesignInteractionEl(el);
  }, []);

  // Video playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBuffered, setVideoBuffered] = useState(0); // 0-1 progress
  const [videoError, setVideoError] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  // Remotion Player custom controls — frame tracked via ref (no re-render during playback)
  const remotionRef = useRef<PlayerRef | null>(null);
  const [remotionPlayer, setRemotionPlayer] = useState<PlayerRef | null>(null);
  const [remotionPlaying, setRemotionPlaying] = useState(false);
  const remotionFrameRef = useRef(0);
  const remotionStartedRef = useRef(false); // true after first play — poster hides, Player shows
  const pendingRemotionPlayRef = useRef(false);
  const [remotionLoading, setRemotionLoading] = useState(false); // true while RemotionRenderer is initializing (fetching images/fonts/audio)
  const [showControls, setShowControls] = useState(true);
  const videoPlayingRef = useRef(false);
  const [videoFrameLoadedUrl, setVideoFrameLoadedUrl] = useState<string | null>(null);
  const lastCaptureRequestRef = useRef<number | undefined>(videoFrameCaptureRequest);
  const [frameCaptureFeedback, setFrameCaptureFeedback] = useState(false);
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const seekDragging = useRef(false);
  const [isSeeking, setIsSeeking] = useState(false);
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

  useEffect(() => {
    if (videoFrameCaptureRequest === undefined) return;
    if (lastCaptureRequestRef.current === undefined) {
      lastCaptureRequestRef.current = videoFrameCaptureRequest;
      return;
    }
    if (lastCaptureRequestRef.current === videoFrameCaptureRequest) return;
    lastCaptureRequestRef.current = videoFrameCaptureRequest;
    setFrameCaptureFeedback(true);

    const video = videoRef.current;
    if (!video) {
      window.setTimeout(() => setFrameCaptureFeedback(false), 760);
      return;
    }
    try {
      video.pause();
      const canvas = document.createElement('canvas');
      const videoWidth = video.videoWidth || naturalDims.w || 1280;
      const videoHeight = video.videoHeight || naturalDims.h || 720;
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        window.setTimeout(() => setFrameCaptureFeedback(false), 760);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const sourceStart = Number.isFinite(videoClipStart) ? Math.max(0, videoClipStart || 0) : 0;
      const sourceEnd = Number.isFinite(videoClipEnd) && (videoClipEnd || 0) > sourceStart
        ? Number(videoClipEnd)
        : undefined;
      const capturedTime = Math.max(0, video.currentTime - sourceStart);
      const sourceDuration = Number.isFinite(video.duration) ? video.duration : sourceStart + videoDuration;
      const capturedDuration = Math.max(0, Math.min(sourceDuration, sourceEnd ?? sourceDuration) - sourceStart);
      setFrameCaptureFeedback(true);
      window.setTimeout(() => {
        setFrameCaptureFeedback(false);
        onVideoFrameCaptured?.(dataUrl, capturedTime, capturedDuration);
      }, 760);
    } catch (e) {
      console.warn('[ImageCanvas] current video frame capture failed:', e);
      setFrameCaptureFeedback(false);
    }
  }, [videoFrameCaptureRequest, onVideoFrameCaptured, videoDuration, videoClipStart, videoClipEnd, naturalDims.w, naturalDims.h]);

  const SWIPE_THRESHOLD = 40;

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (annotationMode) return;
    if (selectedEditableId) return; // Design Editor mode — all canvas gestures disabled
    if (e.touches.length === 2) {
      // Pinch start — skip for video entry and long content
      if (isVideoEntry || isLongContent) return;
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

    // Long press detection — skip for video entry and animated designs
    const hasAnimation = !!currentDesign?.animation;
    if (previousImage && !isVideoEntry && !hasAnimation) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        setIsComparing(true);
        swiping.current = false;
      }, 200);
    }
  }, [timeline.length, scale, previousImage, clearLongPress, isVideoEntry, annotationMode, currentIndex, currentDesign, selectedEditableId]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (annotationMode) return;
    if (selectedEditableId) return;
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
        && !isDesktop && !annotationMode && !selectedEditableId
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
  }, [scale, isComparing, clearLongPress, annotationMode, isVideoEntry, isDraft, isDesktop, onPullDown, selectedEditableId]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (annotationMode) return;
    if (selectedEditableId) return;
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
  }, [currentIndex, timeline.length, onIndexChange, isComparing, clearLongPress, annotationMode, onPullDownEnd, selectedEditableId]);

  const handleClick = useCallback(() => {
    if (selectedEditableId) return; // Design Editor mode — handled by design container onClick
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (annotationMode) return;
    // Dismiss tips drafts on click, but NOT design drafts (design can't be recovered)
    if (isDraft && !draftDesign) onDismissDraft?.();
  }, [isDraft, onDismissDraft, annotationMode, selectedEditableId]);

  // Desktop: unified mouse handler — mirrors all touch interactions
  // (pan when zoomed, long-press compare, swipe navigate, double-click reset zoom)
  const mouseStartPos = useRef<{ x: number; y: number } | null>(null);
  const mouseDidDrag = useRef(false);
  const mousePanning = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastClickTime = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (selectedEditableId) return;
    if (annotationMode || e.button !== 0 || isVideoEntry) { mouseStartPos.current = null; return; }
    mouseStartPos.current = { x: e.clientX, y: e.clientY };
    mouseDidDrag.current = false;

    if (scale > 1 || isLongContent) {
      // Pan mode when zoomed or long content scroll
      mousePanning.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    // Long press → compare (works at any zoom level, same as touch) — skip for animated designs
    const hasAnimationMouse = !!currentDesign?.animation;
    if (previousImage && !hasAnimationMouse) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        setIsComparing(true);
        mousePanning.current = false; // stop panning when comparing
      }, 200);
    }
  }, [previousImage, isVideoEntry, clearLongPress, annotationMode, scale, currentIndex, currentDesign, selectedEditableId]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (selectedEditableId) return;
    if (!mouseStartPos.current) return;
    const dx = Math.abs(e.clientX - mouseStartPos.current.x);
    const dy = Math.abs(e.clientY - mouseStartPos.current.y);

    if (dx > 8 || dy > 8) {
      mouseDidDrag.current = true;
      clearLongPress();
      if (isComparing) setIsComparing(false);
    }

    // Pan when zoomed, or scroll for long content
    if (mousePanning.current && (scale > 1 || isLongContent)) {
      const panDx = e.clientX - lastMousePos.current.x;
      const panDy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      if (isLongContent && longScrollRef.current) {
        longScrollRef.current.scrollTop -= panDy;
      } else {
        setTranslate(prev => ({
          x: prev.x + panDx / scale,
          y: prev.y + panDy / scale,
        }));
      }
    }
  }, [clearLongPress, isComparing, scale, isLongContent, selectedEditableId]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (selectedEditableId) return;
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
  }, [clearLongPress, isComparing, currentIndex, timeline.length, onIndexChange, scale, selectedEditableId]);

  // Desktop: zoom (ctrl+wheel / plain wheel) + horizontal swipe (deltaX) → switch snapshot
  const wheelCooldown = useRef(false);
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isVideoEntry || annotationMode) return;

    // Long content: wheel scrolls vertically instead of zooming
    if (isLongContent) {
      if (longScrollRef.current) {
        longScrollRef.current.scrollTop += e.deltaY;
        e.preventDefault();
      }
      return;
    }

    // Zoom: trackpad pinch (ctrlKey+deltaY) or plain mouse wheel (deltaY, no deltaX)
    const isTrackpadPinch = e.ctrlKey;
    const isMouseWheel = !e.ctrlKey && Math.abs(e.deltaY) > 0 && Math.abs(e.deltaX) < 5;
    if (isTrackpadPinch || isMouseWheel) {
      e.preventDefault();
      const speed = isTrackpadPinch ? 0.01 : 0.003;
      const zoomFactor = 1 - e.deltaY * speed;
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
  }, [currentIndex, timeline.length, onIndexChange, isVideoEntry, annotationMode, isLongContent]);

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

  const clipStart = Number.isFinite(videoClipStart) ? Math.max(0, videoClipStart || 0) : 0;
  const clipEnd = Number.isFinite(videoClipEnd) && (videoClipEnd || 0) > clipStart
    ? videoClipEnd
    : undefined;
  const clipDurationFor = useCallback((sourceDuration: number) => {
    const boundedEnd = clipEnd === undefined ? sourceDuration : Math.min(sourceDuration, clipEnd);
    return Math.max(0, boundedEnd - clipStart);
  }, [clipEnd, clipStart]);

  const playVideoInRange = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const boundedEnd = clipEnd === undefined ? video.duration : Math.min(video.duration || clipEnd, clipEnd);
    if (!Number.isFinite(video.currentTime) || video.currentTime < clipStart || video.currentTime >= boundedEnd - 0.01) {
      video.currentTime = clipStart;
    }
    video.muted = false;
    setVideoLoading(true);
    video.play().catch(() => {});
  }, [clipEnd, clipStart]);

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
    const dur = clipDurationFor(v.duration);
    if (!dur || !isFinite(dur)) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = clipStart + pct * dur;
    setVideoCurrentTime(pct * dur);
  }, [clipDurationFor, clipStart]);

  const videoFrameLoaded = videoFrameLoadedUrl === videoUrl;

  // External trigger to start video playback (e.g. CUI inline video tap)
  const prevPlayTrigger = useRef(videoPlayTrigger ?? 0);
  useEffect(() => {
    if (videoPlayTrigger && videoPlayTrigger !== prevPlayTrigger.current) {
      prevPlayTrigger.current = videoPlayTrigger;
      const v = videoRef.current;
      if (v && isVideoEntry && videoUrl) {
        if (videoStartTime) v.currentTime = Math.max(clipStart, videoStartTime);
        playVideoInRange();
      }
    }
  }, [videoPlayTrigger, isVideoEntry, videoUrl, videoStartTime, clipStart, playVideoInRange]);

  // Remotion Player: poll current frame for custom seek bar.
  // Draft design only takes priority while the virtual draft slot is selected.
  const remotionFps = currentDesign?.animation?.fps || 30;
  const remotionDuration = currentDesign?.animation?.durationInSeconds || 0;
  const remotionTotalFrames = Math.max(1, Math.round(remotionFps * remotionDuration));
  const activeTrimStartFrameRef = useRef(0);
  if (!activeTrimFieldId || !editableFields || !designProps) {
    activeTrimStartFrameRef.current = 0;
  } else {
    const activeField = editableFields.find(f => f.id === activeTrimFieldId && f.type === 'video');
    const { startKey } = activeField ? getVideoTrimPropKeys(activeField) : { startKey: undefined };
    const raw = startKey ? designProps[startKey] : 0;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    activeTrimStartFrameRef.current = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }
  const getActiveTrimStartFrame = useCallback(() => {
    return activeTrimStartFrameRef.current;
  }, []);
  const activeTrimContextRef = useRef<{
    fieldId: string;
    sequenceStartFrame: number;
  } | null>(null);

  useEffect(() => {
    activeTrimContextRef.current = null;
    if (!activeTrimFieldId || !designContainerEl) return;

    let raf = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let observedVideo: HTMLVideoElement | null = null;

    const resolveContext = () => {
      const activeField = editableFields?.find(
        field => field.id === activeTrimFieldId && field.type === 'video',
      );
      if (!activeField) return false;
      const canvasElement = designContainerEl.querySelector<HTMLElement>('.__remotion-player');
      const canvasRect = (
        canvasElement ?? designContainerEl
      ).getBoundingClientRect();
      const editableEl = buildLegacySceneRegistry({
        container: designContainerEl,
        fields: editableFields ?? [],
        canvasRect,
      }).get(activeTrimFieldId)?.activeInstance?.element;
      const video = editableEl
        ? findSceneMediaElement(editableEl, 'video') as HTMLVideoElement | null
        : null;
      if (!video) return false;
      observedVideo = video;

      if (Number.isFinite(video.duration) && video.duration > 0) {
        window.dispatchEvent(new CustomEvent('makaron:design-trim-source-metadata', {
          detail: {
            fieldId: activeTrimFieldId,
            durationSeconds: video.duration,
          },
        }));
      }

      if (!Number.isFinite(video.currentTime)) return false;
      const compositionFrame = remotionRef.current?.getCurrentFrame() ?? remotionFrameRef.current;
      const trimStartFrame = getActiveTrimStartFrame();
      activeTrimContextRef.current = {
        fieldId: activeTrimFieldId,
        sequenceStartFrame: deriveSequenceStartFrame({
          compositionFrame,
          sourceTimeSeconds: video.currentTime,
          trimStartFrame,
          fps: remotionFps,
        }),
      };
      return true;
    };

    const onMetadata = () => resolveContext();
    raf = requestAnimationFrame(() => {
      if (!resolveContext()) {
        retryTimer = setTimeout(resolveContext, 250);
      }
      observedVideo?.addEventListener('loadedmetadata', onMetadata);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (retryTimer) clearTimeout(retryTimer);
      observedVideo?.removeEventListener('loadedmetadata', onMetadata);
      activeTrimContextRef.current = null;
    };
  }, [
    activeTrimFieldId,
    designContainerEl,
    editableFields,
    getActiveTrimStartFrame,
    remotionFps,
    currentDesign?.code,
  ]);

  const dispatchActiveTrimPlayhead = useCallback((playing?: boolean) => {
    if (!activeTrimFieldId) return;
    const compositionFrame = remotionRef.current?.getCurrentFrame() ?? remotionFrameRef.current;
    const context = activeTrimContextRef.current;
    const sourceFrame = context?.fieldId === activeTrimFieldId
      ? compositionFrameToSourceFrame({
          compositionFrame,
          trimStartFrame: getActiveTrimStartFrame(),
          sequenceStartFrame: context.sequenceStartFrame,
        })
      : compositionFrame + getActiveTrimStartFrame();
    window.dispatchEvent(new CustomEvent('makaron:design-trim-playhead', {
      detail: { sourceFrame },
    }));
    if (playing !== undefined) {
      window.dispatchEvent(new CustomEvent('makaron:design-trim-playback', {
        detail: { playing },
      }));
    }
  }, [activeTrimFieldId, getActiveTrimStartFrame]);

  // Update seek bar + time badge via DOM (no React re-render during playback)
  const updateRemotionUI = useCallback(() => {
    const frame = remotionRef.current?.getCurrentFrame() ?? 0;
    remotionFrameRef.current = frame;
    const progress = remotionTotalFrames > 1 ? frame / (remotionTotalFrames - 1) : 0;
    // Direct DOM updates — zero re-renders
    const fill = document.querySelector('[data-remotion-fill]') as HTMLElement;
    if (fill) fill.style.width = `${progress * 100}%`;
    const time = document.querySelector('[data-remotion-time]');
    if (time) {
      const cur = frame / remotionFps;
      time.textContent = `${formatTime(cur)} / ${formatTime(remotionDuration)}`;
    }
  }, [remotionTotalFrames, remotionFps, remotionDuration]);

  useEffect(() => {
    const player = remotionPlayer;
    if (!player || !currentDesign?.animation) return;

    const syncPlaying = () => setRemotionPlaying(player.isPlaying());
    const syncFrame = () => updateRemotionUI();
    const onEnded = () => {
      setRemotionPlaying(false);
      updateRemotionUI();
    };

    setRemotionPlaying(player.isPlaying());
    updateRemotionUI();
    player.addEventListener('play', syncPlaying);
    player.addEventListener('pause', syncPlaying);
    player.addEventListener('ended', onEnded);
    player.addEventListener('frameupdate', syncFrame);
    player.addEventListener('timeupdate', syncFrame);
    return () => {
      player.removeEventListener('play', syncPlaying);
      player.removeEventListener('pause', syncPlaying);
      player.removeEventListener('ended', onEnded);
      player.removeEventListener('frameupdate', syncFrame);
      player.removeEventListener('timeupdate', syncFrame);
    };
  }, [remotionPlayer, currentDesign?.animation, currentDesign?.code, updateRemotionUI]);

  // RAF loop during playback — lightweight, no state updates
  useEffect(() => {
    if (!remotionPlaying || !remotionRef.current) return;
    let raf = 0;
    const tick = () => {
      updateRemotionUI();
      dispatchActiveTrimPlayhead(true);
      // Detect end
      if (remotionFrameRef.current >= remotionTotalFrames - 1) {
        setRemotionPlaying(false);
        remotionRef.current?.pause();
        dispatchActiveTrimPlayhead(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dispatchActiveTrimPlayhead, remotionPlaying, remotionTotalFrames, updateRemotionUI]);

  const [remotionBuffering, setRemotionBuffering] = useState(false);
  const remotionBufferingRef = useRef(false);

  // Reset when switching to a design snapshot. Remotion compositions should only
  // start from an explicit user click; auto-play during code generation is noisy.
  useEffect(() => {
    const player = remotionRef.current;
    player?.pause();
    setRemotionPlaying(false);
    remotionBufferingRef.current = false;
    setRemotionBuffering(false);
    setRemotionLoading(!!currentDesign?.animation);
    remotionFrameRef.current = 0;
    remotionStartedRef.current = false;
    pendingRemotionPlayRef.current = false;
    updateRemotionUI();
    return () => player?.pause();

  }, [currentIndex, currentDesign?.code]);

  // Mirror buffering so the custom play button can show progress.
  // Remotion owns pause/resume internally through Html5Video's
  // pauseWhenBuffering contract. We only mirror its waiting/resume events;
  // explicitly pausing here would prevent Remotion from resuming after recovery.
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const player = remotionPlayer;
    if (!player) return;
    const onWaiting = () => {
      if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
      remotionBufferingRef.current = true;
      setRemotionBuffering(true);
    };
    const onResume = () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        remotionBufferingRef.current = false;
        setRemotionBuffering(false);
      }, 150);
    };
    const onFrameUpdate = () => {
      if (!remotionBufferingRef.current) return;
      if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
      remotionBufferingRef.current = false;
      setRemotionBuffering(false);
    };
    player.addEventListener('waiting', onWaiting);
    player.addEventListener('resume', onResume);
    player.addEventListener('frameupdate', onFrameUpdate);
    return () => {
      player.removeEventListener('waiting', onWaiting);
      player.removeEventListener('resume', onResume);
      player.removeEventListener('frameupdate', onFrameUpdate);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, [remotionPlayer]);

  const toggleRemotionPlay = useCallback(() => {
    const p = remotionRef.current;
    if (!p) {
      // The control can render a frame before RemotionRenderer publishes its
      // Player ref. Preserve the user's click and start as soon as that ref is
      // available instead of leaving an inert play button at 0:00.
      pendingRemotionPlayRef.current = true;
      return;
    }
    pendingRemotionPlayRef.current = false;
    if (remotionPlaying) {
      p.pause();
      setRemotionPlaying(false);
      dispatchActiveTrimPlayhead(false);
    } else {
      if (selectedEditableId && !activeTrimFieldId) onSelectEditable?.(null);
      if (remotionFrameRef.current >= remotionTotalFrames - 2) {
        p.seekTo(0);
        requestAnimationFrame(() => {
          p.play();
          remotionStartedRef.current = true;
          setRemotionPlaying(true);
          dispatchActiveTrimPlayhead(true);
        });
        return;
      }
      p.play();
      remotionStartedRef.current = true;
      setRemotionPlaying(true);
      dispatchActiveTrimPlayhead(true);
    }
  }, [activeTrimFieldId, dispatchActiveTrimPlayhead, remotionPlaying, remotionTotalFrames, selectedEditableId, onSelectEditable]);

  const handleDesignCanvasTap = useCallback(() => {
    if (selectedEditableId) onSelectEditable?.(null);
    if (currentDesign?.animation) toggleRemotionPlay();
  }, [currentDesign?.animation, onSelectEditable, selectedEditableId, toggleRemotionPlay]);

  const seekRemotion = useCallback((clientX: number) => {
    const bar = document.querySelector('[data-remotion-seek]') as HTMLElement;
    if (!bar || !remotionRef.current) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const frame = Math.round(ratio * (remotionTotalFrames - 1));
    // Pause on seek — prevent resume handler from auto-playing
    remotionRef.current.pause();
    setRemotionPlaying(false);
    remotionBufferingRef.current = false;
    setRemotionBuffering(false);
    remotionRef.current.seekTo(frame);
    remotionFrameRef.current = frame;
    updateRemotionUI();
    dispatchActiveTrimPlayhead(false);
  }, [dispatchActiveTrimPlayhead, remotionTotalFrames, updateRemotionUI]);

  useEffect(() => {
    if (!currentDesign?.animation) return;
    let raf = 0;
    let stopAtFrame: number | null = null;
    const stopPlayback = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      stopAtFrame = null;
      remotionRef.current?.pause();
      setRemotionPlaying(false);
      window.dispatchEvent(new CustomEvent('makaron:design-trim-playback', { detail: { playing: false } }));
      updateRemotionUI();
    };

    const tickRange = () => {
      updateRemotionUI();
      const context = activeTrimContextRef.current;
      const sourceFrame = context
        ? compositionFrameToSourceFrame({
            compositionFrame: remotionFrameRef.current,
            trimStartFrame: getActiveTrimStartFrame(),
            sequenceStartFrame: context.sequenceStartFrame,
          })
        : remotionFrameRef.current + getActiveTrimStartFrame();
      window.dispatchEvent(new CustomEvent('makaron:design-trim-playhead', {
        detail: { sourceFrame },
      }));
      if (stopAtFrame !== null && remotionFrameRef.current >= stopAtFrame) {
        stopPlayback();
        return;
      }
      raf = requestAnimationFrame(tickRange);
    };

    const onTrimPreview = (event: Event) => {
      const detail = (event as CustomEvent<{
        fieldId?: string;
        sourceFrame?: number;
        compositionFrame?: number;
        play?: boolean;
        startFrame?: number;
        endFrame?: number;
      }>).detail || {};
      const player = remotionRef.current;
      if (!player || !activeTrimFieldId || detail.fieldId !== activeTrimFieldId) return;
      const trimStartFrame = Math.max(0, Math.round(detail.startFrame ?? getActiveTrimStartFrame()));
      const context = activeTrimContextRef.current;
      const mappedFrame = context && detail.sourceFrame !== undefined
        ? sourceFrameToCompositionFrame({
            sourceFrame: detail.sourceFrame,
            trimStartFrame,
            sequenceStartFrame: context.sequenceStartFrame,
          })
        : detail.compositionFrame ?? 0;
      const frame = Math.max(0, Math.min(remotionTotalFrames - 1, Math.round(mappedFrame)));
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      player.pause();
      player.seekTo(frame);
      remotionFrameRef.current = frame;
      updateRemotionUI();

      if (detail.play) {
        const sourceEndFrame = Math.max(
          (detail.sourceFrame ?? trimStartFrame) + 1,
          Math.round(detail.endFrame ?? detail.sourceFrame ?? trimStartFrame),
        );
        const mappedEndFrame = context
          ? sourceFrameToCompositionFrame({
              sourceFrame: sourceEndFrame,
              trimStartFrame,
              sequenceStartFrame: context.sequenceStartFrame,
            })
          : frame + (sourceEndFrame - (detail.sourceFrame ?? trimStartFrame));
        stopAtFrame = Math.min(remotionTotalFrames - 1, Math.max(frame + 1, mappedEndFrame));
        player.play();
        setRemotionPlaying(true);
        window.dispatchEvent(new CustomEvent('makaron:design-trim-playback', { detail: { playing: true } }));
        raf = requestAnimationFrame(tickRange);
      } else {
        stopAtFrame = null;
        setRemotionPlaying(false);
        window.dispatchEvent(new CustomEvent('makaron:design-trim-playback', { detail: { playing: false } }));
      }
    };

    window.addEventListener('makaron:design-trim-preview', onTrimPreview);
    return () => {
      window.removeEventListener('makaron:design-trim-preview', onTrimPreview);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    currentDesign?.animation,
    activeTrimFieldId,
    getActiveTrimStartFrame,
    remotionTotalFrames,
    updateRemotionUI,
  ]);

  // Only proxy third-party CDN URLs (Kling etc.) — Supabase URLs play directly (better audio on iOS)
  const effectiveVideoUrl = videoUrl && !videoUrl.includes('cdn.makaron.app') && !videoUrl.includes('supabase.co')
    ? `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`
    : videoUrl;
  const rangedVideoUrl = effectiveVideoUrl
    ? `${effectiveVideoUrl.split('#')[0]}#t=${clipStart || 0.001}${clipEnd !== undefined ? `,${clipEnd}` : ''}`
    : undefined;

  const getLabel = (index: number) => {
    // Video entry
    if (timeline[index] === VIDEO_SENTINEL) return 'Video';
    // isDraft=true means we're currently viewing the draft slot
    if (isDraft) return 'Draft';
    // Reference snapshot
    if (referenceCount > 0 && index < referenceCount) return `@Ref ${index + 1}`;
    // 1-based index matching <<<media_N>>> convention
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
      /* Edit mode: capture-phase intercept blocks ALL gestures before they reach any handler.
         Moveable (z-3000 on body) and DesignOverlay hit-targets are unaffected. */
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

        {/* Video entry — use native player unless design has real edits (trim/overlay) */}
        {isVideoEntry && videoUrl && !(currentDesign && !isSimpleVideoWrapper(currentDesign.code)) ? (
          <div
            className="relative w-full h-full flex items-center justify-center"
            onPointerMove={resetControlsTimer}
            onClick={(e) => {
              e.stopPropagation();
              if (!showControls) { resetControlsTimer(); return; }
              if (videoPlaying) { videoRef.current?.pause(); }
              else { playVideoInRange(); }
            }}
          >
            <video
              key={rangedVideoUrl}
              ref={videoRef}
              src={rangedVideoUrl}
              crossOrigin="anonymous"
              playsInline
              muted
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
                if (v) {
                  const duration = Number.isFinite(v.duration) ? clipDurationFor(v.duration) : videoDuration;
                  const relativeTime = Math.max(0, Math.min(duration, v.currentTime - clipStart));
                  if (clipEnd !== undefined && v.currentTime >= clipEnd - 0.01 && !v.paused) v.pause();
                  setVideoCurrentTime(relativeTime);
                  onVideoTimeUpdate?.(relativeTime, duration);
                }
              }}
              onLoadedData={() => {
                setVideoFrameLoadedUrl(videoUrl ?? null);
                const v = videoRef.current;
                if (onVideoPosterCapture && v && v.videoWidth) {
                  const seekTo = clipStart + Math.min(0.5, clipDurationFor(v.duration || 1) * 0.1);
                  v.currentTime = seekTo;
                  const handler = () => {
                    try {
                      const canvas = document.createElement('canvas');
                      canvas.width = v.videoWidth;
                      canvas.height = v.videoHeight;
                      canvas.getContext('2d')!.drawImage(v, 0, 0);
                      onVideoPosterCapture(canvas.toDataURL('image/jpeg', 0.75));
                    } catch {}
                    v.currentTime = clipStart;
                    v.removeEventListener('seeked', handler);
                  };
                  v.addEventListener('seeked', handler, { once: true });
                }
              }}
              onLoadedMetadata={() => {
                const v = videoRef.current;
                if (v && isFinite(v.duration)) {
                  const duration = clipDurationFor(v.duration);
                  if (v.currentTime < clipStart || (clipEnd !== undefined && v.currentTime >= clipEnd)) v.currentTime = clipStart;
                  setVideoDuration(duration);
                  setVideoCurrentTime(Math.max(0, v.currentTime - clipStart));
                  onVideoTimeUpdate?.(Math.max(0, v.currentTime - clipStart), duration);
                }
              }}
              onProgress={() => {
                const v = videoRef.current;
                if (v && v.buffered.length > 0 && v.duration) {
                  const bufferedEnd = Math.min(v.buffered.end(v.buffered.length - 1), clipEnd ?? v.duration);
                  const duration = clipDurationFor(v.duration);
                  setVideoBuffered(duration > 0 ? Math.max(0, bufferedEnd - clipStart) / duration : 0);
                }
              }}
            />

            {/* Poster overlay — shown until video first frame loads (prevents black flash) */}
            {!videoFrameLoaded && !videoPlaying && (() => {
              const posterSrc = timeline[currentIndex] && timeline[currentIndex] !== VIDEO_SENTINEL
                ? timeline[currentIndex]
                : timeline.slice(0, -1).filter(t => t !== VIDEO_SENTINEL).pop();
              return posterSrc ? (

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

            {frameCaptureFeedback && (
              <div
                data-testid="video-frame-capture-feedback"
                data-capture-state="captured"
                className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center"
                style={{
                  animation: 'frameCaptureOverlay 760ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
                  background: 'rgba(0,0,0,0.16)',
                  backdropFilter: 'saturate(1.06) brightness(1.04)',
                }}
              >
                <div
                  className="rounded-[20px]"
                  style={{
                    position: 'absolute',
                    inset: 20,
                    border: '1px solid rgba(255,255,255,0.62)',
                    boxShadow: 'inset 0 0 0 1px rgba(217,70,239,0.18), 0 0 36px rgba(217,70,239,0.28)',
                    animation: 'frameCaptureReticle 760ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
                  }}
                />
                <div
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white"
                  style={{
                    background: 'rgba(10,10,10,0.68)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 8px 28px rgba(0,0,0,0.24)',
                    backdropFilter: 'blur(12px)',
                    animation: 'frameCaptureBadge 760ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
                  }}
                >
                  {t('video.frameCapturedShort')}
                </div>
                <style>{`
                  @keyframes frameCaptureOverlay {
                    0% { opacity: 0; transform: scale(1.006); }
                    18% { opacity: 1; transform: scale(1); }
                    72% { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(0.996); }
                  }
                  @keyframes frameCaptureReticle {
                    0% { opacity: 0; transform: scale(1.045); }
                    22% { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(0.985); }
                  }
                  @keyframes frameCaptureBadge {
                    0% { opacity: 0; transform: translateY(8px) scale(0.96); }
                    22% { opacity: 1; transform: translateY(0) scale(1); }
                    68% { opacity: 1; transform: translateY(0) scale(1); }
                    100% { opacity: 0; transform: translateY(-4px) scale(0.98); }
                  }
                `}</style>
              </div>
            )}

            {/* Play/pause button — bottom-left, hidden while seeking */}
            {!videoError && showControls && !hidePlaybackControls && !isSeeking && (
              <div className="absolute z-30" style={{ bottom: 8, left: 12 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (videoPlaying) { videoRef.current?.pause(); }
                    else { playVideoInRange(); }
                  }}
                  className="mkr-liquid-play-button w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                >
                  {videoPlaying ? (
                    <svg width="18" height="18" viewBox="0 0 10 10" fill="white"><rect x="1" y="0.5" width="2.8" height="9" rx="0.7" /><rect x="6.2" y="0.5" width="2.8" height="9" rx="0.7" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 10 10" fill="white"><polygon points="3.5,1.5 8.5,5 3.5,8.5" /></svg>
                  )}
                </button>
              </div>
            )}

            {/* Time badge — bottom-right (same as Remotion) */}
            {!videoError && (
              <div
                className={`absolute z-20 pointer-events-none transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
                style={{ bottom: 14, right: 10 }}
              >
                <span
                  className="mkr-liquid-media-badge tabular-nums rounded-full select-none"
                  style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', padding: '2px 6px' }}
                >
                  {formatTime(videoCurrentTime)}<span style={{ opacity: 0.4, margin: '0 2px' }}>/</span>{formatTime(videoDuration)}
                </span>
              </div>
            )}

            {/* Seek bar — Spotify-style: 2px default, 6px on hover/drag (same as Remotion) */}
            {!videoError && (
              <div
                ref={seekBarRef}
                className="absolute bottom-0 left-0 right-0 z-20 cursor-pointer group"
                style={{ height: 24, touchAction: 'none' }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (videoPlaying) videoRef.current?.pause();
                  seekDragging.current = true;
                  setIsSeeking(true);
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
                  setIsSeeking(false);
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div data-video-track className={`absolute bottom-0 left-0 right-0 transition-[height] duration-150 ${isSeeking ? 'h-[6px]' : 'h-[2px] group-hover:h-[6px]'}`}>
                  <div className="absolute inset-0 bg-white/12" />
                  <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${videoBuffered * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-fuchsia-500/75" style={{ width: `${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%` }} />
                </div>
              </div>
            )}
          </div>
        ) : isVideoEntry && !videoUrl && (videoProcessing || videoFailed) ? (
          /* Video processing/failed state: show placeholder + overlay */
          <div className="relative w-full h-full">
            { }
            <img
              src={videoPosterImage || VIDEO_PLACEHOLDER_IMAGE}
              alt="preview"
              className="w-full h-full object-cover select-none pointer-events-none"
              draggable={false}
            />
            {/* Gradient + status overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 45%, transparent 100%)' }}
            >
              <div className="flex flex-col items-center gap-3" style={{ marginBottom: '15%' }}>
                {videoFailed ? (
                  <>
                    {/* Red X circle */}
                    <div className="relative w-[72px] h-[72px] flex items-center justify-center">
                      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="22" stroke="rgba(239,68,68,0.7)" strokeWidth="3" />
                        <path d="M16 16l16 16M32 16l-16 16" stroke="rgba(239,68,68,0.9)" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-white font-semibold tracking-wide" style={{ fontSize: '1rem' }}>{t('canvas.videoFailed')}</span>
                    </div>
                  </>
                ) : (
                  <>
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
                      <span className="text-white/40 text-[12px]">{videoRenderTimeHint}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            {videoProcessing && <style>{`@keyframes renderSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>}
          </div>
        ) : currentDesign && !isComparing ? (
          /* Animated design (or draft preview) — Remotion Player with custom controls (same as video) */
          (() => {
            const isLongDesign = currentDesign.height / currentDesign.width > 2;
            return (
          <div ref={handleDesignInteractionRef} className={`relative w-full h-full ${isLongDesign ? 'overflow-y-auto overflow-x-hidden' : ''} transition-all duration-150 ${
            pullDownActive ? 'opacity-[0.15] grayscale' :
            animDir === 'left' ? 'opacity-0 -translate-x-8' :
            animDir === 'right' ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
          }`}
          >
            <RemotionRenderer
              design={currentDesign!}
              projectId={projectId}
              snapshotId={designSnapshotId}
              mode={isLongDesign ? 'inline' : 'fill'}
              hideControls
              posterImage={currentDesign?.animation && !selectedEditableId ? displayImage : undefined}
              onLoading={setRemotionLoading}
              onError={(err) => console.error('[canvas design]', err)}
              onContainerRef={setDesignContainerEl}
              onContentSize={onDesignContentSize}
              onPlayerRef={(ref) => {
                remotionRef.current = ref;
                setRemotionPlayer(ref);
                setRemotionPlaying(ref?.isPlaying() ?? false);
                if (editableFields?.length) setDesignPlayerRef(ref);
                if (ref && pendingRemotionPlayRef.current) {
                  pendingRemotionPlayRef.current = false;
                  ref.play();
                  remotionStartedRef.current = true;
                  setRemotionPlaying(true);
                  dispatchActiveTrimPlayhead(true);
                }
              }}
            />

            {/* Poster fallback while RemotionRenderer is loading (fetching images/fonts/audio) */}
            {remotionLoading && displayImage && !selectedEditableId && (
              <img
                src={displayImage}
                alt="poster"
                className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none z-[1]"
              />
            )}

            {/* Play/pause button — bottom-left, hidden while seeking */}
            {currentDesign?.animation && !hidePlaybackControls && !isSeeking && (
              <div className="absolute z-30" style={{ bottom: 8, left: 12 }}>
                <button
                  // Remotion queues play() while its buffer handle is active
                  // and resumes automatically once the source frame is ready.
                  // Dropping a click during that window makes Safari appear
                  // permanently stuck even though the media later decodes.
                  onClick={(e) => { e.stopPropagation(); toggleRemotionPlay(); }}
                  className="mkr-liquid-play-button w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                >
                  {(remotionBuffering || remotionLoading) ? (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="animate-spin">
                      <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
                      <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : remotionPlaying ? (
                    <svg width="18" height="18" viewBox="0 0 10 10" fill="white"><rect x="1" y="0.5" width="2.8" height="9" rx="0.7" /><rect x="6.2" y="0.5" width="2.8" height="9" rx="0.7" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 10 10" fill="white"><polygon points="3.5,1.5 8.5,5 3.5,8.5" /></svg>
                  )}
                </button>
              </div>
            )}

            {/* Time badge — updated via DOM (data-remotion-time), hidden in design editor mode */}
            {currentDesign?.animation && !selectedEditableId && (
              <div className="absolute z-20 pointer-events-none" style={{ bottom: 14, right: 10 }}>
                <span data-remotion-time className="mkr-liquid-media-badge tabular-nums rounded-full select-none"
                  style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', padding: '2px 6px' }}>
                  {formatTime(0)} / {formatTime(remotionDuration)}
                </span>
              </div>
            )}

            {/* Seek bar — Spotify-style: 2px default, 6px on hover/drag */}
            {currentDesign?.animation && (
              <div
                data-remotion-seek
                className="absolute bottom-0 left-0 right-0 z-20 cursor-pointer group"
                style={{ height: 24, touchAction: 'none' }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (selectedEditableId && !activeTrimFieldId) onSelectEditable?.(null);
                  if (remotionPlaying) {
                    remotionRef.current?.pause();
                    setRemotionPlaying(false);
                  }
                  setIsSeeking(true);
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  seekRemotion(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (e.buttons) seekRemotion(e.clientX);
                }}
                onPointerUp={(e) => {
                  setIsSeeking(false);
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div data-remotion-track className={`absolute bottom-0 left-0 right-0 transition-[height] duration-150 ${isSeeking ? 'h-[6px]' : 'h-[2px] group-hover:h-[6px]'}`}>
                  <div className="absolute inset-0 bg-white/12" />
                  <div data-remotion-fill className="absolute inset-y-0 left-0 bg-fuchsia-500/75" style={{ width: '0%' }} />
                </div>
              </div>
            )}
            {/* Edit mode gesture shield div removed — handled by capture-phase on outer container */}
            {/* Editable design overlay */}
            {editableFields && editableFields.length > 0 && designProps && onSelectEditable && onUpdateProp && (
              <DesignOverlay
                containerEl={designContainerEl}
                interactionEl={designInteractionEl}
                editables={editableFields}
                props={designProps}
                selectedFieldId={selectedEditableId ?? null}
                onCanvasTap={handleDesignCanvasTap}
                onSelectField={(id) => {
                  // Pause playback when selecting an editable field
                  if (id && remotionRef.current) {
                    remotionRef.current.pause();
                    setRemotionPlaying(false);
                  }
                  onSelectEditable(id);
                }}
                onUpdateProp={onUpdateProp}
                onStartEdit={onStartEditEditable}
                onVisibleFieldsChange={onVisibleEditableFields}
                filterVisibleFields={Boolean(currentDesign?.animation)}
                playerRef={designPlayerRef}
              />
            )}
          </div>
            );
          })()
        ) : displayImage ? (
          isLongContent ? (
            <div ref={longScrollRef} className="w-full h-full overflow-y-auto overflow-x-hidden">
              { }
              <img
                ref={imgElRef}
                src={displayImage}
                alt="preview"
                className={`w-full h-auto select-none pointer-events-none transition-all duration-150 ${
                  pullDownActive ? 'opacity-[0.15] grayscale' :
                  animDir === 'left' ? 'opacity-0 -translate-x-8' :
                  animDir === 'right' ? 'opacity-0 translate-x-8' :
                  imageLoaded ? 'opacity-100 translate-x-0' : 'opacity-0'
                }`}
                draggable={false}
                onLoad={() => { setImageLoaded(true); updateImageRect(); }}
              />
            </div>
          ) : (

            <img
              ref={imgElRef}
              src={displayImage}
              alt="preview"
              fetchPriority="high"
              className={`w-full h-full object-contain select-none pointer-events-none transition-all duration-150 ${
                pullDownActive ? 'opacity-[0.15] grayscale' :
                animDir === 'left' ? 'opacity-0 -translate-x-8' :
                animDir === 'right' ? 'opacity-0 translate-x-8' :
                imageLoaded ? 'opacity-100 translate-x-0' : 'opacity-0'
              }`}
              draggable={false}
              onLoad={() => { setImageLoaded(true); updateImageRect(); }}
            />
          )
        ) : (
          /* Design snapshot without poster — placeholder until captureDesignPoster runs */
          <div className="w-full h-full flex items-center justify-center text-white/30 text-sm">
            Rendering...
          </div>
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

      {/* Timeline indicators — bottom of canvas, hidden while seeking or in design editor mode */}
      {!selectedEditableId && !isSeeking && (timeline.length > 1 || onAnimate) && (
        <div className={`absolute left-1/2 -translate-x-1/2 flex items-center justify-center z-10 ${isDesktop ? 'bottom-3' : 'bottom-3'}`}>
          <div className={`mkr-liquid-timeline-rail flex items-center rounded-full ${isDesktop ? 'gap-1.5 px-3 py-1.5' : 'gap-[5px] px-[10px] py-[5px]'}`}>
            {timeline.map((entry, i) => {
              const isRef = referenceCount > 0 && i < referenceCount;
              const showDivider = referenceCount > 0 && i === referenceCount;
              return (
                <span key={i} className="flex items-center">
                  {showDivider && (
                    <span className={`${isDesktop ? 'w-px h-3 mr-1.5' : 'w-px h-2 mr-[5px]'} bg-white/20`} />
                  )}
                  {entry === VIDEO_SENTINEL ? (
                    /* v1 sentinel: play triangle */
                    <button
                      onClick={() => goTo(i)}
                      className={`mkr-liquid-timeline-dot flex items-center justify-center cursor-pointer transition-all ${
                        i === currentIndex ? 'mkr-liquid-timeline-dot-active' : ''
                      } ${isDesktop ? 'w-5 h-5 hover:opacity-90' : 'w-3 h-3'}`}
                      style={{ color: i === currentIndex ? 'rgba(14,14,18,0.95)' : 'rgba(255,255,255,0.55)' }}
                    >
                      <svg width={isDesktop ? "11" : "8"} height={isDesktop ? "11" : "8"} viewBox="0 0 8 8" fill="currentColor">
                        <polygon points="2,1 7,4 2,7" />
                      </svg>
                    </button>
                  ) : videoTimelineIndices?.has(i) ? (
                    /* v2 video: square (unselected) → wide rect (selected) — no border-radius */
                    <button
                      onClick={() => goTo(i)}
                      className={`mkr-liquid-timeline-dot cursor-pointer transition-all ${
                        i === currentIndex
                          ? `mkr-liquid-timeline-dot-active ${isDesktop ? 'w-5 h-2 rounded-[2px]' : 'w-3 h-[5px] rounded-[1px]'}`
                          : `${isDesktop ? 'w-2 h-2 rounded-[2px] hover:opacity-90' : 'w-[5px] h-[5px] rounded-[1px]'}`
                      }`}
                    />
                  ) : (
                    /* Image: circle (unselected) → ellipse pill (selected) */
                    <button
                      onClick={() => goTo(i)}
                      className={`mkr-liquid-timeline-dot transition-all cursor-pointer ${
                        i === currentIndex
                          ? `mkr-liquid-timeline-dot-active ${isDesktop ? 'w-5 h-2 rounded-full hover:opacity-95' : 'w-3 h-[5px] rounded-full'}`
                          : isRef
                            ? `mkr-liquid-timeline-dot-reference ${isDesktop ? 'w-2 h-2 rounded-full hover:opacity-90' : 'w-[5px] h-[5px] rounded-full'}`
                            : `${isDesktop ? 'w-2 h-2 rounded-full hover:opacity-90' : 'w-[5px] h-[5px] rounded-full'}`
                      }`}
                    />
                  )}
                </span>
              );
            })}
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
