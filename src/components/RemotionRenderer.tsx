'use client';

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { evalRemotionJSX } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };

interface RemotionRendererProps {
  design: DesignPayload;
  onError?: (error: string) => void;
  /** Optional: called when component successfully compiles (no screenshot) */
  onReady?: () => void;
  /** Display style: 'fill' stretches to parent, 'inline' uses width:100% with border-radius */
  mode?: 'fill' | 'inline';
}

/**
 * Renders Agent's React JSX design via Remotion Player.
 * No screenshot capture — the Player stays alive as the actual display.
 */
export default function RemotionRenderer({ design, onError, onReady, mode = 'inline' }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

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

  useEffect(() => {
    if (compileError && onError) {
      onError(compileError);
    }
  }, [compileError, onError]);

  useEffect(() => {
    if (Component && onReady) {
      onReady();
    }
  }, [Component, onReady]);

  if (!Component) return null;

  const isFill = mode === 'fill';

  return (
    <div style={isFill ? {
      width: '100%',
      height: '100%',
    } : {
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
