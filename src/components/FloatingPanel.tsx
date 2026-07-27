'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useLocale } from '@/lib/i18n';

interface FloatingPanelProps {
  onClose: () => void;
  isDesktop: boolean;
  children: React.ReactNode;
}

const DRAG_THRESHOLD = 3;
const NO_DRAG_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'A', 'SELECT']);

/**
 * Shared floating panel shell — used by AnnotationToolbar and DesignTextEditor.
 * Desktop: draggable with an external close control. Mobile: inline with a
 * floating close control that does not participate in the panel's layout.
 * Provides: close button, drag behavior, container styling.
 */
export default function FloatingPanel({ onClose, isDesktop, children }: FloatingPanelProps) {
  const { t } = useLocale();
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; active: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isDesktop) return;
    let el = e.target as HTMLElement;
    while (el && el !== e.currentTarget) {
      if (NO_DRAG_TAGS.has(el.tagName) || el.getAttribute('role') === 'button') return;
      el = el.parentElement!;
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: dragOffset.x, origY: dragOffset.y, active: false };
  }, [isDesktop, dragOffset]);

  useEffect(() => {
    if (!isDesktop) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.active) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        d.active = true;
        setIsDragging(true);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      setDragOffset({ x: d.origX + dx, y: d.origY + dy });
    };
    const onUp = () => {
      dragRef.current = null;
      if (isDragging) setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDesktop, isDragging]);

  const closeButton = (
    <button
      data-floating-panel-close={isDesktop ? 'external' : 'internal'}
      onClick={onClose}
      className={`mkr-liquid-icon-button w-7 h-7 flex items-center justify-center rounded-full cursor-pointer ${
        isDesktop ? 'mb-1.5' : 'absolute left-5 z-20'
      }`}
      style={{
        position: isDesktop ? undefined : 'absolute',
        top: isDesktop ? undefined : -18,
        left: isDesktop ? undefined : 20,
        zIndex: isDesktop ? undefined : 20,
        background: 'linear-gradient(145deg, rgba(26,26,31,0.72), rgba(8,8,12,0.50))',
        border: '0.5px solid rgba(255,255,255,0.11)',
      }}
      aria-label={t('editor.closePanel')}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="3" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  return (
    <div
      className="relative px-3 pb-3 pt-1 animate-pop-in"
      style={isDesktop ? {
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        cursor: isDragging ? 'grabbing' : undefined,
      } : undefined}
      onMouseDown={handleMouseDown}
    >
      {isDesktop && closeButton}
      {!isDesktop && closeButton}

      {/* Content container */}
      <div
        className="mkr-liquid-surface rounded-2xl relative"
        style={{
          background: 'linear-gradient(145deg, rgba(26,26,31,0.72), rgba(8,8,12,0.50))',
          border: '0.5px solid rgba(255,255,255,0.11)',
          boxShadow: '0 18px 55px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.09)',
          cursor: isDesktop ? (isDragging ? 'grabbing' : 'grab') : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
