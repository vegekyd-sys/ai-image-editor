'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Snapshot } from '@/types';
import { getThumbnailUrl } from '@/lib/supabase/storage';

interface ImageRefChipProps {
  index: number; // 0-based
  snapshot?: Snapshot;
  onNavigate?: (index: number) => void;
  onPreview?: (index: number, triggerEl?: HTMLElement | null) => void;
}

const IMAGE_REF_PREVIEW_EVENT = 'makaron:image-ref-preview-open';

export default function ImageRefChip({ index, snapshot, onNavigate, onPreview }: ImageRefChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const previewIdRef = useRef(`image-ref-${index}-${Math.random().toString(36).slice(2)}`);
  const isTouchDevice = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);

  const scheduleHide = useCallback(() => {
    hideTimer.current = setTimeout(() => setShowPreview(false), 100);
  }, []);
  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const imgSrc = snapshot?.imageUrl || snapshot?.image;
  const thumbUrl = imgSrc && imgSrc.startsWith('http')
    ? getThumbnailUrl(imgSrc, 40, 60, 40, 'cover')
    : undefined;
  const previewUrl = imgSrc && imgSrc.startsWith('http')
    ? getThumbnailUrl(imgSrc, 400, 90, 400, 'cover')
    : imgSrc;

  // Track loaded URL instead of boolean — same URL reopens instantly (no spinner flash)
  const imgLoaded = loadedUrl === previewUrl;

  const updatePosition = useCallback(() => {
    if (!chipRef.current) return;
    const rect = chipRef.current.getBoundingClientRect();
    const pw = Math.min(300, window.innerWidth * 0.6);
    const chipCenter = rect.left + rect.width / 2;
    let left = chipCenter - pw / 2;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    const spaceAbove = rect.top - 8;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    let top = spaceAbove >= pw || spaceAbove >= spaceBelow
      ? rect.top - pw - 4
      : rect.bottom + 4;
    top = Math.max(8, Math.min(top, window.innerHeight - pw - 8));
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width: pw,
      height: pw,
      zIndex: 9999,
    });
  }, []);

  const popoverRef = useRef<HTMLSpanElement>(null);

  const openPreview = useCallback(() => {
    cancelHide();
    updatePosition();
    window.dispatchEvent(new CustomEvent(IMAGE_REF_PREVIEW_EVENT, { detail: previewIdRef.current }));
    setShowPreview(true);
  }, [cancelHide, updatePosition]);

  const togglePreview = useCallback(() => {
    if (onPreview) {
      onPreview(index, chipRef.current);
      return;
    }
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    openPreview();
  }, [index, onPreview, openPreview, showPreview]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    isTouchDevice.current = true;
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    touchMovedRef.current = false;
    event.stopPropagation();
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    if (Math.abs(touch.clientX - start.x) > 8 || Math.abs(touch.clientY - start.y) > 8) {
      touchMovedRef.current = true;
    }
    event.stopPropagation();
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
    event.stopPropagation();
    if (touchMovedRef.current) {
      touchStartRef.current = null;
      return;
    }
    event.preventDefault();
    suppressClickUntilRef.current = Date.now() + 500;
    touchStartRef.current = null;
    togglePreview();
  }, [togglePreview]);

  const handleTouchCancel = useCallback((event: React.TouchEvent) => {
    event.stopPropagation();
    touchStartRef.current = null;
    touchMovedRef.current = false;
  }, []);

  useEffect(() => {
    const closeOtherPreview = (event: Event) => {
      if ((event as CustomEvent<string>).detail === previewIdRef.current) return;
      setShowPreview(false);
    };
    window.addEventListener(IMAGE_REF_PREVIEW_EVENT, closeOtherPreview);
    return () => window.removeEventListener(IMAGE_REF_PREVIEW_EVENT, closeOtherPreview);
  }, []);

  // Close on outside tap / scroll (mobile)
  useEffect(() => {
    if (!showPreview) return;
    const close = () => setShowPreview(false);
    const isOutside = (target: EventTarget | null) => {
      if (!target) return false;
      const node = target as Node;
      if (wrapperRef.current?.contains(node)) return false;
      if (popoverRef.current?.contains(node)) return false;
      return true;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (isOutside(e.target)) close();
    };
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Node;
      if (isOutside(target)) close();
    };
    document.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('touchstart', onTouchStart, true);
    return () => {
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('touchstart', onTouchStart, true);
    };
  }, [showPreview]);

  const popover = showPreview && previewUrl ? (
    <span
      ref={popoverRef}
      className="rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black"
      style={{ ...popoverStyle, display: 'block', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={() => { if (!isTouchDevice.current) cancelHide(); }}
      onMouseLeave={() => { if (!isTouchDevice.current) scheduleHide(); }}
    >
      {!imgLoaded && (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', inset: 0, background: '#111' }}>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span className="text-white/30 text-xs">@{index + 1}</span>
            <span className="animate-spin" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.5)', borderRadius: '50%' }} />
          </span>
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt=""
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        onLoad={() => setLoadedUrl(previewUrl ?? null)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
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
  ) : null;

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center align-baseline">
      <span
        ref={chipRef}
        role="button"
        aria-label={`Preview image ${index + 1}`}
        data-testid={`image-ref-chip-${index + 1}`}
        tabIndex={0}
        className="relative inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 rounded-md px-1.5 py-0.5 text-xs font-medium text-white/80 transition-colors cursor-pointer"
        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onMouseEnter={() => { if (!isTouchDevice.current) { cancelHide(); updatePosition(); setShowPreview(true); } }}
        onMouseLeave={() => { if (!isTouchDevice.current) scheduleHide(); }}
        onClick={(e) => {
          e.stopPropagation();
          if (Date.now() < suppressClickUntilRef.current) return;
          if (onNavigate) {
            onNavigate(index);
            setShowPreview(false);
            return;
          }
          togglePreview();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          togglePreview();
        }}
      >
        <span aria-hidden="true" className="absolute -inset-x-2 -inset-y-2 pointer-events-none" />
        {thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt=""
            draggable={false}
            className="w-4 h-4 rounded-sm object-cover pointer-events-none"
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
          />
        )}
        @{index + 1}
      </span>
      {popover && typeof document !== 'undefined' && createPortal(
        <span data-testid={`image-ref-preview-${index + 1}`}>{popover}</span>,
        document.body,
      )}
    </span>
  );
}
