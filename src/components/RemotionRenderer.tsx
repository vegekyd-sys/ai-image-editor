'use client';

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderStillOnWeb, renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';
// Sucrase is bundled — no preload needed. Babel loaded on-demand only if Sucrase fails.

export type { DesignPayload };

/** Helper: fetch a URL to data URL */
async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** Resolve all HTTP image/audio URLs in a code string to data URLs (cross-origin workaround) */
async function resolveCodeUrls(code: string): Promise<string> {
  // Find all HTTP URLs in the code (inside quotes or template literals)
  const urlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(jpg|jpeg|png|webp|gif|mp3|wav|m4a|aac|ogg)([^\s"'`<>)}\]]*)/gi;
  // Also match Supabase storage URLs that may not end with extensions
  const storagePattern = /https?:\/\/[^\s"'`<>)}\]]*\/storage\/v1\/object\/public\/[^\s"'`<>)}\]]*/gi;

  const urls = new Set<string>();
  for (const m of code.matchAll(urlPattern)) urls.add(m[0]);
  for (const m of code.matchAll(storagePattern)) urls.add(m[0]);

  if (urls.size === 0) return code;

  let resolved = code;
  await Promise.all([...urls].map(async (url) => {
    try {
      const dataUrl = await urlToDataUrl(url);
      // Replace all occurrences
      while (resolved.includes(url)) {
        resolved = resolved.replace(url, dataUrl);
      }
      console.log(`🎨 [design] resolved code URL → dataUrl (${url.substring(0, 60)}...)`);
    } catch (e) {
      console.warn(`🎨 [design] failed to resolve code URL: ${url.substring(0, 60)}`, e);
    }
  }));

  return resolved;
}

/** Helper: capture frame 0 as JPEG data URL via renderStillOnWeb */
async function captureStill(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: React.ComponentType<any>,
  design: DesignPayload,
  resolvedProps: Record<string, unknown>,
): Promise<string> {
  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  const result = await renderStillOnWeb({
    composition: {
      component: Component,
      durationInFrames,
      fps,
      width: design.width,
      height: design.height,
      id: 'agent-design',
      calculateMetadata: null,
      defaultProps: {},
    },
    frame: 0,
    imageFormat: 'jpeg',
    inputProps: resolvedProps,
  });

  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(result.blob);
  });
}

// ─── Still-only renderer (offscreen capture) ──────────────────────────────────

interface StillRendererProps {
  design: DesignPayload;
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
}

function StillRenderer({ design, onComplete, onError }: StillRendererProps) {
  const capturingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

  // Resolve URLs in code → compile → capture
  useEffect(() => {
    if (capturingRef.current) return;
    capturingRef.current = true;
    (async () => {
      try {
        // 1. Resolve HTTP URLs in code to data URLs (cross-origin workaround)
        const resolvedCode = await resolveCodeUrls(design.code);
        // 2. Compile
        preloadBabel().catch(() => {});
        const comp = evalRemotionJSX(resolvedCode);
        if (!comp) { onError('Failed to compile design code'); return; }
        // 3. Capture
        console.log('🎨 [design] renderStillOnWeb starting...');
        const dataUrl = await captureStill(comp, { ...design, code: resolvedCode }, design.props || {});
        console.log('🎨 [design] renderStillOnWeb done');
        onComplete(dataUrl);
      } catch (e) {
        console.error('🎨 [design] renderStillOnWeb failed:', e);
        onError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  return null; // offscreen
}

// ─── Animation renderer (Player + poster capture) ────────────────────────────

interface AnimationRendererProps {
  design: DesignPayload;
  /** Called with poster image (frame 0) for persistence */
  onPoster: (dataUrl: string) => void;
  onError: (error: string) => void;
  /** Display mode: 'fill' for Canvas, 'inline' for CUI */
  mode?: 'fill' | 'inline';
}

function AnimationRenderer({ design, onPoster, onError, mode = 'inline' }: AnimationRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const posterCapturedRef = useRef(false);
  const initRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  // Poster uses resolved code (data URLs); Player uses original code (browser loads URLs natively)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [PosterComponent, setPosterComponent] = useState<React.ComponentType<any> | null>(null);

  // Compile for Player (original code — browser handles URL loading)
  // + compile for poster (resolved code — renderStillOnWeb needs data URLs)
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      preloadBabel().catch(() => {});
      // Player component (original URLs — browser loads them fine)
      const comp = evalRemotionJSX(design.code);
      if (!comp) { onError('Failed to compile design code'); return; }
      setComponent(() => comp);
      // Poster component (resolved URLs — for renderStillOnWeb Canvas)
      const resolvedCode = await resolveCodeUrls(design.code);
      const posterComp = evalRemotionJSX(resolvedCode);
      if (posterComp) setPosterComponent(() => posterComp);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  // Capture frame 0 as poster for persistence
  useEffect(() => {
    if (!PosterComponent || posterCapturedRef.current) return;
    posterCapturedRef.current = true;
    (async () => {
      try {
        const dataUrl = await captureStill(PosterComponent, design, design.props || {});
        console.log('🎨 [design] poster captured');
        onPoster(dataUrl);
      } catch (e) {
        console.warn('🎨 [design] poster capture failed, continuing with Player:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PosterComponent]);

  if (!Component) return null;

  const isFill = mode === 'fill';

  return (
    <div style={isFill ? { width: '100%', height: '100%' } : { borderRadius: 12, overflow: 'hidden', margin: '8px 0' }}>
      <Player
        ref={playerRef}
        component={Component}
        inputProps={design.props || {}}
        compositionWidth={design.width}
        compositionHeight={design.height}
        durationInFrames={durationInFrames}
        fps={fps}
        style={isFill ? { width: '100%', height: '100%' } : { width: '100%', borderRadius: 12 }}
        controls
        loop
        autoPlay
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

// ─── Main export: routes to Still or Animation ────────────────────────────────

interface RemotionRendererProps {
  design: DesignPayload;
  /** Called with image data URL (still: screenshot, animation: poster frame 0) */
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
  /** Display mode for animation Player */
  mode?: 'fill' | 'inline';
}

export default function RemotionRenderer({ design, onComplete, onError, mode = 'inline' }: RemotionRendererProps) {
  const isStill = !design.animation;

  if (isStill) {
    return <StillRenderer design={design} onComplete={onComplete} onError={onError} />;
  }

  return (
    <AnimationRenderer
      design={design}
      onPoster={onComplete}
      onError={onError}
      mode={mode}
    />
  );
}

// ─── MP4 Export (callable from Editor) ───────────────────────────────────────

export type { RenderMediaOnWebProgress };

/** Export an animated design as MP4 blob via renderMediaOnWeb (browser-side). */
export async function exportDesignVideo(
  design: DesignPayload,
  onProgress?: (progress: RenderMediaOnWebProgress) => void,
): Promise<Blob> {
  preloadBabel().catch(() => {}); // Babel as background fallback
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
      durationInFrames,
      fps,
      width: design.width,
      height: design.height,
      id: 'agent-design-export',
      calculateMetadata: null,
      defaultProps: {},
    },
    inputProps: (design.props || {}) as Record<string, unknown>,
    videoCodec: 'h264',
    container: 'mp4',
    onProgress: onProgress || null,
  });

  return result.getBlob();
}
