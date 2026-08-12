'use client';

/**
 * Evaluate Agent-generated JSX code as a React component.
 * Strategy: Sucrase first (bundled, fast, ~1MB), Babel CDN fallback for edge cases.
 *
 * Convention: Agent writes a COMPLETE function with return statement:
 *   function Design(props) { return (<div>...</div>); }
 */

import { transform as sucraseTransform } from 'sucrase';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Remotion from 'remotion';
import { Audio, Video } from '@remotion/media';
import * as RemotionPaths from '@remotion/paths';
import * as RemotionNoise from '@remotion/noise';
import * as THREE from 'three';
import { buildRemotionEvaluatorBody } from './remotion-code-normalization';
import {
  createEditableReactRuntime,
  type EditableTransformMode,
} from './editor/editable-react-runtime';
import { getPreviewPremountFrames } from './remotion-preview-premount';

export type { EditableTransformMode } from './editor/editable-react-runtime';

export type BrowserVideoRuntime = 'preview' | 'render';

const { Sequence, useVideoConfig } = Remotion;

const VIDEO_COMPONENT_CALL = /(?:React\.)?createElement\(\s*(?:Video|OffthreadVideo|Html5Video)\b/;
const componentContainsVideoCache = new WeakMap<object, boolean>();

type PreviewMediaReadiness = {
  captureLastFrame: boolean;
  isActiveMediaScene: boolean;
  markPending: () => void;
  markReady: () => void;
  requirePlaybackAdvance: boolean;
  showLastFrame: boolean;
};

const PreviewMediaReadinessContext = React.createContext<PreviewMediaReadiness | null>(null);

function isSafariWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

function isIOSWebKit(): boolean {
  if (typeof navigator === 'undefined' || !isSafariWebKit()) return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) || (
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  );
}

type PreviewVideoSource = React.ComponentProps<typeof Remotion.Html5Video>['src'];
type PreviewVideoSourcePhase = 'direct' | 'proxy' | 'direct-retry';

