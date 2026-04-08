'use client';

import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { evalRemotionJSX } from '@/lib/evalRemotionJSX';
import html2canvas from 'html2canvas';
import type { DesignPayload } from '@/types';

export type { DesignPayload };

interface RemotionRendererProps {
  design: DesignPayload;
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
  /** If true, auto-capture screenshot after render (for still designs) */
  autoCapture?: boolean;
}

/**
 * Renders Agent's React JSX design and captures a screenshot.
 *
 * For still captures: renders the component in a plain <div> (not Player)
 * at native resolution, then captures with html2canvas. This avoids
 * Remotion Player's CSS transforms that html2canvas can't capture.
 *
 * For animations: uses @remotion/player with controls.
 */
export default function RemotionRenderer({ design, onComplete, onError, autoCapture = true }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Compile Agent code → React component
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

  // Auto-capture screenshot from the plain div render
  const capture = useCallback(async () => {
    if (captured || !captureRef.current) return;
    setCaptured(true);

    try {
      // Wait for fonts OR 2s timeout (Google Fonts may be blocked)
      await Promise.race([
        document.fonts.ready,
        new Promise(r => setTimeout(r, 2000)),
      ]);

      // Wait for all images inside the capture area to load
      if (captureRef.current) {
        const imgs = captureRef.current.querySelectorAll('img');
        if (imgs.length > 0) {
          await Promise.race([
            Promise.all(Array.from(imgs).map(img =>
              img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
            )),
            new Promise(r => setTimeout(r, 5000)), // 5s timeout for images
          ]);
        }
      }

      // Brief layout settle
      await new Promise(r => setTimeout(r, 300));

      // Temporarily make visible for capture (opacity:0 → html2canvas sees transparent)
      captureRef.current.style.opacity = '1';

      const canvas = await html2canvas(captureRef.current, {
        width: design.width,
        height: design.height,
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });

      onComplete(canvas.toDataURL('image/png'));
    } catch (e) {
      onError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [captured, design.width, design.height, onComplete, onError]);

  // Trigger capture after a short delay
  useEffect(() => {
    if (isStill && autoCapture && Component && !captured) {
      const timer = setTimeout(capture, 500);
      return () => clearTimeout(timer);
    }
  }, [isStill, autoCapture, Component, captured, capture]);

  // Report compile errors via onError callback (shown in CUI, not as a visible element)
  useEffect(() => {
    if (compileError) {
      onError(compileError);
    }
  }, [compileError, onError]);

  if (!Component) return null;

  // Render via Player (provides Remotion context for hooks like useCurrentFrame).
  // For capture: render at native resolution off-screen so html2canvas gets 1:1 pixels.
  // For display: render inline with width: 100%.
  const isCaptureMode = isStill && autoCapture;

  return (
    <div
      ref={captureRef}
      style={isCaptureMode ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: design.width,
        height: design.height,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none' as const,
        zIndex: -1,
      } : {
        borderRadius: 12,
        overflow: 'hidden',
        margin: '8px 0',
      }}
    >
      <Player
        ref={playerRef}
        component={Component}
        inputProps={design.props || {}}
        compositionWidth={design.width}
        compositionHeight={design.height}
        durationInFrames={durationInFrames}
        fps={fps}
        style={isCaptureMode
          ? { width: design.width, height: design.height }
          : { width: '100%', borderRadius: 12 }
        }
        controls={!isStill}
        loop={!isStill}
        autoPlay={!isStill}
        acknowledgeRemotionLicense
        errorFallback={({ error }) => (
          <div style={{ padding: 16, color: '#f87171', fontFamily: 'monospace', fontSize: 12, background: 'rgba(248,113,113,0.1)', borderRadius: 12, wordBreak: 'break-all' }}>
            Render error: {error.message}
          </div>
        )}
      />
    </div>
  );
}
