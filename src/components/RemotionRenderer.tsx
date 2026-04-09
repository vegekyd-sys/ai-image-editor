'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { renderStillOnWeb, renderMediaOnWeb, type RenderMediaOnWebProgress } from '@remotion/web-renderer';
import { evalRemotionJSX, preloadBabel } from '@/lib/evalRemotionJSX';
import type { DesignPayload } from '@/types';

export type { DesignPayload };
export type { RenderMediaOnWebProgress };

/** Helper: resolve HTTP URLs in code to data URLs (for renderStillOnWeb CORS workaround) */
async function resolveCodeUrls(code: string): Promise<string> {
  const urlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(jpg|jpeg|png|webp|gif|mp3|wav|m4a|aac|ogg)([^\s"'`<>)}\]]*)/gi;
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
    } catch { /* skip failed URLs */ }
  }));
  return resolved;
}

// ─── Main renderer ──────────────────────────────────────────────────────────

interface RemotionRendererProps {
  design: DesignPayload;
  /** Called with JPEG data URL poster (animation) or empty string (still — Canvas uses Player) */
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
  mode?: 'fill' | 'inline';
}

export default function RemotionRenderer({ design, onComplete, onError, mode = 'inline' }: RemotionRendererProps) {
  const playerRef = useRef<PlayerRef>(null);
  const initRef = useRef(false);
  const posterRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

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

  // Capture poster via renderStillOnWeb (both still and animation — same approach)
  useEffect(() => {
    if (!Component || posterRef.current) return;
    posterRef.current = true;
    (async () => {
      try {
        const resolvedCode = await resolveCodeUrls(design.code);
        const posterComp = evalRemotionJSX(resolvedCode);
        if (!posterComp) { onComplete(''); return; } // fallback: empty poster
        console.log('🎨 [design] renderStillOnWeb poster...');
        const result = await renderStillOnWeb({
          composition: {
            component: posterComp,
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
          inputProps: (design.props || {}) as Record<string, unknown>,
        });
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log('🎨 [design] poster captured');
          onComplete(reader.result as string);
        };
        reader.readAsDataURL(result.blob);
      } catch (e) {
        console.warn('🎨 [design] poster capture failed, using empty:', e);
        onComplete(''); // fallback: empty poster (Player still works)
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Component]);

  if (!Component) return null;

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
  });

  return result.getBlob();
}
