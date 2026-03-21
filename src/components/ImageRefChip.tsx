'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Snapshot } from '@/types';
import { getThumbnailUrl } from '@/lib/supabase/storage';

interface ImageRefChipProps {
  index: number; // 0-based
  snapshot?: Snapshot;
}

export default function ImageRefChip({ index, snapshot }: ImageRefChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const isTouchDevice = useRef(false);

  const imgSrc = snapshot?.imageUrl || snapshot?.image;
  const thumbUrl = imgSrc && imgSrc.startsWith('http')
    ? getThumbnailUrl(imgSrc, 40, 60, 40, 'cover')
    : undefined;
  const previewUrl = imgSrc && imgSrc.startsWith('http')
    ? getThumbnailUrl(imgSrc, 400, 90, 400, 'cover')
    : imgSrc;

  // Reset loaded state when preview closes
  useEffect(() => {
    if (!showPreview) setImgLoaded(false);
  }, [showPreview]);

  const updatePosition = useCallback(() => {
    if (!chipRef.current) return;
    const rect = chipRef.current.getBoundingClientRect();
    const pw = Math.min(300, window.innerWidth * 0.6);
    const chipCenter = rect.left + rect.width / 2;
    let left = chipCenter - pw / 2;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    setPopoverStyle({
      position: 'fixed',
      bottom: window.innerHeight - rect.top + 4,
      left,
      width: pw,
      zIndex: 9999,
    });
  }, []);

  // Close on outside tap / scroll (mobile)
  useEffect(() => {
    if (!showPreview) return;
    const close = () => setShowPreview(false);
    const onPointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [showPreview]);

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center align-baseline">
      <span
        ref={chipRef}
        role="button"
        tabIndex={0}
        className="inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 rounded-md px-1.5 py-0.5 text-xs font-medium text-white/80 transition-colors cursor-pointer"
        onTouchStart={() => { isTouchDevice.current = true; }}
        onMouseEnter={() => { if (!isTouchDevice.current) { updatePosition(); setShowPreview(true); } }}
        onMouseLeave={() => { if (!isTouchDevice.current) setShowPreview(false); }}
        onClick={(e) => {
          e.stopPropagation();
          if (showPreview) { setShowPreview(false); } else { updatePosition(); setShowPreview(true); }
        }}
      >
        {thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" className="w-4 h-4 rounded-sm object-cover" />
        )}
        @{index + 1}
      </span>
      {showPreview && previewUrl && (
        <span
          className="rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black"
          style={{ ...popoverStyle, display: 'block' }}
        >
          {/* Loading placeholder */}
          {!imgLoaded && (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', aspectRatio: '1', background: '#111' }}>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span className="text-white/30 text-xs">@{index + 1}</span>
                <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.5)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              </span>
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            onLoad={() => setImgLoaded(true)}
            style={{ width: '100%', height: 'auto', display: imgLoaded ? 'block' : 'none' }}
          />
          {imgLoaded && (
            <span
              className="bg-black/60 backdrop-blur text-white text-sm font-medium px-1.5 py-0.5 rounded-md"
              style={{ position: 'absolute', bottom: 8, left: 8 }}
            >
              @{index + 1}
            </span>
          )}
        </span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </span>
  );
}
