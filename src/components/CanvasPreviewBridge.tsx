'use client';
import { useEffect, useRef, useState } from 'react';
import { getDecodedImageSize, preloadDecodedImage } from '@/lib/image/presentation';

/** A single persistent poster bridges snapshot/image/Player handoffs without a black frame. */
export default function CanvasPreviewBridge({ source, contentReady, navigating, longContent, preserveLiveContent = false, revealLayers = false }: {
  source: string; contentReady: boolean; navigating: boolean; longContent: boolean; preserveLiveContent?: boolean; revealLayers?: boolean;
}) {
  const [painted, setPainted] = useState(() => getDecodedImageSize(source) ? source : '');
  const [decoded, setDecoded] = useState(() => getDecodedImageSize(source) ? source : '');
  const [retired, setRetired] = useState('');
  const incomingRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let cancelled = false, first = 0, second = 0;
    const image = incomingRef.current;
    if (!source || !image) return;
    // Decode the actual DOM node too: Safari can evict a preloaded bitmap.
    void Promise.all([preloadDecodedImage(source), image.decode()]).then(() => {
      if (cancelled) return;
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { if (!cancelled) setDecoded(source); }); });
    }).catch(() => {});
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [source]);
  const incomingReady = decoded === source;
  // A mounted design already contains the user's latest transforms. Keep those
  // pixels until the incoming poster decodes; its saved poster can be older.
  const visible = preserveLiveContent
    ? incomingReady && retired !== source
    : navigating || !contentReady || !incomingReady || retired !== source;
  useEffect(() => {
    if (!incomingReady || !contentReady || navigating) return;
    const id = setTimeout(() => { setPainted(source); setRetired(source); }, 120);
    return () => clearTimeout(id);
  }, [source, incomingReady, contentReady, navigating]);
  const imageClass = longContent ? 'absolute top-0 left-0 w-full h-auto' : 'absolute inset-0 w-full h-full object-contain';
  return (
    <div data-canvas-preview-bridge data-preview-source={source} aria-hidden="true"
      className="absolute inset-0 pointer-events-none overflow-hidden z-[16]"
      style={{ opacity: visible && !revealLayers ? 1 : 0, transition: visible || revealLayers ? 'none' : 'opacity var(--mkr-image-reveal-duration, 120ms) ease-out' }}>
      {painted && <img src={painted} alt="" className={imageClass} draggable={false} />}
      {source && <img key={source} ref={incomingRef} src={source} alt="" decoding="async" fetchPriority="high" draggable={false}
        className={imageClass} style={{ opacity: incomingReady ? 1 : 0, transition: 'opacity var(--mkr-image-reveal-duration, 120ms) ease-out' }} />}
    </div>
  );
}
