'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderStillOnWeb, renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };
export type { RenderMediaOnWebProgress };

/** Resolve HTTP image URLs in code to blob URLs (same-origin, no base64 overhead).
 *  Caller must revoke blobUrls after use. */
async function resolveCodeUrls(code: string): Promise<{ code: string; blobUrls: string[] }> {
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
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      while (resolved.includes(url)) resolved = resolved.replace(url, blobUrl);
    } catch { /* skip */ }
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

async function resolveImageUrlsInValue(value: unknown, blobUrls: string[]): Promise<unknown> {
  if (isImageUrl(value)) {
    try {
      const res = await fetch(value);
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      return blobUrl;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => resolveImageUrlsInValue(item, blobUrls)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [
        key,
        await resolveImageUrlsInValue(child, blobUrls),
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

// ─── Google Fonts auto-loading from code (same approach as server DynamicDesign.tsx) ──

import { getAvailableFonts } from '@remotion/google-fonts';

const ALL_FONTS = getAvailableFonts();
const loadedFontFamilies = new Set<string>();

/**
 * Scan code + props text for Google Font family names and load them.
 * Uses @remotion/google-fonts — the same mechanism as server-side DynamicDesign.tsx.
 * Only fonts whose family name appears in the text are loaded (lazy).
 */
async function loadGoogleFontsFromCode(code: string): Promise<void> {
  const fontsToLoad = ALL_FONTS.filter(f =>
    code.includes(f.fontFamily) && !loadedFontFamilies.has(f.fontFamily)
  );

  // Always register Noto Color Emoji so emoji characters fallback correctly
  // (decorative fonts like Great Vibes lack emoji glyphs → browser needs a registered @font-face to fallback to)
  if (!loadedFontFamilies.has('Noto Color Emoji')) {
    const emojiFont = ALL_FONTS.find(f => f.fontFamily === 'Noto Color Emoji');
    if (emojiFont) fontsToLoad.push(emojiFont);
  }

  if (fontsToLoad.length === 0) return;

  await Promise.all(fontsToLoad.map(async (font) => {
    try {
      loadedFontFamilies.add(font.fontFamily);
      const loaded = await font.load();
      const { waitUntilDone } = loaded.loadFont();
      await waitUntilDone();
    } catch (e) {
      console.warn(`[RemotionRenderer] font load failed: ${font.fontFamily}`, e);
    }
  }));
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
    await loadGoogleFontsFromCode(resolvedCode);
    const comp = evalRemotionJSX(resolvedCode);
    if (!comp) return '';

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
      imageFormat: 'jpeg',
      inputProps: resolvedProps,
      delayRenderTimeoutInMilliseconds: 30000,
    });

    const dataUrl = await new Promise<string>((r) => {
      const reader = new FileReader();
      reader.onloadend = () => r(reader.result as string);
      reader.readAsDataURL(result.blob);
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
    await loadGoogleFontsFromCode(resolvedCode);
    const comp = evalRemotionJSX(resolvedCode);
    if (!comp) return null;

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
      imageFormat: 'jpeg',
      inputProps: resolvedProps,
      delayRenderTimeoutInMilliseconds: 30000,
    });

    return result.blob;
  } catch (e) {
    console.warn('🎨 [design] frame capture failed:', e);
    return null;
  } finally {
    allBlobUrls.forEach(url => URL.revokeObjectURL(url));
  }
}

// ─── Error Boundary (prevents design crash from taking down the whole page) ──

class DesignErrorBoundary extends React.Component<
  { children: React.ReactNode; onError?: (msg: string) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[RemotionRenderer] ErrorBoundary caught:', error);
    this.props.onError?.(error.message);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#f87171', fontFamily: 'monospace', fontSize: 12, background: 'rgba(248,113,113,0.1)', borderRadius: 12 }}>
          Design crashed: {this.state.error.message}
        </div>
      );
    }
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
}

