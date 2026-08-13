'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderStillOnWeb, renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import { EDITABLE_RUNTIME_SELECTOR } from '@/lib/editor/scene-registry';
import type { DesignPayload } from '@/types';
import {
  prepareAndLoadRemotionFontsWithTiming,
  prepareRemotionFontCodeFromBundledCatalog,
  type RemotionFontTiming,
} from '@/remotion/font-catalog';
import { useLocale } from '@/lib/i18n';
import {
  isRecoverableRemotionPreviewError,
  reportRemotionPreviewError,
  type RemotionPreviewErrorPhase,
} from '@/lib/remotion-preview-errors';

export type { DesignPayload };
export type { RenderMediaOnWebProgress };

/** Resolve HTTP image URLs in code to blob URLs (same-origin, no base64 overhead).
 *  Caller must revoke blobUrls after use. */
type ResourceFailureReporter = (url: string, error: unknown) => void;

async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Image fetch returned ${contentType || 'an unknown content type'}`);
  }
  return response.blob();
}

async function resolveCodeUrls(
  code: string,
  onFailure?: ResourceFailureReporter,
): Promise<{ code: string; blobUrls: string[] }> {
  const urlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(jpg|jpeg|png|webp|gif)([^\s"'`<>)}\]]*)/gi;
  // Match Supabase storage URLs but exclude audio files (.mp3/.wav etc) — those are handled by resolveAudioUrls
  const storagePattern = /https?:\/\/[^\s"'`<>)}\]]*\/storage\/v1\/object\/public\/(?![^\s"'`<>)}\]]*\.(?:mp3|wav|m4a|aac|ogg|mp4|webm|mov))[^\s"'`<>)}\]]*/gi;
  const urls = new Set<string>();
  for (const m of code.matchAll(urlPattern)) urls.add(m[0]);
  for (const m of code.matchAll(storagePattern)) urls.add(m[0]);
  if (urls.size === 0) return { code, blobUrls: [] };
  let resolved = code;
  const blobUrls: string[] = [];
  await Promise.all([...urls].map(async (url) => {
    try {
      const blob = await fetchImageBlob(url);
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      while (resolved.includes(url)) resolved = resolved.replace(url, blobUrl);
    } catch (error) {
      onFailure?.(url, error);
    }
  }));
  return { code: resolved, blobUrls };
}

function isImageUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^https?:\/\//i.test(value)
    && (
      /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(value)
      || (/\/storage\/v1\/object\/public\//i.test(value) && !/\.(?:mp3|wav|m4a|aac|ogg|mp4|webm|mov)(?:[?#].*)?$/i.test(value))
    );
}

async function resolveImageUrlsInValue(
  value: unknown,
  blobUrls: string[],
  cache?: Map<string, string>,
  onFailure?: ResourceFailureReporter,
): Promise<unknown> {
  if (isImageUrl(value)) {
    try {
      const cached = cache?.get(value);
      if (cached) return cached;
      const blob = await fetchImageBlob(value);
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      cache?.set(value, blobUrl);
      return blobUrl;
    } catch (error) {
      onFailure?.(value, error);
      return value;
    }
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => resolveImageUrlsInValue(item, blobUrls, cache, onFailure)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [
        key,
        await resolveImageUrlsInValue(child, blobUrls, cache, onFailure),
      ] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function resolveDesignImageUrls(
  design: DesignPayload,
  code: string,
): Promise<{ code: string; props: Record<string, unknown>; blobUrls: string[] }> {
  const { code: resolvedCode, blobUrls: codeBlobUrls } = await resolveCodeUrls(code);
  const propBlobUrls: string[] = [];
  const props = await resolveImageUrlsInValue(design.props || {}, propBlobUrls) as Record<string, unknown>;
  return { code: resolvedCode, props, blobUrls: [...codeBlobUrls, ...propBlobUrls] };
}

// The query revision prevents previously cached host-bound manifests from
// sending LAN clients back to localhost.
const BROWSER_FONT_MANIFEST_URL = '/api/remotion/fonts?browser-manifest=relative-v1';
const INTERACTIVE_FONT_WAIT_MS = 500;

export interface BrowserRemotionFontTiming {
  source: 'player' | 'poster' | 'preview-frame' | 'web-export';
  recordedAt: string;
  timing: RemotionFontTiming;
}

function recordBrowserFontTiming(entry: BrowserRemotionFontTiming): void {
  const target = window as typeof window & {
    __MAKARON_REMOTION_FONT_TIMINGS__?: BrowserRemotionFontTiming[];
  };
  const existing = target.__MAKARON_REMOTION_FONT_TIMINGS__ || [];
  target.__MAKARON_REMOTION_FONT_TIMINGS__ = [...existing.slice(-19), entry];
  window.dispatchEvent(new CustomEvent('makaron:remotion-font-timing', { detail: entry }));
}

async function compileBrowserDesign(
  design: DesignPayload,
  code: string,
  props: Record<string, unknown>,
  source: BrowserRemotionFontTiming['source'],
): Promise<React.ComponentType<Record<string, unknown>>> {
  const { prepared, timing } = await prepareAndLoadRemotionFontsWithTiming({
    code,
    props,
    manifestUrl: BROWSER_FONT_MANIFEST_URL,
    substitutions: design.fontSubstitutions,
  });
  recordBrowserFontTiming({ source, recordedAt: new Date().toISOString(), timing });
  const Component = evalRemotionJSX(prepared.code, {
    editableTransformMode: 'proxy',
    videoRuntime: source === 'player' ? 'preview' : 'render',
  });
  if (!Component) throw new Error('Failed to compile design code');

  return wrapBrowserDesign(Component, prepared.defaultFontFamily);
}

function wrapBrowserDesign(
  Component: React.ComponentType<Record<string, unknown>>,
  fontFamily: string,
): React.ComponentType<Record<string, unknown>> {
  return function BrowserDesign(componentProps: Record<string, unknown>) {
    return React.createElement(
      'div',
      { style: { width: '100%', height: '100%', fontFamily } },
      React.createElement(Component, componentProps),
    );
  };
}

function compileBrowserDesignWithDeferredPinnedFonts(
  design: DesignPayload,
  code: string,
  props: Record<string, unknown>,
): React.ComponentType<Record<string, unknown>> {
  const prepared = prepareRemotionFontCodeFromBundledCatalog({
    code,
    props,
    substitutions: design.fontSubstitutions,
  });
  const Component = evalRemotionJSX(prepared.code, {
    editableTransformMode: 'proxy',
    videoRuntime: 'preview',
  });
  if (!Component) throw new Error('Failed to compile design code');
  return wrapBrowserDesign(Component, prepared.defaultFontFamily);
}

// ─── Standalone poster capture (no DOM needed) ─────────────────────────────

/**
 * Capture a JPEG poster from a design via renderStillOnWeb.
 * Uses Remotion's <Img> + delayRender to guarantee images are loaded.
 * Returns JPEG data URL, or empty string on failure.
 */
export async function captureDesignPoster(design: DesignPayload): Promise<string> {
  let allBlobUrls: string[] = [];
  try {
    await preloadBabel().catch(() => {});
    // Resolve video URLs first (mp4/webm → blob for same-origin access)
    const { code: videoResolved, blobUrls: videoBlobUrls } = await resolveVideoUrls(design.code);
    // Then resolve image URLs in both code literals and editable props.
    const { code: resolvedCode, props: resolvedProps, blobUrls: imageBlobUrls } = await resolveDesignImageUrls(design, videoResolved);
    allBlobUrls = [...videoBlobUrls, ...imageBlobUrls];
    const comp = await compileBrowserDesign(design, resolvedCode, resolvedProps, 'poster');

    const fps = design.animation?.fps || 30;
    const durationInFrames = design.animation
      ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
      : 1;

    console.log('🎨 [design] capturing poster via renderStillOnWeb...');
    const result = await renderStillOnWeb({
      composition: {
        component: comp,
        durationInFrames, fps,
        width: design.width, height: design.height,
        id: 'agent-design-poster',
        calculateMetadata: null, defaultProps: {},
      },
      frame: Math.min(30, durationInFrames - 1),
      inputProps: resolvedProps,
      delayRenderTimeoutInMilliseconds: 30000,
    });
    const posterBlob = await result.blob({ format: 'jpeg' });

    const dataUrl = await new Promise<string>((r) => {
      const reader = new FileReader();
      reader.onloadend = () => r(reader.result as string);
      reader.readAsDataURL(posterBlob);
    });
    console.log('🎨 [design] poster captured');
    return dataUrl;
  } catch (e) {
    console.warn('🎨 [design] poster capture failed:', e);
    return '';
  } finally {
    allBlobUrls.forEach(url => URL.revokeObjectURL(url));
  }
}

/**
 * Capture a specific frame of a design as a JPEG Blob.
 * Used by preview_frame tool — frontend renders, server polls for result.
 */
export async function captureDesignFrame(design: DesignPayload, frame: number): Promise<Blob | null> {
  let allBlobUrls: string[] = [];
  try {
    await preloadBabel().catch(() => {});
    const { code: videoResolved, blobUrls: videoBlobUrls } = await resolveVideoUrls(design.code);
    const { code: resolvedCode, props: resolvedProps, blobUrls: imageBlobUrls } = await resolveDesignImageUrls(design, videoResolved);
    allBlobUrls = [...videoBlobUrls, ...imageBlobUrls];
    const comp = await compileBrowserDesign(design, resolvedCode, resolvedProps, 'preview-frame');

    const fps = design.animation?.fps || 30;
    const durationInFrames = design.animation
      ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
      : 1;

    const result = await renderStillOnWeb({
      composition: {
        component: comp,
        durationInFrames, fps,
        width: design.width, height: design.height,
        id: 'agent-design-frame',
        calculateMetadata: null, defaultProps: {},
      },
      frame: Math.min(frame, durationInFrames - 1),
      inputProps: resolvedProps,
      delayRenderTimeoutInMilliseconds: 30000,
    });

    return result.blob({ format: 'jpeg' });
  } catch (e) {
    console.warn('🎨 [design] frame capture failed:', e);
    return null;
  } finally {
    allBlobUrls.forEach(url => URL.revokeObjectURL(url));
  }
}

// ─── Error Boundary (prevents design crash from taking down the whole page) ──

function PreviewPlayerErrorFallback({
  error,
  fallback,
  onError,
}: {
  error: Error;
  fallback: React.ReactNode;
  onError: (error: Error) => void;
}) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    onErrorRef.current(error);
  }, [error]);
  return fallback;
}

class DesignErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; onError?: (msg: string) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[RemotionRenderer] ErrorBoundary caught:', error);
    this.props.onError?.(error.message);
  }
  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

// ─── Player component (for interactive playback only) ───────────────────────

interface RemotionRendererProps {
  design: DesignPayload;
  onError?: (error: string) => void;
  mode?: 'fill' | 'inline';
  hideControls?: boolean;
  posterImage?: string;
  onLoading?: (loading: boolean) => void;
  onContainerRef?: (el: HTMLDivElement | null) => void;
  onPlayerRef?: (ref: PlayerRef | null) => void;
  onContentSize?: (size: { width: number; height: number; source: 'editables' | 'scroll' }) => void;
  projectId?: string;
  snapshotId?: string;
}

export default function RemotionRenderer({
  design,
  onError,
  mode = 'inline',
  hideControls,
  posterImage,
  onLoading,
  onContainerRef,
  onPlayerRef,
  onContentSize,
  projectId,
  snapshotId,
}: RemotionRendererProps) {
  const { t } = useLocale();
  const playerRef = useRef<PlayerRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onPlayerRefRef = useRef(onPlayerRef);
  const onErrorRef = useRef(onError);
  const reportContextRef = useRef({ projectId, snapshotId });
  const designPropsRef = useRef(design.props || {});
  const inputPropImageCacheRef = useRef(new Map<string, string>());
  onErrorRef.current = onError;
  reportContextRef.current = { projectId, snapshotId };
  designPropsRef.current = design.props || {};

  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [inputProps, setInputProps] = useState<Record<string, unknown>>(design.props || {});
  const [compileError, setCompileError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const reportPreviewFailureRef = useRef((
    phase: RemotionPreviewErrorPhase,
    error: unknown,
    options: { recovered: boolean; resourceUrl?: string },
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    onErrorRef.current?.(message);
    reportRemotionPreviewError({
      ...reportContextRef.current,
      phase,
      error,
      recovered: options.recovered,
      resourceUrl: options.resourceUrl,
    });
  });

  const isStill = !design.animation;
  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;
  useEffect(() => {
    let cancelled = false;
    const blobUrls: string[] = [];
    onLoading?.(true);
    (async () => {
      try {
        await preloadBabel().catch(() => {});
        // PreviewVideo owns the direct -> proxy -> direct-retry recovery cycle.
        // Rewriting the authored URL here would start permanently on the proxy
        // and prevent both browser-cache reuse and the direct recovery path.
        const videoResolved = design.code;
        const { code: resolvedCode, blobUrls: imageBlobUrls } = await resolveCodeUrls(
          videoResolved,
          (resourceUrl, error) => reportPreviewFailureRef.current(
            'image-fetch',
            error,
            { recovered: true, resourceUrl },
          ),
        );
        blobUrls.push(...imageBlobUrls);
        if (cancelled) { blobUrls.forEach(url => URL.revokeObjectURL(url)); return; }
        const fontCompile = compileBrowserDesign(
          design,
          resolvedCode,
          designPropsRef.current,
          'player',
        ).then(
          component => ({ component, error: null as unknown }),
          error => ({ component: null, error }),
        );
        const fontResult = await Promise.race([
          fontCompile,
          new Promise<null>(resolve => {
            setTimeout(() => resolve(null), INTERACTIVE_FONT_WAIT_MS);
          }),
        ]);

        let comp: React.ComponentType<Record<string, unknown>>;
        if (fontResult?.component) {
          comp = fontResult.component;
        } else {
          // A slow font manifest must not make the preview play button inert.
          // Compile the same versioned family names immediately: generic
          // fallbacks render first, then the existing DOM reflows in place as
          // FontFace entries arrive. The Player and media nodes stay mounted.
          comp = compileBrowserDesignWithDeferredPinnedFonts(
            design,
            resolvedCode,
            designPropsRef.current,
          );
          if (fontResult?.error) {
            reportPreviewFailureRef.current('font-load', fontResult.error, { recovered: true });
          } else {
            void fontCompile.then(result => {
              if (result.error && isRecoverableRemotionPreviewError(result.error)) {
                reportPreviewFailureRef.current('font-load', result.error, { recovered: true });
              }
            });
          }
        }
        if (cancelled) { blobUrls.forEach(url => URL.revokeObjectURL(url)); return; }
        setCompileError(null);
        setComponent(() => comp);
        onLoading?.(false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[RemotionRenderer] init failed:', msg);
        setCompileError(msg);
        reportPreviewFailureRef.current('player-init', e, { recovered: false });
        onLoading?.(false);
      }
    })();
    return () => {
      cancelled = true;
      blobUrls.forEach(url => URL.revokeObjectURL(url));
    };

  }, [design.code, design.fontSubstitutions, retryToken]);

  // Editable text/media/transform changes should update Player input props
  // without recompiling the composition, fonts, and code.
  useEffect(() => {
    let cancelled = false;
    const newBlobUrls: string[] = [];
    const discardNewBlobUrls = () => {
      const discarded = new Set(newBlobUrls);
      inputPropImageCacheRef.current.forEach((blobUrl, sourceUrl) => {
        if (discarded.has(blobUrl)) inputPropImageCacheRef.current.delete(sourceUrl);
      });
      newBlobUrls.forEach(url => URL.revokeObjectURL(url));
    };
    (async () => {
      const resolved = await resolveImageUrlsInValue(
        design.props || {},
        newBlobUrls,
        inputPropImageCacheRef.current,
        (resourceUrl, error) => reportPreviewFailureRef.current(
          'image-fetch',
          error,
          { recovered: true, resourceUrl },
        ),
      ) as Record<string, unknown>;
      if (cancelled) {
        discardNewBlobUrls();
        return;
      }
      setInputProps(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [design.props]);

  useEffect(() => () => {
    inputPropImageCacheRef.current.forEach(url => URL.revokeObjectURL(url));
    inputPropImageCacheRef.current.clear();
  }, []);

  // Expose container and player refs to parent
  useEffect(() => {
    onContainerRef?.(wrapperRef.current);
    return () => onContainerRef?.(null);
  }, [onContainerRef, Component]);

  useEffect(() => {
    onPlayerRefRef.current = onPlayerRef;
  }, [onPlayerRef]);

  const setPlayerRef = useCallback((player: PlayerRef | null) => {
    if (!player && playerRef.current) playerRef.current.pause();
    playerRef.current = player;
    // A useEffect can run before @remotion/player assigns its imperative ref,
    // leaving the visible play button inert until an unrelated rerender. A
    // callback ref publishes the Player synchronously on the actual mount.
    onPlayerRefRef.current?.(player);
  }, []);

  // Static long designs are easy for the Agent to under-size. Measure the
  // rendered editable layer in the browser and let the parent expand height.
  useEffect(() => {
    if (!Component || design.animation || !onContentSize) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let raf1 = 0;
    let raf2 = 0;

    const measure = () => {
      if (cancelled) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const scale = wrapperRect.width > 0 ? wrapperRect.width / design.width : 1;
      if (!Number.isFinite(scale) || scale <= 0) return;

      let maxBottom = 0;
      let maxRight = 0;
      const editables = wrapper.querySelectorAll<HTMLElement>(EDITABLE_RUNTIME_SELECTOR);
      editables.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return;
        maxBottom = Math.max(maxBottom, (rect.bottom - wrapperRect.top) / scale);
        maxRight = Math.max(maxRight, (rect.right - wrapperRect.left) / scale);
      });

      const scrollHeight = wrapper.scrollHeight / scale;
      const scrollWidth = wrapper.scrollWidth / scale;
      const measuredHeight = Math.ceil(Math.max(maxBottom, scrollHeight, design.height));
      const measuredWidth = Math.ceil(Math.max(maxRight, scrollWidth, design.width));
      const source = maxBottom > scrollHeight ? 'editables' : 'scroll';
      onContentSize({ width: measuredWidth, height: measuredHeight, source });
    };

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });
    timeoutId = setTimeout(measure, 300);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && wrapperRef.current) {
      observer = new ResizeObserver(measure);
      observer.observe(wrapperRef.current);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (timeoutId) clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [Component, design.animation, design.code, design.height, design.props, design.width, onContentSize]);

  // Pause Remotion Player when a MusicCard starts playing
  useEffect(() => {
    const handler = () => { playerRef.current?.pause(); };
    document.addEventListener('music-play', handler);
    return () => document.removeEventListener('music-play', handler);
  }, []);

  const previewFallback = (
    <div className="relative flex h-full min-h-[180px] w-full items-center justify-center overflow-hidden bg-black">
      {posterImage && (
        <img
          src={posterImage}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/80 px-4 py-3 backdrop-blur-sm">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{t('canvas.previewUnavailable')}</div>
          <div className="mt-0.5 text-xs text-white/50">{t('canvas.previewUsingPoster')}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setCompileError(null);
            setComponent(null);
            setRetryToken(token => token + 1);
          }}
          className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
        >
          {t('canvas.previewRetry')}
        </button>
      </div>
    </div>
  );

  if (compileError) {
    return previewFallback;
  }

  if (!Component) return null;

  const isFill = mode === 'fill';

  return (
    <DesignErrorBoundary
      key={retryToken}
      fallback={previewFallback}
      onError={(message) => {
        reportPreviewFailureRef.current('player-runtime', message, { recovered: false });
      }}
    >
      <div ref={wrapperRef} style={isFill ? { width: '100%', height: '100%' } : {
        borderRadius: 12, overflow: 'hidden', margin: '8px 0',
      }}>
        <Player
          ref={setPlayerRef}
          component={Component}
          inputProps={inputProps}
          compositionWidth={design.width}
          compositionHeight={design.height}
          durationInFrames={durationInFrames}
          fps={fps}
          style={isFill
            ? { width: '100%', height: '100%' }
            : { width: '100%', borderRadius: 12 }
          }
          controls={!isStill && !hideControls}
          loop={false}
          autoPlay={false}
          acknowledgeRemotionLicense
          // Poster: show snapshot image while buffering / before play — prevents blank frames
          renderPoster={posterImage ? () => (
            <img src={posterImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : undefined}
          showPosterWhenUnplayed={!!posterImage}
          showPosterWhenBuffering={false}
          posterFillMode="player-size"
          bufferStateDelayInMilliseconds={0}
          errorFallback={({ error }) => (
            <PreviewPlayerErrorFallback
              error={error}
              fallback={previewFallback}
              onError={(playerError) => {
                reportPreviewFailureRef.current('player-runtime', playerError, { recovered: false });
              }}
            />
          )}
        />
      </div>
    </DesignErrorBoundary>
  );
}

// ─── MP4 Export ──────────────────────────────────────────────────────────────

// Session-level cache: video URL → blob URL (avoids re-downloading on timeline switch)
const videoBlobCache = new Map<string, string>();

/** Pre-fetch remote video URLs via server proxy → blob URLs (fixes CORS for renderMediaOnWeb) */
async function resolveVideoUrls(code: string): Promise<{ code: string; blobUrls: string[] }> {
  const videoExtPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(mp4|webm|mov)([^\s"'`<>)}\]]*)/gi;
  const urls = new Set<string>();
  for (const m of code.matchAll(videoExtPattern)) urls.add(m[0]);
  if (urls.size === 0) return { code, blobUrls: [] };
  let resolved = code;
  await Promise.all([...urls].map(async (url) => {
    try {
      const cached = videoBlobCache.get(url);
      if (cached) {
        while (resolved.includes(url)) resolved = resolved.replace(url, cached);
        return;
      }
      const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(url)}&full=1`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Video proxy failed: ${res.status}`);
      const contentType = res.headers.get('Content-Type') || '';
      if (!contentType.startsWith('video/') && !contentType.includes('octet-stream')) {
        throw new Error(`Video proxy returned non-video content: ${contentType}`);
      }
      const blob = await res.blob();
      if (blob.size < 1000) {
        throw new Error(`Video blob too small (${blob.size} bytes), likely error page`);
      }
      const videoBlob = new Blob([blob], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(videoBlob);
      videoBlobCache.set(url, blobUrl);
      while (resolved.includes(url)) resolved = resolved.replace(url, blobUrl);
    } catch (e) {
      console.error('[resolveVideoUrls] failed:', url, e);
    }
  }));
  // blobUrls empty — lifecycle managed by videoBlobCache, not caller
  return { code: resolved, blobUrls: [] };
}

