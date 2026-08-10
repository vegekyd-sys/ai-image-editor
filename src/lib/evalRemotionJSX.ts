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

export type { EditableTransformMode } from './editor/editable-react-runtime';

export type BrowserVideoRuntime = 'preview' | 'render';

const { Sequence, useVideoConfig } = Remotion;

const VIDEO_COMPONENT_CALL = /(?:React\.)?createElement\(\s*(?:Video|OffthreadVideo|Html5Video)\b/;
const componentContainsVideoCache = new WeakMap<object, boolean>();

type PreviewMediaReadiness = {
  captureLastFrame: boolean;
  markPending: () => void;
  markReady: () => void;
  requirePlaybackAdvance: boolean;
  showLastFrame: boolean;
};

const PreviewMediaReadinessContext = React.createContext<PreviewMediaReadiness | null>(null);

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
  const {
    className,
    crossOrigin,
    onCanPlay,
    onLoadedData,
    onPlaying,
    onSeeked,
    onTimeUpdate,
    playbackRate = 1,
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

  React.useEffect(() => {
    reportedReady.current = false;
    readiness?.markPending();
  }, [readiness?.markPending, src]);

  const setVideoRef = React.useCallback((video: HTMLVideoElement | null) => {
    videoElementRef.current = video;
    if (typeof ref === 'function') ref(video);
    else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = video;
  }, [ref]);

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
      canvas.getContext('2d', { alpha: false })?.drawImage(video, 0, 0, width, height);
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
    if (readiness.showLastFrame) return;

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
  }, [drawVideoFrame, readiness?.captureLastFrame, readiness?.showLastFrame]);

  const markReady = React.useCallback((video: HTMLVideoElement) => {
    if (reportedReady.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    // loadeddata/canplay can fire for source time 0 before Remotion's trim seek
    // has completed. Do not reveal the scene until the decoded frame is close
    // to the range-local frame that the composition currently expects.
    const allowedDrift = Math.max(0.35, 4 / fps);
    if (Math.abs(video.currentTime - expectedTime) > allowedDrift) return;
    if (video.currentTime < minimumRevealTime) return;

    reportedReady.current = true;
    readiness?.markReady();
  }, [expectedTime, fps, minimumRevealTime, readiness]);

  const handleCanPlay = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    onCanPlay?.(event);
  }, [markReady, onCanPlay]);

  const handleLoadedData = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    onLoadedData?.(event);
  }, [markReady, onLoadedData]);

  const handlePlaying = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    onPlaying?.(event);
  }, [markReady, onPlaying]);

  const handleSeeked = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    markReady(event.currentTarget);
    onSeeked?.(event);
  }, [markReady, onSeeked]);

  const handleTimeUpdate = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (readiness?.captureLastFrame && !readiness.showLastFrame) drawVideoFrame();
    markReady(event.currentTarget);
    onTimeUpdate?.(event);
  }, [drawVideoFrame, markReady, onTimeUpdate, readiness]);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Remotion.Html5Video, {
      ...rest,
      className,
      crossOrigin: crossOrigin ?? 'anonymous',
      playbackRate,
      src,
      startFrom,
      style,
      trimBefore,
      ref: setVideoRef,
      onCanPlay: handleCanPlay,
      onLoadedData: handleLoadedData,
      onPlaying: handlePlaying,
      onSeeked: handleSeeked,
      onTimeUpdate: handleTimeUpdate,
    }),
    React.createElement('canvas', {
      'aria-hidden': true,
      className,
      ref: frameCanvasRef,
      style: {
        ...style,
        display: readiness?.showLastFrame ? style?.display : 'none',
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
  const continuityFrames = canHoldLastFrame
    ? (props.postmountFor ?? fps * 3)
    : 0;
  const lastRealMediaFrameBoundary = canHoldLastFrame
    ? Math.min(authoredDuration, mediaDuration ?? authoredDuration)
    : authoredDuration;
  const showLastFrameAt = canHoldLastFrame
    ? Math.max(1, lastRealMediaFrameBoundary - 2)
    : authoredDuration;
  const captureLeadFrames = Math.max(4, Math.round(fps * 0.5));
  const captureLastFrameAt = canHoldLastFrame
    ? Math.max(0, showLastFrameAt - captureLeadFrames)
    : authoredDuration;
  const relativeFrame = frame - (props.from ?? 0);
  const captureLastFrame = canHoldLastFrame && relativeFrame >= captureLastFrameAt;
  const showLastFrame = canHoldLastFrame && relativeFrame >= showLastFrameAt;
  const isContinuingPastCut = canHoldLastFrame && relativeFrame >= authoredDuration;
  const readiness = React.useMemo(
    () => ({
      captureLastFrame: Boolean(parentReadiness?.captureLastFrame || captureLastFrame),
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
      premountFor: props.premountFor ?? fps * 3,
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
