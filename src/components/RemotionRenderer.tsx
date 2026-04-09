'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { toJpeg } from 'html-to-image';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };
export type { RenderMediaOnWebProgress };

// ─── Main renderer: Player for display + html-to-image for poster ───────────

interface RemotionRendererProps {
  design: DesignPayload;
  /** Called with JPEG data URL poster after visible Player screenshot */
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
  mode?: 'fill' | 'inline';
  /** If true, auto-capture poster from visible Player then call onComplete */
  autoCapture?: boolean;
}

export default function RemotionRenderer({ design, onComplete, onError, mode = 'inline', autoCapture = false }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const initRef = useRef(false);
  const capturedRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  const isStill = !design.animation;
  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  // Compile
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    preloadBabel().catch(() => {});
    const comp = evalRemotionJSX(design.code);
    if (!comp) { onError('Failed to compile design code'); return; }
    setComponent(() => comp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.code]);

  // Auto-capture: screenshot visible Player after images load, then call onComplete
  useEffect(() => {
    if (!autoCapture || !Component || capturedRef.current) return;
    const timer = setTimeout(async () => {
      if (capturedRef.current) return;
      capturedRef.current = true;
      try {
        const container = playerRef.current?.getContainerNode();
        if (!container) { onComplete(''); return; }
        playerRef.current?.seekTo(0);
        playerRef.current?.pause();
        console.log('🎨 [design] capturing poster from visible Player...');
        const dataUrl = await toJpeg(container, {
          quality: 0.92,
          width: design.width,
          height: design.height,
          cacheBust: true,
        });
        console.log('🎨 [design] poster captured');
        setPosterUrl(dataUrl);
        onComplete(dataUrl);
      } catch (e) {
        console.warn('🎨 [design] capture failed:', e);
        onComplete('');
      }
    }, 3000); // 3s for images to load in visible Player
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture, Component]);

  if (!Component) return null;

  // After capture, show poster image instead of Player (destroy Player to save resources)
  if (posterUrl) {
    return (
      <div style={{ borderRadius: 12, overflow: 'hidden', margin: '8px 0' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={posterUrl} alt="design" style={{ width: '100%', borderRadius: 12 }} />
      </div>
    );
  }

  const isFill = mode === 'fill';

  return (
    <div style={isFill ? { width: '100%', height: '100%' } : {
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
        controls={!isStill}
        loop={!isStill}
        autoPlay={!isStill}
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
      durationInFrames, fps,
      width: design.width, height: design.height,
      id: 'agent-design-export',
      calculateMetadata: null, defaultProps: {},
    },
    inputProps: (design.props || {}) as Record<string, unknown>,
    videoCodec: 'h264', container: 'mp4',
    onProgress: onProgress || null,
  });

  return result.getBlob();
}
