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
  const storagePattern = /https?:\/\/[^\s"'`<>)}\]]*\/storage\/v1\/object\/public\/[^\s"'`<>)}\]]*/gi;
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

/** Preload Google Fonts referenced in design code so they're available before rendering. */
async function preloadFontsFromCode(code: string): Promise<void> {
  const fontUrls = new Set<string>();
  for (const m of code.matchAll(/@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com\/[^'")\s]+)['"]?\)/g))
    fontUrls.add(m[1]);
  for (const m of code.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/g))
    fontUrls.add(m[1]);
  if (fontUrls.size === 0) return;

  const fontFamilies = new Set<string>();
  await Promise.all([...fontUrls].map(async url => {
    try {
      const css = await fetch(url).then(r => r.text());
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      for (const m of css.matchAll(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/g))
        fontFamilies.add(m[1].trim());
    } catch { /* skip */ }
  }));

  // Force-load all discovered font families
  await Promise.all([...fontFamilies].map(f =>
    document.fonts.load(`1em "${f}"`).catch(() => {})
  ));
  await document.fonts.ready;
}

// ─── Standalone poster capture (no DOM needed) ─────────────────────────────

/**
 * Capture a JPEG poster from a design via renderStillOnWeb.
 * Uses Remotion's <Img> + delayRender to guarantee images are loaded.
 * Returns JPEG data URL, or empty string on failure.
 */
export async function captureDesignPoster(design: DesignPayload): Promise<string> {
  let imageBlobUrls: string[] = [];
  try {
    await preloadBabel().catch(() => {});
    const { code: resolvedCode, blobUrls } = await resolveCodeUrls(design.code);
    imageBlobUrls = blobUrls;
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
      inputProps: (design.props || {}) as Record<string, unknown>,
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
    imageBlobUrls.forEach(url => URL.revokeObjectURL(url));
  }
}

/**
 * Capture a specific frame of a design as a JPEG Blob.
 * Used by preview_frame tool — frontend renders, server polls for result.
 */
export async function captureDesignFrame(design: DesignPayload, frame: number): Promise<Blob | null> {
  let imageBlobUrls: string[] = [];
  try {
    await preloadBabel().catch(() => {});
    const { code: resolvedCode, blobUrls } = await resolveCodeUrls(design.code);
    imageBlobUrls = blobUrls;
    await preloadFontsFromCode(resolvedCode);
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
      inputProps: (design.props || {}) as Record<string, unknown>,
    });

    return result.blob;
  } catch (e) {
    console.warn('🎨 [design] frame capture failed:', e);
    return null;
  } finally {
    imageBlobUrls.forEach(url => URL.revokeObjectURL(url));
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
  onContainerRef?: (el: HTMLDivElement | null) => void;
  onPlayerRef?: (ref: PlayerRef | null) => void;
}

/** Detect iOS (iPhone/iPad) — used to cap fps for heavy designs */
const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

export default function RemotionRenderer({ design, onError, mode = 'inline', hideControls, onContainerRef, onPlayerRef }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  const isStill = !design.animation;
  // iOS: cap fps at 15 for designs with heavy code (>10KB) to prevent GPU OOM crash
  const isHeavy = design.code.length > 10000;
  const baseFps = design.animation?.fps || 30;
  const fps = (isIOS && isHeavy) ? Math.min(baseFps, 15) : baseFps;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  useEffect(() => {
    try {
      preloadBabel().catch(() => {});
      const comp = evalRemotionJSX(design.code);
      if (!comp) {
        setCompileError('Failed to compile design code');
        onError?.('Failed to compile design code');
        return;
      }
      setCompileError(null);
      setComponent(() => comp);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[RemotionRenderer] evalRemotionJSX crashed:', msg);
      setCompileError(msg);
      onError?.(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  // Expose container and player refs to parent
  useEffect(() => {
    onContainerRef?.(wrapperRef.current);
    return () => onContainerRef?.(null);
  }, [onContainerRef, Component]);

  useEffect(() => {
    onPlayerRef?.(playerRef.current);
    return () => onPlayerRef?.(null);
  }, [onPlayerRef, Component]);

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
          inputProps={design.props || {}}
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

/** Pre-fetch remote audio URLs via server proxy → blob URLs (fixes CORS + avoids massive data URLs) */
async function resolveAudioUrls(code: string): Promise<{ code: string; blobUrls: string[] }> {
  const audioUrlPattern = /<Audio[^>]+src=["']?(https?:\/\/[^"'\s>]+\.(?:mp3|wav|m4a|aac|ogg)[^"'\s>]*)["']?/g;
  const matches = [...code.matchAll(audioUrlPattern)];
  if (!matches.length) return { code, blobUrls: [] };

  let resolved = code;
  const blobUrls: string[] = [];
  for (const match of matches) {
    const url = match[1];
    try {
      // Fetch via server-side proxy to bypass CORS restrictions
      const proxyUrl = `/api/proxy-audio?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
      const blob = await res.blob();
      // Use blob URL instead of data URL — short string, same-origin, no 13MB base64
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.push(blobUrl);
      resolved = resolved.replace(url, blobUrl);
    } catch (e) {
      console.warn('[exportDesignVideo] failed to resolve audio URL:', url, e);
    }
  }
  return { code: resolved, blobUrls };
}

export async function exportDesignVideo(
  design: DesignPayload,
  onProgress?: (progress: RenderMediaOnWebProgress) => void,
): Promise<Blob> {
  preloadBabel().catch(() => {});

  // Pre-fetch remote image URLs → blob URLs (same-origin, native browser handling)
  const { code: imageResolved, blobUrls: imageBlobUrls } = await resolveCodeUrls(design.code);
  // Pre-fetch remote audio URLs → blob URLs (Suno CDN URLs may be stale/expired)
  const { code: resolvedCode, blobUrls: audioBlobUrls } = await resolveAudioUrls(imageResolved);
  // Preload Google Fonts before rendering (ensures text renders correctly)
  await preloadFontsFromCode(resolvedCode);
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
      inputProps: (design.props || {}) as Record<string, unknown>,
      videoCodec: 'h264', container: 'mp4',
      scale: 2,
      // Skip first/last 3 frames (~100ms each) to avoid black frames from fade-in/out animations
      frameRange: durationInFrames > 6 ? [3, durationInFrames - 3] : null,
      onProgress: onProgress || null,
      delayRenderTimeoutInMilliseconds: 30000,
    });

    return result.getBlob();
  } finally {
    [...imageBlobUrls, ...audioBlobUrls].forEach(url => URL.revokeObjectURL(url));
  }
}
