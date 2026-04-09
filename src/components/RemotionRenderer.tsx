'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { toJpeg } from 'html-to-image';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };
export type { RenderMediaOnWebProgress };

// ─── Unified renderer: Player for both still and animation ────────────────────

interface RemotionRendererProps {
  design: DesignPayload;
  /** Called with JPEG data URL (poster for both still and animation) */
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
  /** Display mode: 'fill' for Canvas, 'inline' for CUI */
  mode?: 'fill' | 'inline';
}

export default function RemotionRenderer({ design, onComplete, onError, mode = 'inline' }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const posterCapturedRef = useRef(false);
  const initRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

  const isStill = !design.animation;
  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  // Compile design code
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    (async () => {
      preloadBabel().catch(() => {});
      const comp = evalRemotionJSX(design.code);
      if (!comp) { onError('Failed to compile design code'); return; }
      setComponent(() => comp);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  // Capture poster (frame 0) via html-to-image after Player renders
  useEffect(() => {
    if (!Component || posterCapturedRef.current) return;
    // Wait for Player to mount and images to load
    const timer = setTimeout(async () => {
      if (posterCapturedRef.current) return;
      posterCapturedRef.current = true;
      try {
        const container = playerRef.current?.getContainerNode();
        if (!container) {
          onError('Player container not available');
          return;
        }
        // Seek to frame 0 and pause for poster capture (both still and animation)
        playerRef.current?.seekTo(0);
        playerRef.current?.pause();
        console.log('🎨 [design] capturing poster via html-to-image...');
        const dataUrl = await toJpeg(container, {
          quality: 0.92,
          width: design.width,
          height: design.height,
          cacheBust: true,
        });
        console.log('🎨 [design] poster captured');
        onComplete(dataUrl);
      } catch (e) {
        console.error('🎨 [design] poster capture failed:', e);
        onError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 2000); // Wait 2s for images to load in the Player
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Component]);

  if (!Component) return null;

  const isFill = mode === 'fill';

  // Both still and animation: render Player visible (same as video)
  return (
    <div style={isFill ? { width: '100%', height: '100%' } : {
      borderRadius: 12,
      overflow: 'hidden',
      margin: '8px 0',
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
        controls={!isStill}
        loop={!isStill}
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

/** Export an animated design as MP4 blob via renderMediaOnWeb (browser-side). */
export async function exportDesignVideo(
  design: DesignPayload,
  onProgress?: (progress: RenderMediaOnWebProgress) => void,
): Promise<Blob> {
  preloadBabel().catch(() => {});
  const Component = evalRemotionJSX(design.code);
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