function getPreviewMediaProxySource(src: PreviewVideoSource): PreviewVideoSource {
  if (typeof src !== 'string' || typeof window === 'undefined' || !/^https?:\/\//i.test(src)) return src;
  try {
    const parsed = new URL(src);
    const canLoadDirectly =
      parsed.origin === window.location.origin ||
      parsed.hostname === 'cdn.makaron.app' ||
      parsed.hostname.endsWith('.supabase.co');
    if (canLoadDirectly) return src;
    return `/api/proxy-video?url=${encodeURIComponent(src)}`;
  } catch {
    return src;
  }
}

function isPreviewMediaVisuallyActive(media: HTMLVideoElement): boolean {
  let element: HTMLElement | null = media;
  while (element) {
    const style = window.getComputedStyle(element);
    const isReadinessGate = element.classList.contains('makaron-preview-readiness-gate');
    if (
      element.hidden ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (!isReadinessGate && Number.parseFloat(style.opacity || '1') <= 0.001)
    ) {
      return false;
    }
    element = element.parentElement;
  }
  return true;
}

function componentSourceContainsVideo(type: unknown): boolean {
  if ((typeof type !== 'function' && typeof type !== 'object') || type === null) return false;

  const key = type as object;
  const cached = componentContainsVideoCache.get(key);
  if (cached !== undefined) return cached;

  const render = typeof type === 'function'
    ? type
    : (type as { render?: unknown }).render;
  const containsVideo = typeof render === 'function'
    ? VIDEO_COMPONENT_CALL.test(Function.prototype.toString.call(render))
    : false;
  componentContainsVideoCache.set(key, containsVideo);
  return containsVideo;
}

function childrenContainPreviewVideo(children: React.ReactNode): boolean {
  let containsVideo = false;
  React.Children.forEach(children, child => {
    if (containsVideo || !React.isValidElement(child)) return;

    const type = child.type;
    if (
      type === PreviewVideo ||
      type === Remotion.Html5Video ||
      type === Video ||
      componentSourceContainsVideo(type)
    ) {
      containsVideo = true;
      return;
    }

    containsVideo = childrenContainPreviewVideo(
      (child.props as { children?: React.ReactNode }).children,
    );
  });
  return containsVideo;
}

function getPreviewVideoDurationInFrames(children: React.ReactNode): number | null {
  let duration: number | null = null;
  React.Children.forEach(children, child => {
    if (duration !== null || !React.isValidElement(child)) return;

    const type = child.type;
    const props = child.props as {
      children?: React.ReactNode;
      endAt?: number;
      playbackRate?: number;
      startFrom?: number;
      trimAfter?: number;
      trimBefore?: number;
    };
    const isVideoComponent =
      type === PreviewVideo ||
      type === Remotion.Html5Video ||
      type === Video ||
      componentSourceContainsVideo(type);
    const rangeStart = props.trimBefore ?? props.startFrom ?? 0;
    const rangeEnd = props.trimAfter ?? props.endAt;
    const playbackRate = props.playbackRate ?? 1;

    if (
      isVideoComponent &&
      typeof rangeEnd === 'number' &&
      rangeEnd > rangeStart &&
      playbackRate > 0
    ) {
      duration = (rangeEnd - rangeStart) / playbackRate;
      return;
    }

    duration = getPreviewVideoDurationInFrames(props.children);
  });
  return duration;
}

// Browser preview only: report when the native media tag has a decoded frame.
// Keeping this wrapper at module scope avoids creating a new component per render.
const PreviewVideo = React.forwardRef(function PreviewVideo(
  props: React.ComponentProps<typeof Remotion.Html5Video>,
  ref: React.Ref<HTMLVideoElement>,
) {
  const frame = Remotion.useCurrentFrame();
  const { fps } = useVideoConfig();
  const readiness = React.useContext(PreviewMediaReadinessContext);
  const reportedReady = React.useRef(false);
  const videoElementRef = React.useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const captureFailed = React.useRef(false);
  const cachedFrameReady = React.useRef(false);
  const safariBufferHandleRef = React.useRef<{ unblock: () => void } | null>(null);
  const safariBufferMutedStateRef = React.useRef<boolean | null>(null);
  const markReadyRef = React.useRef<(video: HTMLVideoElement) => void>(() => undefined);
  const [hasCachedFrame, setHasCachedFrame] = React.useState(false);
  const [sourcePhase, setSourcePhase] = React.useState<PreviewVideoSourcePhase>('direct');
  const safari = React.useMemo(() => isSafariWebKit(), []);
  const { delayPlayback } = Remotion.useBufferState();
  const {
    className,
    crossOrigin,
    onCanPlay,
    onError,
    onLoadedData,
    onPlaying,
    onProgress,
    onSeeked,
    onStalled,
    onTimeUpdate,
    onWaiting,
    playbackRate = 1,
    preload,
    startFrom,
    src,
    style,
    trimBefore,
    ...rest
  } = props;
  const trimStartFrame = trimBefore ?? startFrom ?? 0;
  const minimumRevealTime = (
    trimStartFrame +
    (readiness?.requirePlaybackAdvance ? 2 : 0)
  ) / fps;
  const expectedTime = (trimStartFrame + frame * playbackRate) / fps;
  const isActive = readiness?.isActiveMediaScene ?? frame >= 0;
  const proxyFallbackSrc = React.useMemo(
    () => getPreviewMediaProxySource(src),
    [src],
  );
  const hasProxyFallback = proxyFallbackSrc !== src;
  const previewSrc = sourcePhase === 'proxy' ? proxyFallbackSrc : src;

  const advanceSourceFallback = React.useCallback(() => {
    if (!hasProxyFallback || sourcePhase === 'direct-retry') return false;
    reportedReady.current = false;
    readiness?.markPending();
    // Only a terminal media error reaches this path; waiting/stalled events
    // keep the same native tag so Remotion cannot reset to frame zero. Give the
    // proxy one attempt, then return to direct exactly once if it also errors.
    setSourcePhase(current => current === 'direct' ? 'proxy' : 'direct-retry');
    return true;
  }, [hasProxyFallback, readiness, sourcePhase]);

  const unblockSafariPlayback = React.useCallback(() => {
    safariBufferHandleRef.current?.unblock();
    safariBufferHandleRef.current = null;
    const video = videoElementRef.current;
    if (video && safariBufferMutedStateRef.current !== null) {
      video.muted = safariBufferMutedStateRef.current;
    }
    safariBufferMutedStateRef.current = null;
  }, []);

  const blockSafariPlayback = React.useCallback(() => {
    const video = videoElementRef.current;
    if (!safari || !isActive || !video || !isPreviewMediaVisuallyActive(video)) {
      unblockSafariPlayback();
      return;
    }
    if (safariBufferHandleRef.current) return;
    safariBufferMutedStateRef.current = video.muted;
    video.muted = true;
    safariBufferHandleRef.current = delayPlayback();
    // Remotion pauses every media tag while any custom buffer handle is live.
    // Keep only the incoming tag decoding (muted above), otherwise Safari can
    // never produce the frame which releases this handle.
    void video.play().catch(() => undefined);
  }, [delayPlayback, isActive, safari, unblockSafariPlayback]);

  React.useEffect(() => {
    reportedReady.current = false;
    captureFailed.current = false;
    cachedFrameReady.current = false;
    setHasCachedFrame(false);
    setSourcePhase('direct');
    readiness?.markPending();
  }, [readiness?.markPending, src]);

  // Remotion 4.0.448 has a Safari-only first-frame deadlock: it pauses the
  // Player while waiting for requestVideoFrameCallback, but Safari may have
  // already delivered that frame before the callback is registered. The media
  // tag keeps playing at frame 0 while the Player can never advance. Own the
  // Safari buffer handle here instead: never block while the Player is still
  // showing its unplayed poster, then hold an active scene only after its media
  // tag actually attempts playback.
  React.useEffect(() => {
    if (!safari || !isActive) {
      unblockSafariPlayback();
      return;
    }

    const video = videoElementRef.current;
    if (!video) {
      unblockSafariPlayback();
      return;
    }

    // Safari may decode and paint the requested frame before React's media
    // events and requestVideoFrameCallback subscription are attached. It can
    // also omit a second canplay/frame callback after Remotion seeks a paused
    // tag back onto the Player frame. Re-check the active tag briefly instead
    // of depending on an event which may already have happened.
    const checkDecodedFrame = () => {
      markReadyRef.current(video);
      if (!reportedReady.current) return false;
      unblockSafariPlayback();
      return true;
    };
    if (checkDecodedFrame()) return;

    const readinessPoll = window.setInterval(() => {
      if (checkDecodedFrame()) {
        window.clearInterval(readinessPoll);
        return;
      }
      if (safariBufferHandleRef.current && video.paused && !video.ended) {
        void video.play().catch(() => undefined);
      }
    }, 50);

    return () => {
      window.clearInterval(readinessPoll);
      unblockSafariPlayback();
    };
  }, [blockSafariPlayback, isActive, safari, src, unblockSafariPlayback]);

  const setVideoRef = React.useCallback((video: HTMLVideoElement | null) => {
    videoElementRef.current = video;
    if (typeof ref === 'function') ref(video);
    else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = video;
  }, [ref]);

  // Remotion premounts the native tag but may leave it buffered at source time
  // zero until the Sequence becomes active. For trimmed Scene clips that means
  // the first real cut still has to issue a new Range request. Seek hidden
  // premounts to their authored trim point as soon as metadata is available so
  // the browser buffers the exact frame range needed at the cut.
  React.useEffect(() => {
    const video = videoElementRef.current;
    if (!video || isActive || trimStartFrame <= 0) return;

    let disposed = false;
    const primeTrimStart = () => {
      if (disposed || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const targetTime = Math.min(trimStartFrame / fps, Math.max(0, video.duration - 0.05));
      if (Math.abs(video.currentTime - targetTime) > 1 / fps) {
        video.currentTime = targetTime;
      }
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) primeTrimStart();
    else video.addEventListener('loadedmetadata', primeTrimStart);
    return () => {
      disposed = true;
      video.removeEventListener('loadedmetadata', primeTrimStart);
    };
  }, [fps, isActive, src, trimStartFrame]);

  const drawVideoFrame = React.useCallback(() => {
    const video = videoElementRef.current;
    const canvas = frameCanvasRef.current;
    if (
      captureFailed.current ||
      !video ||
      !canvas ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) return;

    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      if (!cachedFrameReady.current) {
        cachedFrameReady.current = true;
        setHasCachedFrame(true);
      }
    } catch (error) {
      captureFailed.current = true;
      console.warn(
        '[PreviewVideo] Could not cache a decoded frame for cut continuity',
        error instanceof Error ? error.name : 'unknown error',
      );
    }
  }, []);

  React.useEffect(() => {
    if (!readiness?.captureLastFrame) return;
    drawVideoFrame();

    const video = videoElementRef.current;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    let callbackId: number | null = null;
    const captureNextFrame = () => {
      drawVideoFrame();
      callbackId = video.requestVideoFrameCallback(captureNextFrame);
    };
    callbackId = video.requestVideoFrameCallback(captureNextFrame);
    return () => {
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
    };
  }, [drawVideoFrame, readiness?.captureLastFrame]);

  const markReady = React.useCallback((video: HTMLVideoElement) => {
    if (reportedReady.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    if (safari && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;

    // loadeddata/canplay can fire for source time 0 before Remotion's trim seek
    // has completed. Do not reveal the scene until the decoded frame is close
    // to the range-local frame that the composition currently expects.
    const allowedDrift = Math.max(0.35, 4 / fps);
    if (Math.abs(video.currentTime - expectedTime) > allowedDrift) return;
    // Safari and Remotion can quantize the same frame boundary on opposite
    // sides of a floating-point comparison (for example 0.06666 vs 2 / 30).
    // Once Safari has future data, accept a quarter-frame tolerance instead
    // of keeping the whole Player buffered forever at an already-decoded cut.
    if (video.currentTime + 1 / (fps * 4) < minimumRevealTime) return;

    reportedReady.current = true;
    unblockSafariPlayback();
    readiness?.markReady();
  }, [expectedTime, fps, minimumRevealTime, readiness, safari, unblockSafariPlayback]);
  markReadyRef.current = markReady;

  React.useEffect(() => {
    const video = videoElementRef.current;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;

    let callbackId: number | null = null;
    const checkReadinessFrame = () => {
      markReadyRef.current(video);
      if (!reportedReady.current) {
        callbackId = video.requestVideoFrameCallback(checkReadinessFrame);
      }
    };
    callbackId = video.requestVideoFrameCallback(checkReadinessFrame);
    return () => {
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
    };
  }, [src]);

  const handleCanPlay = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    if (
      reportedReady.current &&
      event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      unblockSafariPlayback();
    }
    onCanPlay?.(event);
  }, [markReady, onCanPlay, unblockSafariPlayback]);

  const handleLoadedData = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    onLoadedData?.(event);
  }, [markReady, onLoadedData]);

  const handlePlaying = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    if (!reportedReady.current) {
      blockSafariPlayback();
      const targetTime = Math.max(0, expectedTime, minimumRevealTime);
      if (Math.abs(event.currentTarget.currentTime - targetTime) > 1 / fps) {
        // Safari can run the native tag several frames ahead before the Player
        // buffer pause lands. Seek it back explicitly; otherwise a frozen
        // Player frame never rerenders and Remotion cannot correct the drift.
        event.currentTarget.currentTime = targetTime;
      }
    } else if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      unblockSafariPlayback();
    }
    onPlaying?.(event);
  }, [blockSafariPlayback, expectedTime, fps, markReady, minimumRevealTime, onPlaying, unblockSafariPlayback]);

  const handleSeeked = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    if (
      reportedReady.current &&
      event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      unblockSafariPlayback();
    }
    onSeeked?.(event);
  }, [markReady, onSeeked, unblockSafariPlayback]);

  const handleProgress = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    if (
      reportedReady.current &&
      event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      unblockSafariPlayback();
    }
    onProgress?.(event);
  }, [markReady, onProgress, unblockSafariPlayback]);

  const handleWaiting = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    blockSafariPlayback();
    onWaiting?.(event);
  }, [blockSafariPlayback, onWaiting]);

  const handleStalled = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      blockSafariPlayback();
    }
    onStalled?.(event);
  }, [blockSafariPlayback, onStalled]);

  const handleError = React.useCallback((error: Error) => {
    if (advanceSourceFallback()) {
      unblockSafariPlayback();
      return;
    }
    // Keep the timeline on the last valid frame. Advancing after a terminal
    // media error recreates the captions-only failure the buffer guard fixes.
    blockSafariPlayback();
    onError?.(error);
  }, [advanceSourceFallback, blockSafariPlayback, onError, unblockSafariPlayback]);

  const handleTimeUpdate = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    // requestVideoFrameCallback above is frame-accurate and cheaper than doing
    // a second canvas copy for every timeupdate. Keep timeupdate only as the
    // fallback for browsers without the frame callback API.
    if (
      readiness?.captureLastFrame &&
      typeof event.currentTarget.requestVideoFrameCallback !== 'function'
    ) {
      drawVideoFrame();
    }
    markReady(event.currentTarget);
    if (
      safari &&
      isActive &&
      !reportedReady.current &&
      (!event.currentTarget.paused || safariBufferHandleRef.current)
    ) {
      blockSafariPlayback();
      const targetTime = Math.max(0, expectedTime, minimumRevealTime);
      if (Math.abs(event.currentTarget.currentTime - targetTime) > 1 / fps) {
        event.currentTarget.currentTime = targetTime;
      }
    }
    if (
      reportedReady.current &&
      event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      unblockSafariPlayback();
    }
    onTimeUpdate?.(event);
  }, [
    blockSafariPlayback,
    drawVideoFrame,
    expectedTime,
    fps,
    isActive,
    markReady,
    minimumRevealTime,
    onTimeUpdate,
    readiness,
    safari,
    unblockSafariPlayback,
  ]);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Remotion.Html5Video, {
      ...rest,
      className,
      crossOrigin: crossOrigin ?? 'anonymous',
      // Html5Video defaults this to false. Without the opt-in, a newly-active
      // source range may sit at readyState 0 while the Remotion timeline keeps
      // advancing, leaving captions/motion graphics playing over no footage.
      // Let Remotion hold the whole Player frame until the media tag has future
      // data; the outgoing cached frame remains visible during that hold.
      // Safari uses the explicit buffer handle above because Remotion's
      // first-frame callback path can deadlock at frame 0.
      pauseWhenBuffering: !safari,
      playbackRate,
      preload: preload ?? 'auto',
      src: previewSrc,
      startFrom,
      style,
      trimBefore,
      ref: setVideoRef,
      onCanPlay: handleCanPlay,
      onLoadedData: handleLoadedData,
      onPlaying: handlePlaying,
      onProgress: handleProgress,
      onSeeked: handleSeeked,
      onStalled: handleStalled,
      onTimeUpdate: handleTimeUpdate,
      onWaiting: handleWaiting,
      onError: handleError,
    }),
    React.createElement('canvas', {
      'aria-hidden': true,
      className,
      ref: frameCanvasRef,
      style: {
        ...style,
        // The authored scene is commonly a flex column. A second 100%-height
        // flex item would shrink the live video and expose a duplicate strip at
        // the bottom of the frame. Overlay the cache instead so it occupies
        // exactly the same visual layer without participating in layout.
        position: 'absolute',
        inset: 0,
        display: readiness?.showLastFrame && hasCachedFrame
          ? (style?.display ?? 'block')
          : 'none',
        width: style?.width ?? '100%',
        height: style?.height ?? '100%',
        pointerEvents: 'none',
      },
    }),
  );
});