async function resolveAudioUrls(code: string): Promise<{ code: string; blobUrls: string[] }> {
  // Strip blob: audio URLs (expired after refresh) — both JSX and createElement forms
  const cleaned = code
    .replace(/<Audio[^>]*src=["']?blob:[^>]*\/>/g, '')
    .replace(/React\.createElement\(Audio,\s*\{[^}]*src:\s*"blob:[^"]*"[^)]*\)\s*,?/g, '');
  // Match audio URLs in both <Audio src="..."> and React.createElement(Audio, { src: "..." }) forms
  // Covers: .mp3/.wav etc extensions + known audio domains (Suno streamAudioUrl has no extension)
  const audioUrlPattern = /(?:<Audio[^>]+src=["']?|React\.createElement\(Audio,\s*\{[^}]*src:\s*")(https?:\/\/[^"'\s>]+\.(?:mp3|wav|m4a|aac|ogg)[^"'\s>]*|https?:\/\/(?:musicfile\.removeai\.ai|tempfile\.aiquickdraw\.com|cdn\d*\.suno\.ai)\/[^"'\s>)]+)/g;
  const matches = [...cleaned.matchAll(audioUrlPattern)];
  if (!matches.length) return { code: cleaned, blobUrls: [] };

  let resolved = cleaned;
  const blobUrls: string[] = [];
  for (const match of matches) {
    const url = match[1];
    try {
      const proxyUrl = `/api/proxy-audio?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      resolved = resolved.replace(url, blobUrl);
    } catch (e) {
      console.warn('[resolveAudioUrls] failed to resolve, stripping Audio element:', url, e);
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Strip JSX form: <Audio ... src="url" ... />
      resolved = resolved.replace(new RegExp(`<Audio[^]*?${esc}[^]*?/>`, 'g'), '');
      // Strip createElement form: React.createElement(Audio, { src: "url" ... }),
      resolved = resolved.replace(new RegExp(`React\\.createElement\\(Audio,\\s*\\{[^)]*${esc}[^)]*\\)\\s*,?`, 'g'), '');
    }
  }
  return { code: resolved, blobUrls };
}

/** Detect pure video-wrapper design (only <Video>/<OffthreadVideo> inside <AbsoluteFill>, no overlays) */
function extractSingleVideoUrl(code: string): string | null {
  const videoMatches = code.match(/<(?:Video|OffthreadVideo)\s[^>]*src=["']([^"']+)["']/g);
  if (!videoMatches || videoMatches.length !== 1) return null;
  const srcMatch = videoMatches[0].match(/src=["']([^"']+)["']/);
  if (!srcMatch) return null;
  if (/<Img\s/.test(code) || /<Audio\s/.test(code) || /<Text[\s>]/.test(code)) return null;
  if (/>[^<]*[a-zA-Z一-鿿]/.test(code.replace(/<(?:Video|OffthreadVideo)[^>]*\/>/, '').replace(/function\s+Design[^{]*\{/, ''))) return null;
  return srcMatch[1];
}

export async function exportDesignVideo(
  design: DesignPayload,
  onProgress?: (progress: RenderMediaOnWebProgress) => void,
): Promise<Blob> {
  // Pure video design → download source mp4 directly (no Remotion render needed)
  const singleVideoUrl = extractSingleVideoUrl(design.code);
  if (singleVideoUrl) {
    const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(singleVideoUrl)}&full=1`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`Video download failed: ${res.status}`);
    return res.blob();
  }

  preloadBabel().catch(() => {});

  // Pre-fetch remote video URLs → blob URLs (renderMediaOnWeb requires same-origin)
  const { code: videoResolved, blobUrls: videoBlobUrls } = await resolveVideoUrls(design.code);
  // Pre-fetch remote image URLs → blob URLs (same-origin, native browser handling)
  const { code: imageResolved, props: resolvedProps, blobUrls: imageBlobUrls } = await resolveDesignImageUrls(design, videoResolved);
  // Pre-fetch remote audio URLs → blob URLs (Suno CDN URLs may be stale/expired)
  const { code: resolvedCode, blobUrls: audioBlobUrls } = await resolveAudioUrls(imageResolved);
  const Component = await compileBrowserDesign(design, resolvedCode, resolvedProps, 'web-export');

  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  try {
    const result = await renderMediaOnWeb({
      composition: {
        component: Component,
        durationInFrames, fps,
        width: design.width, height: design.height,
        id: 'agent-design-export',
        calculateMetadata: null, defaultProps: {},
      },
      inputProps: resolvedProps,
      videoCodec: 'h264', container: 'mp4',
      scale: 2,
      onProgress: onProgress || null,
      delayRenderTimeoutInMilliseconds: 30000,
    });

    return result.getBlob();
  } finally {
    [...videoBlobUrls, ...imageBlobUrls, ...audioBlobUrls].forEach(url => URL.revokeObjectURL(url));
  }
}
