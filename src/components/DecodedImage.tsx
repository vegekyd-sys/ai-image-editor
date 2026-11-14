'use client';
import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { getDecodedImageSize, preloadDecodedImage } from '@/lib/image/presentation';

/** New model images reveal after decoding, with a short opacity-only entrance. */
export default function DecodedImage({ src = '', style, onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [readySource, setReadySource] = useState('');
  useEffect(() => {
    let cancelled = false, first = 0, second = 0;
    const image = ref.current; if (!src || !image) return;
    void Promise.all([preloadDecodedImage(src), image.decode()]).then(() => {
      if (cancelled) return;
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { if (!cancelled) setReadySource(src); }); });
    }).catch(() => {});
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [src]);
  const size = getDecodedImageSize(src);
  return <img {...rest} ref={ref} src={src} decoding="async" fetchPriority="high" onLoad={onLoad}
    data-image-decoded={readySource === src ? 'true' : 'false'}
    style={{ ...style, ...(size ? { aspectRatio: `${size.width}/${size.height}` } : {}), opacity: readySource === src ? 1 : 0, transition: 'opacity var(--mkr-image-reveal-duration, 120ms) ease-out' }} />;
}
