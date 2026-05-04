'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface SkillItem {
  name: string;
  label: string;
  icon: string;
  builtIn?: boolean;
}

interface SkillSelectorProps {
  skills: SkillItem[];
  selectedSkill: string | null;
  onSkillChange: (skill: string | null) => void;
  onDeleteSkill?: (name: string) => void;
  onUploadSkill?: () => void;
  installing?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Override label for the trigger button (e.g. when selectedSkill is a UUID resolved externally) */
  overrideLabel?: string | null;
  /** Popover direction: 'up' (default) or 'down' */
  direction?: 'up' | 'down';
}

export default function SkillSelector({
  skills,
  selectedSkill,
  onSkillChange,
  onDeleteSkill,
  onUploadSkill,
  installing,
  onOpenChange,
  overrideLabel,
  direction = 'up',
}: SkillSelectorProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ bottom?: number; top?: number; left?: number; right?: number } | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  // Position popover (same pattern as ModelSelector)
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const isMobile = window.innerWidth < 640;
      if (direction === 'down') {
        const top = rect.bottom + 6;
        if (isMobile) {
          setPopoverPos({ top, left: 12, right: 12 });
        } else {
          const panelWidth = 200;
          const spaceRight = window.innerWidth - rect.left;
          if (spaceRight >= panelWidth + 8) {
            setPopoverPos({ top, left: Math.max(8, rect.left) });
          } else {
            setPopoverPos({ top, right: Math.max(8, window.innerWidth - rect.right) });
          }
        }
      } else {
        const bottom = window.innerHeight - rect.top + 6;
        if (isMobile) {
          setPopoverPos({ bottom, left: 12, right: 12 });
        } else {
          const panelWidth = 200;
          const spaceRight = window.innerWidth - rect.left;
          if (spaceRight >= panelWidth + 8) {
            setPopoverPos({ bottom, left: Math.max(8, rect.left) });
          } else {
            setPopoverPos({ bottom, right: Math.max(8, window.innerWidth - rect.right) });
          }
        }
      }
    }
  }, [open]);

  const handleTriggerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(v => !v);
  }, []);

  const selectedLabel = overrideLabel
    || (selectedSkill ? (skills.find(s => s.name === selectedSkill)?.label || selectedSkill) : null);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={handleTriggerClick}
        className="flex-shrink-0 flex items-center transition-all active:scale-95"
        style={{
          padding: (selectedSkill || installing || open) ? '4px 10px' : '5px 6px',
          borderRadius: (selectedSkill || installing || open) ? 12 : 0,
          border: 'none',
          background: (selectedSkill || installing || open) ? 'rgba(217,70,239,0.15)' : 'none',
          color: (selectedSkill || installing || open) ? '#f0abfc' : 'rgba(255,255,255,0.45)',
          fontSize: '0.75rem',
          fontWeight: 500,
          letterSpacing: '0.03em',
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
          gap: 4,
        }}
      >
        {installing ? (
          <>
            <span className="w-2.5 h-2.5 border border-fuchsia-400/40 border-t-fuchsia-400 rounded-full animate-spin" />
            Installing...
          </>
        ) : selectedLabel ? (
          <>
            <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedLabel}</span>
            <span
              onClick={(e) => { e.stopPropagation(); onSkillChange(null); setOpen(false); }}
              style={{ opacity: 0.5, fontSize: '0.6rem', padding: '0 2px' }}
            >✕</span>
          </>
        ) : 'Skill'}
      </button>

      {/* Popover — portaled to body to escape stacking context */}
      {open && popoverPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            ...(popoverPos.bottom != null ? { bottom: popoverPos.bottom } : {}),
            ...(popoverPos.top != null ? { top: popoverPos.top } : {}),
            ...(popoverPos.left != null ? { left: popoverPos.left } : {}),
            ...(popoverPos.right != null ? { right: popoverPos.right } : {}),
            ...(popoverPos.left != null && popoverPos.right != null ? {} : { width: 200 }),
            maxHeight: 320,
            overflowY: 'auto',
            pointerEvents: 'auto' as const,
            background: '#161616',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: '4px 0',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            zIndex: 500,
          }}
        >
          {skills.length === 0 && (
            <div style={{ padding: '8px 12px', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Loading...</div>
          )}
          {skills.map(skill => (
            <button
              key={skill.name}
              onClick={() => { onSkillChange(selectedSkill === skill.name ? null : skill.name); setOpen(false); }}
              className="w-full flex items-center justify-between border-none cursor-pointer text-left transition-colors"
              style={{
                padding: '12px 12px',
                borderRadius: 10,
                background: selectedSkill === skill.name ? 'rgba(232,121,249,0.08)' : 'transparent',
                color: selectedSkill === skill.name ? '#e879f9' : 'rgba(255,255,255,0.85)',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              <span>{skill.label}</span>
              {!skill.builtIn && onDeleteSkill && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedSkill === skill.name) onSkillChange(null);
                    onDeleteSkill(skill.name);
                  }}
                  style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, padding: '0 2px', cursor: 'pointer' }}
                >
                  ✕
                </span>
              )}
            </button>
          ))}
          {onUploadSkill && (
            <>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
              <button
                onClick={() => { setOpen(false); setTimeout(() => onUploadSkill(), 100); }}
                className="w-full flex items-center border-none cursor-pointer text-left"
                style={{
                  padding: '12px 12px',
                  borderRadius: 10,
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                }}
              >
                + Upload Skill (.zip)
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
