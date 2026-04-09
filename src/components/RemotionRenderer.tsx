'use client';

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderStillOnWeb, renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

// Pre-load Babel standalone on first import (background, non-blocking)
if (typeof window !== 'undefined') {
  preloadBabel().catch(() => {});
}

export type { DesignPayload };

/** Helper: resolve external URLs in props to data URLs (cross-origin workaround for renderStillOnWeb) */
async function resolvePropsUrls(props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resolved = { ...props };
  for (const [key, val] of Object.entries(resolved)) {
    if (typeof val === 'string' && val.startsWith('http') && /\.(jpg|jpeg|png|webp|gif)/i.test(val)) {
      try {
        const res = await fetch(val);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        resolved[key] = dataUrl;
        console.log(`🎨 [design] resolved prop "${key}" URL → dataUrl (${(blob.size / 1024).toFixed(0)}KB)`);
      } catch (e) {
        console.warn(`🎨 [design] failed to resolve prop "${key}" URL:`, e);
      }
    }
  }
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

  // Load Babel + compile (async because Babel is lazy-loaded)
  useEffect(() => {
    (async () => {
      try {
        await preloadBabel();
      } catch (e) {
        onError(`Design engine failed to load: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const comp = evalRemotionJSX(design.code);
      if (!comp) { onError('Failed to compile design code'); return; }
      setComponent(() => comp);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  useEffect(() => {
    if (!Component || capturingRef.current) return;
    capturingRef.current = true;
    (async () => {
      try {
        console.log('🎨 [design] renderStillOnWeb starting...');
        const resolvedProps = await resolvePropsUrls(design.props || {});
        const dataUrl = await captureStill(Component, design, resolvedProps);
        console.log('🎨 [design] renderStillOnWeb done');
        onComplete(dataUrl);
      } catch (e) {
        console.error('🎨 [design] renderStillOnWeb failed:', e);
        onError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Component]);

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
  const propsResolvedRef = useRef(false);
  const [resolvedProps, setResolvedProps] = useState<Record<string, unknown> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

  // Load Babel + compile (async because Babel is lazy-loaded)
  useEffect(() => {
    (async () => {
      try {
        await preloadBabel();
      } catch (e) {
        onError(`Design engine failed to load: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const comp = evalRemotionJSX(design.code);
      if (!comp) { onError('Failed to compile design code'); return; }
      setComponent(() => comp);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  // Pre-fetch URLs in props → data URLs (for both Player and poster)
  useEffect(() => {
    if (!Component || propsResolvedRef.current) return;
    propsResolvedRef.current = true;
    (async () => {
      const props = await resolvePropsUrls(design.props || {});
      setResolvedProps(props);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Component]);

  // Capture frame 0 as poster for persistence (after props resolved)
  useEffect(() => {
    if (!Component || !resolvedProps || posterCapturedRef.current) return;
    posterCapturedRef.current = true;
    (async () => {
      try {
        const dataUrl = await captureStill(Component, design, resolvedProps);
        console.log('🎨 [design] poster captured');
        onPoster(dataUrl);
      } catch (e) {
        console.warn('🎨 [design] poster capture failed, continuing with Player:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Component, resolvedProps]);

  if (!Component || !resolvedProps) return null;

  const isFill = mode === 'fill';

  return (
    <div style={isFill ? { width: '100%', height: '100%' } : { borderRadius: 12, overflow: 'hidden', margin: '8px 0' }}>
      <Player
        ref={playerRef}
        component={Component}
        inputProps={resolvedProps}
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
  await preloadBabel();
  const Component = evalRemotionJSX(design.code);
  if (!Component) throw new Error('Failed to compile design code');

  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  const resolvedProps = await resolvePropsUrls(design.props || {});

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
    inputProps: resolvedProps as Record<string, unknown>,
    videoCodec: 'h264',
    container: 'mp4',
    onProgress: onProgress || null,
  });

  return result.getBlob();
}