// Sequence wrapper: auto-inject premountFor={fps*3} when not specified
// 3 seconds of premount gives video elements enough time to buffer before their scene starts
const AutoPremountSequence = React.forwardRef(function AutoPremountSequence(

  props: any,
  ref: React.Ref<HTMLDivElement>,
) {
  const { fps } = useVideoConfig();
  return React.createElement(Sequence, { ...props, premountFor: props.premountFor ?? fps * 3, ref });
});

// Interactive preview only: a media scene stays transparent until its native
// video has decoded the correct range-local frame. Just before a cut, PreviewVideo
// caches the last real source-range frame into a canvas. The preceding Sequence
// stays active with that canvas underneath for up to three seconds. We do not
// freeze or postmount the native tag itself because Chromium can clear its painted
// pixels in both transitions. Once the next frame is ready it paints above the
// cached frame immediately; there is no fixed transition delay.
const PreviewSequence = React.forwardRef(function PreviewSequence(
  props: any,
  ref: React.Ref<HTMLDivElement>,
) {
  const frame = Remotion.useCurrentFrame();
  const { fps } = useVideoConfig();
  const parentReadiness = React.useContext(PreviewMediaReadinessContext);
  const containsVideo = React.useMemo(
    () => childrenContainPreviewVideo(props.children),
    [props.children],
  );
  const mediaDuration = React.useMemo(
    () => getPreviewVideoDurationInFrames(props.children),
    [props.children],
  );
  const [mediaReady, setMediaReady] = React.useState(!containsVideo);

  React.useEffect(() => {
    setMediaReady(!containsVideo);
  }, [containsVideo]);

  const markPending = React.useCallback(() => {
    setMediaReady(false);
    parentReadiness?.markPending();
  }, [parentReadiness]);
  const markReady = React.useCallback(() => {
    setMediaReady(true);
    parentReadiness?.markReady();
  }, [parentReadiness]);

  const authoredDuration = props.durationInFrames;
  const canHoldLastFrame = containsVideo && Number.isFinite(authoredDuration);
  const premountFor = props.premountFor ?? getPreviewPremountFrames({
    authoredDuration,
    fps,
    iosWebKit: isIOSWebKit(),
  });
  // The Player freezes its composition frame while the incoming source buffers.
  // Keeping the outgoing cache for only a few composition frames therefore
  // preserves it for the entire wall-clock stall without retaining a native
  // decoder for another three seconds after every cut.
  const continuityFrames = canHoldLastFrame
    ? (props.postmountFor ?? Math.max(2, Math.round(fps / 10)))
    : 0;
  const lastRealMediaFrameBoundary = canHoldLastFrame
    ? Math.min(authoredDuration, mediaDuration ?? authoredDuration)
    : authoredDuration;
  const showLeadFrames = Math.max(2, Math.round(fps * 0.3));
  const showLastFrameAt = canHoldLastFrame
    ? Math.max(1, lastRealMediaFrameBoundary - showLeadFrames)
    : authoredDuration;
  // Start close to the handoff. The callback keeps the overlay moving through
  // the final source frames, then naturally leaves the last decoded frame in
  // place if the incoming Range seek needs a moment. A long capture window both
  // wastes large canvas copies and makes cut-time jank more likely.
  const captureLeadFrames = Math.max(1, Math.round(fps / 15));
  const captureLastFrameAt = canHoldLastFrame
    ? Math.max(0, showLastFrameAt - captureLeadFrames)
    : authoredDuration;
  const relativeFrame = frame - (props.from ?? 0);
  const isWithinAuthoredRange = relativeFrame >= 0 && (
    !Number.isFinite(authoredDuration) || relativeFrame < authoredDuration
  );
  const captureLastFrame = canHoldLastFrame && relativeFrame >= captureLastFrameAt;
  const showLastFrame = canHoldLastFrame && relativeFrame >= showLastFrameAt;
  const isContinuingPastCut = canHoldLastFrame && relativeFrame >= authoredDuration;
  const readiness = React.useMemo(
    () => ({
      captureLastFrame: Boolean(parentReadiness?.captureLastFrame || captureLastFrame),
      isActiveMediaScene: Boolean(
        (parentReadiness?.isActiveMediaScene ?? true) && isWithinAuthoredRange
      ),
      markPending,
      markReady,
      requirePlaybackAdvance: Boolean(
        parentReadiness?.requirePlaybackAdvance ||
        (containsVideo && (props.from ?? 0) > 0)
      ),
      showLastFrame: Boolean(parentReadiness?.showLastFrame || showLastFrame),
    }),
    [
      captureLastFrame,
      containsVideo,
      isWithinAuthoredRange,
      markPending,
      markReady,
      parentReadiness,
      props.from,
      showLastFrame,
    ],
  );
  const style = containsVideo
    ? {
        ...props.style,
        ...(isContinuingPastCut ? props.styleWhilePostmounted : {}),
        ...(mediaReady
          ? {}
          : {
              background: 'transparent',
              backgroundColor: 'transparent',
              backgroundImage: 'none',
            }),
        pointerEvents: isContinuingPastCut ? 'none' : props.style?.pointerEvents,
      }
    : props.style;
  const readinessContent = React.createElement(
    PreviewMediaReadinessContext.Provider,
    { value: readiness },
    props.children,
  );
  // PremountedPostmountedSequence forces its active wrapper opacity back to 1,
  // so readiness gating must live inside Sequence rather than in `style` above.
  const content = containsVideo
    ? React.createElement(
        Remotion.AbsoluteFill,
        {
          className: 'makaron-preview-readiness-gate',
          style: {
            opacity: mediaReady ? 1 : 0,
            pointerEvents: mediaReady ? undefined : 'none',
          },
        },
        readinessContent,
      )
    : readinessContent;

  return React.createElement(
    Sequence,
    {
      ...props,
      style,
      durationInFrames: canHoldLastFrame
        ? authoredDuration + continuityFrames
        : authoredDuration,
      // Desktop browsers can warm several long Scene originals. iOS WebKit
      // scales the lead to each scene so rapid cuts do not exhaust its much
      // smaller native video-decoder budget and terminate the page.
      premountFor,
      postmountFor: canHoldLastFrame ? 0 : props.postmountFor,
      styleWhilePostmounted: canHoldLastFrame ? undefined : props.styleWhilePostmounted,
      ref,
    },
    content,
  );
});