export default function RemotionRenderer({ design, onError, mode = 'inline', hideControls, posterImage, onLoading, onContainerRef, onPlayerRef }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onPlayerRefRef = useRef(onPlayerRef);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [inputProps, setInputProps] = useState<Record<string, unknown>>({});
  const [compileError, setCompileError] = useState<string | null>(null);

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
        const { code: videoResolved, blobUrls: videoBlobUrls } = await resolveVideoUrls(design.code);
        blobUrls.push(...videoBlobUrls);
        if (cancelled) { blobUrls.forEach(url => URL.revokeObjectURL(url)); return; }
        const { code: resolvedCode, props: resolvedProps, blobUrls: imageBlobUrls } = await resolveDesignImageUrls(design, videoResolved);
        blobUrls.push(...imageBlobUrls);
        if (cancelled) { blobUrls.forEach(url => URL.revokeObjectURL(url)); return; }
        await loadGoogleFontsFromCode(resolvedCode);
        if (cancelled) { blobUrls.forEach(url => URL.revokeObjectURL(url)); return; }
        const comp = evalRemotionJSX(resolvedCode);
        if (!comp) {
          setCompileError('Failed to compile design code');
          onError?.('Failed to compile design code');
          onLoading?.(false);
          return;
        }
        setCompileError(null);
        setComponent(() => comp);
        setInputProps(resolvedProps);
        onLoading?.(false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[RemotionRenderer] init failed:', msg);
        setCompileError(msg);
        onError?.(msg);
        onLoading?.(false);
      }
    })();
    return () => {
      cancelled = true;
      blobUrls.forEach(url => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code, design.props]);

  // Expose container and player refs to parent
  useEffect(() => {
    onContainerRef?.(wrapperRef.current);
    return () => onContainerRef?.(null);
  }, [onContainerRef, Component]);

  useEffect(() => {
    onPlayerRefRef.current = onPlayerRef;
  }, [onPlayerRef]);

  useEffect(() => {
    const player = playerRef.current;
    onPlayerRefRef.current?.(player);
    return () => {
      player?.pause();
      onPlayerRefRef.current?.(null);
    };
  }, [Component]);

  // Pause Remotion Player when a MusicCard starts playing
  useEffect(() => {
    const handler = () => { playerRef.current?.pause(); };
    document.addEventListener('music-play', handler);
    return () => document.removeEventListener('music-play', handler);
  }, []);

  if (compileError) {
    return (
      <div style={{ padding: 16, color: '#f87171', fontFamily: 'monospace', fontSize: 12, background: 'rgba(248,113,113,0.1)', borderRadius: 12 }}>
        Design error: {compileError}
      </div>
    );
  }

  if (!Component) return null;

  const isFill = mode === 'fill';

  return (
    <DesignErrorBoundary onError={onError}>
      <div ref={wrapperRef} style={isFill ? { width: '100%', height: '100%' } : {
        borderRadius: 12, overflow: 'hidden', margin: '8px 0',
      }}>
        <Player
          ref={playerRef}
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
            <img src={posterImage} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : undefined}
          showPosterWhenUnplayed={!!posterImage}
          showPosterWhenBuffering={false}
          posterFillMode="player-size"
          bufferStateDelayInMilliseconds={0}
          errorFallback={({ error }) => (
            <div style={{ padding: 16, color: '#f87171', fontFamily: 'monospace', fontSize: 12, background: 'rgba(248,113,113,0.1)', borderRadius: 12 }}>
              Render error: {error.message}
            </div>
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
  let cleaned = code
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
  await loadGoogleFontsFromCode(resolvedCode);
  const Component = evalRemotionJSX(resolvedCode);
  if (!Component) throw new Error('Failed to compile design code');

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
      // Skip first/last 3 frames (~100ms each) to avoid black frames from fade-in/out animations
      frameRange: durationInFrames > 6 ? [3, durationInFrames - 3] : null,
      onProgress: onProgress || null,
      delayRenderTimeoutInMilliseconds: 30000,
    });

    return result.getBlob();
  } finally {
    [...videoBlobUrls, ...imageBlobUrls, ...audioBlobUrls].forEach(url => URL.revokeObjectURL(url));
  }
}
