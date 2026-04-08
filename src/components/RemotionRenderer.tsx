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
      // Brief layout settle
      await new Promise(r => setTimeout(r, 300));

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

  if (compileError) {
    return (
      <div style={{ padding: 16, color: '#f87171', fontFamily: 'monospace', fontSize: 13, background: 'rgba(248,113,113,0.1)', borderRadius: 12, margin: '8px 0' }}>
        Code error: {compileError}
      </div>
    );
  }

  if (!Component) return null;

  // For still capture: render component directly in a native-size div (no Player transforms).
  // This div is positioned off-screen so it's invisible but html2canvas can capture it.
  if (isStill && autoCapture) {
    return (
      <div
        ref={captureRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: design.width,
          height: design.height,
          overflow: 'hidden',
        }}
      >
        <Component {...(design.props || {})} />
      </div>
    );
  }

  // For animations: use Remotion Player with controls
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', margin: '8px 0' }}>
      <Player
        ref={playerRef}
        component={Component}
        inputProps={design.props || {}}
        compositionWidth={design.width}
        compositionHeight={design.height}
        durationInFrames={durationInFrames}
        fps={fps}
        style={{ width: '100%', borderRadius: 12 }}
        controls
        loop
        autoPlay
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