/** All Remotion APIs available to Agent's React code — open scope, no artificial limits */
const REMOTION_SCOPE: Record<string, unknown> = {
  React, useState, useEffect, useCallback, useMemo, useRef,
  ...Remotion,
  ...RemotionPaths,
  ...RemotionNoise,
  // @remotion/media Video/Audio: supports web-renderer export + trimBefore/trimAfter
  Audio, Video,
  // OffthreadVideo not supported in web-renderer — alias to @remotion/media Video
  OffthreadVideo: Video,
  // Override: Sequence with auto premountFor
  Sequence: AutoPremountSequence,
};
// Remove keys that are invalid as function parameter names
delete REMOTION_SCOPE['default'];
delete REMOTION_SCOPE['__esModule'];

// Babel CDN fallback (lazy-loaded only when Sucrase fails)

let _babelTransform: ((code: string, opts: any) => { code: string }) | null = null;

/** Observable loading state for UI feedback */
export type BabelStatus = 'idle' | 'loading' | 'ready' | 'error';
let _babelStatus: BabelStatus = 'idle';
let _babelError: string | null = null;
const _listeners: Set<() => void> = new Set();

export function getBabelStatus(): { status: BabelStatus; error: string | null } {
  return { status: _babelStatus, error: _babelError };
}
export function subscribeBabelStatus(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function _notify(status: BabelStatus, error?: string) {
  _babelStatus = status;
  _babelError = error ?? null;
  _listeners.forEach(fn => fn());
}

/** Load Babel from CDN (only called when Sucrase fails). 15s timeout. */
export async function preloadBabel(): Promise<void> {
  if (_babelTransform) return;
  if (_babelStatus === 'loading') {
    return new Promise<void>((resolve, reject) => {
      const unsub = subscribeBabelStatus(() => {
        if (_babelStatus === 'ready') { unsub(); resolve(); }
        else if (_babelStatus === 'error') { unsub(); reject(new Error(_babelError || 'Babel load failed')); }
      });
    });
  }
  _notify('loading');
  try {
    await new Promise<void>((resolve, reject) => {

      if ((window as any).Babel) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('Babel CDN timeout (15s)')), 15000);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js';
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load Babel from CDN')); };
      document.head.appendChild(script);
    });

    _babelTransform = (window as any).Babel.transform;
    _notify('ready');
  } catch (e) {
    _notify('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Compile code string to JS using Sucrase (fast, bundled) */
function compileSucrase(src: string): string | null {
  try {
    const { code } = sucraseTransform(src, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
    });
    return code;
  } catch {
    return null;
  }
}

/** Compile code string to JS using Babel (CDN, full syntax support) */
function compileBabel(src: string): string | null {
  if (!_babelTransform) return null;
  try {
    const result = _babelTransform(src, {
      presets: ['react', 'typescript'],
      plugins: ['proposal-optional-chaining', 'proposal-nullish-coalescing-operator'],
      filename: 'design.tsx',
    });
    return result.code;
  } catch {
    return null;
  }
}

export function normalizeRemotionScopeDeclarations(code: string): string {
  return code
    .trim()
    .replace(/^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Remotion\s*;?\s*$/gm, '')
    .replace(/^\s*(?:const|let|var)\s+Remotion\s*=\s*window\.Remotion\s*;?\s*$/gm, '')
    .replace(/\bwindow\.Remotion\./g, '')
    .replace(/\bRemotion\./g, '')
    .trim();
}

export function pickRemotionComponentName(code: string): string {
  const names = [
    ...Array.from(code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g), m => m[1]),
    ...Array.from(code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g), m => m[1]),
  ];

  const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene'];
  for (const name of preferred) {
    if (names.includes(name)) return name;
  }

  const descriptive = [...names].reverse().find(name =>
    /(?:Composition|Design)$/i.test(name) &&
    !/(?:Caption|Badge|Label|Title|Subtitle|Overlay)$/i.test(name)
  );
  if (descriptive) return descriptive;

  return names[names.length - 1] || 'Design';
}

