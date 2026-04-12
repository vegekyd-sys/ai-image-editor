'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderStillOnWeb, renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };
export type { RenderMediaOnWebProgress };

/** Resolve HTTP image URLs in code to data URLs (CORS workaround for renderStillOnWeb) */
async function resolveCodeUrls(code: string): Promise<string> {
  const urlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(jpg|jpeg|png|webp|gif)([^\s"'`<>)}\]]*)/gi;
  const storagePattern = /https?:\/\/[^\s"'`<>)}\]]*\/storage\/v1\/object\/public\/[^\s"'`<>)}\]]*/gi;
  const urls = new Set<string>();
  for (const m of code.matchAll(urlPattern)) urls.add(m[0]);
  for (const m of code.matchAll(storagePattern)) urls.add(m[0]);
  if (urls.size === 0) return code;
  let resolved = code;
  await Promise.all([...urls].map(async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((r) => {
        const reader = new FileReader();
        reader.onloadend = () => r(reader.result as string);
        reader.readAsDataURL(blob);
      });
      while (resolved.includes(url)) resolved = resolved.replace(url, dataUrl);
    } catch { /* skip */ }
  }));
  return resolved;
}

// ─── Standalone poster capture (no DOM needed) ─────────────────────────────

/**
 * Capture a JPEG poster from a design via renderStillOnWeb.
 * Uses Remotion's <Img> + delayRender to guarantee images are loaded.
 * Returns JPEG data URL, or empty string on failure.
 */
export async function captureDesignPoster(design: DesignPayload): Promise<string> {
  try {
    await preloadBabel().catch(() => {});
    const resolvedCode = await resolveCodeUrls(design.code);
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

export default function RemotionRenderer({ design, onError, mode = 'inline', hideControls, onContainerRef, onPlayerRef }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

  const isStill = !design.animation;
  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    preloadBabel().catch(() => {});
    const comp = evalRemotionJSX(design.code);
    if (!comp) { onError?.('Failed to compile design code'); return; }
    setComponent(() => comp);
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

  if (!Component) return null;

  const isFill = mode === 'fill';

  return (
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

  // Pre-fetch remote image URLs → data URLs so <Img> doesn't need network during render
  const resolvedCode = await resolveCodeUrls(design.code);
  const Component = evalRemotionJSX(resolvedCode);
  if (!Component) throw new Error('Failed to compile design code');

  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

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
    onProgress: onProgress || null,
    delayRenderTimeoutInMilliseconds: 30000,
  });

  return result.getBlob();
}
