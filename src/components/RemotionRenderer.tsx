'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { renderStillOnWeb } from '@remotion/web-renderer';
import { evalRemotionJSX } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };

interface RemotionRendererProps {
  design: DesignPayload;
  /** Called with base64 data URL when screenshot capture completes */
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
  /** If true, auto-capture screenshot after compile (default true for stills) */
  autoCapture?: boolean;
}

/**
 * Renders Agent's React JSX design and captures a screenshot via renderStillOnWeb.
 * Uses Remotion's built-in browser renderer (no html2canvas).
 */
export default function RemotionRenderer({ design, onComplete, onError, autoCapture = true }: RemotionRendererProps) {
  const [compileError, setCompileError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const Component = useMemo(() => {
    setCompileError(null);
    const comp = evalRemotionJSX(design.code);
    if (!comp) {
      setCompileError('Failed to compile design code');
    }
    return comp;
  }, [design.code]);

  const isStill = !design.animation;
  const fps = design.animation?.fps || 30;
  const durationInFrames = design.animation
    ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
    : 1;

  // Report compile errors
  useEffect(() => {
    if (compileError) {
      onError(compileError);
    }
  }, [compileError, onError]);

  // Capture screenshot using renderStillOnWeb
  const capture = useCallback(async () => {
    if (!Component || capturing) return;
    setCapturing(true);

    try {
      console.log('🎨 [design] renderStillOnWeb starting...');

      // Pre-fetch external URLs in props to data URLs — renderStillOnWeb can't load cross-origin images
      const resolvedProps = { ...(design.props || {}) } as Record<string, unknown>;
      for (const [key, val] of Object.entries(resolvedProps)) {
        if (typeof val === 'string' && val.startsWith('http') && /\.(jpg|jpeg|png|webp|gif)/i.test(val)) {
          try {
            const res = await fetch(val);
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            resolvedProps[key] = dataUrl;
            console.log(`🎨 [design] resolved prop "${key}" URL → dataUrl (${(blob.size / 1024).toFixed(0)}KB)`);
          } catch (e) {
            console.warn(`🎨 [design] failed to resolve prop "${key}" URL:`, e);
          }
        }
      }

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
        imageFormat: 'png',
        inputProps: resolvedProps as Record<string, unknown>,
      });

      const blob = result.blob;
      console.log(`🎨 [design] renderStillOnWeb done, blob ${(blob.size / 1024).toFixed(0)}KB`);

      // Convert blob to base64 data URL
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        onComplete(dataUrl);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error('🎨 [design] renderStillOnWeb failed:', e);
      onError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [Component, capturing, design, durationInFrames, fps, onComplete, onError]);

  // Auto-capture for still designs
  useEffect(() => {
    if (isStill && autoCapture && Component && !capturing) {
      capture();
    }
  }, [isStill, autoCapture, Component, capturing, capture]);

  // No visible output — renderStillOnWeb works offscreen
  // TODO: For animated designs, render Player here (future video export)
  return null;
}

// --- PRESERVED FOR FUTURE VIDEO EXPORT ---
// import { Player, type PlayerRef } from '@remotion/player';
//
// /** Live Player mode — renders design inline without screenshot */
// export function RemotionPlayerLive({ design, onError, onReady, mode = 'inline' }: {
//   design: DesignPayload;
//   onError?: (error: string) => void;
//   onReady?: () => void;
//   mode?: 'fill' | 'inline';
// }) {
//   const playerRef = useRef<PlayerRef>(null);
//   const [compileError, setCompileError] = useState<string | null>(null);
//   const Component = useMemo(() => {
//     setCompileError(null);
//     const comp = evalRemotionJSX(design.code);
//     if (!comp) setCompileError('Failed to compile design code');
//     return comp;
//   }, [design.code]);
//   const isStill = !design.animation;
//   const fps = design.animation?.fps || 30;
//   const durationInFrames = design.animation
//     ? Math.max(1, Math.round(fps * design.animation.durationInSeconds))
//     : 1;
//   useEffect(() => { if (compileError && onError) onError(compileError); }, [compileError, onError]);
//   useEffect(() => { if (Component && onReady) onReady(); }, [Component, onReady]);
//   if (!Component) return null;
//   const isFill = mode === 'fill';
//   return (
//     <div style={isFill ? { width: '100%', height: '100%' } : { borderRadius: 12, overflow: 'hidden', margin: '8px 0' }}>
//       <Player ref={playerRef} component={Component} inputProps={design.props || {}}
//         compositionWidth={design.width} compositionHeight={design.height}
//         durationInFrames={durationInFrames} fps={fps}
//         style={isFill ? { width: '100%', height: '100%' } : { width: '100%', borderRadius: 12 }}
//         controls={!isStill} loop={!isStill} autoPlay={!isStill} acknowledgeRemotionLicense
//         errorFallback={({ error }) => (
//           <div style={{ padding: 16, color: '#f87171', fontFamily: 'monospace', fontSize: 12 }}>
//             Render error: {error.message}
//           </div>
//         )}
//       />
//     </div>
//   );
// }