/**
 * Transpile Agent JSX code → React component.
 * Tries Sucrase first (bundled, instant). Falls back to Babel CDN if Sucrase fails.
 */

export function evalRemotionJSX(
  code: string,
  options: {
    editableTransformMode?: EditableTransformMode;
    videoRuntime?: BrowserVideoRuntime;
  } = {},
): React.ComponentType<any> | null {
  try {
    const src = normalizeRemotionScopeDeclarations(code);

    // Try Sucrase first (bundled, no CDN dependency)
    let compiled = compileSucrase(src);

    // Fallback to Babel if Sucrase fails and Babel is loaded
    if (!compiled) {
      console.warn('[evalRemotionJSX] Sucrase failed, trying Babel...');
      compiled = compileBabel(src);
    }

    if (!compiled) {
      console.error('[evalRemotionJSX] Both Sucrase and Babel failed to compile');
      return null;
    }

    // Prefer the primary composition function. Agent code often declares helper
    // components first (Caption, Badge, etc.) and the real composition last.
    const fnName = pickRemotionComponentName(src);
    // Interactive Player previews should use the browser's native media pipeline.
    // @remotion/media's canvas/WebCodecs implementation is deterministic for
    // client-side rendering, but a newly-active trimmed clip can expose an empty
    // canvas while its seek finishes. Html5Video can premount and buffer the real
    // media element through HTTP Range requests before the cut becomes visible.
    // Poster/frame/export paths keep @remotion/media because web-renderer requires it.
    const isPreviewRuntime = options.videoRuntime === 'preview';
    const videoComponent = isPreviewRuntime
      ? PreviewVideo
      : Video;
    const editableRuntime = createEditableReactRuntime(React, videoComponent);
    const authoredScope = {
      ...REMOTION_SCOPE,
      React: editableRuntime.React,
      Video: videoComponent,
      OffthreadVideo: videoComponent,
      Sequence: isPreviewRuntime ? PreviewSequence : AutoPremountSequence,
    };
    const remotionNamespace = { ...Remotion, ...authoredScope };
    const mediaNamespace = {
      Audio,
      Video: videoComponent,
      OffthreadVideo: videoComponent,
    };
    const pathsNamespace = { ...RemotionPaths };
    const noiseNamespace = { ...RemotionNoise };
    const modules: Record<string, unknown> = {
      react: {
        ...editableRuntime.React,
        default: editableRuntime.React,
        __esModule: true,
      },
      remotion: { ...remotionNamespace, default: remotionNamespace, __esModule: true },
      '@remotion/media': { ...mediaNamespace, default: mediaNamespace, __esModule: true },
      '@remotion/paths': { ...pathsNamespace, default: pathsNamespace, __esModule: true },
      '@remotion/noise': { ...noiseNamespace, default: noiseNamespace, __esModule: true },
      three: { ...THREE, default: THREE, __esModule: true },
    };
    const localRequire = (id: string) => {
      if (id in modules) return modules[id];
      throw new Error(`Composition module "${id}" is not available in the browser Remotion runtime.`);
    };
    const authoredModule = { exports: {} as Record<string, unknown> };
    const factory = new Function(
      '__scope',
      'module',
      'exports',
      'require',
      buildRemotionEvaluatorBody(compiled, fnName),
    );
    const comp = factory(authoredScope, authoredModule, authoredModule.exports, localRequire);
    return comp
      ? editableRuntime.wrap(comp, options.editableTransformMode ?? 'proxy')
      : null;
  } catch (err) {
    console.error('[evalRemotionJSX] compile error:', err);
    return null;
  }
}
