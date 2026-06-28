'use client';

import { useRef, useCallback, useEffect } from 'react';
import type { CreateInputState } from '@/hooks/useCreateInput';
import SkillSelector, { type SkillItem } from '@/components/SkillSelector';

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="mkr-spin" width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="rgba(217,70,239,0.12)" strokeWidth="2.5" fill="none" />
      <path fill="rgba(217,70,239,0.7)" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export interface CreateInputBoxProps {
  input: CreateInputState;
  slotWidth: number;
  collapseSlot?: boolean;
  isInline?: boolean;
  isDesktop?: boolean;
  boxRef?: React.RefObject<HTMLDivElement | null>;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  swipeRef?: React.RefObject<HTMLDivElement | null>;
  placeholder?: string;
  createLabel?: string;
  promptPanel?: React.ReactNode;
  actionMode?: boolean;
  actionEyebrow?: string;
  actionTitle?: string;
  actionSubtitle?: string;
  actionMeta?: string;
  actionIdleNote?: string;
  actionSelectedNote?: string;
  showLoginIcon?: boolean;
  onSubmit: () => void;
  onSlotClick?: () => void;
  onFilesSelected?: (files: File[]) => void;
  onTextareaFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onTextareaBlur?: () => void;
  // Skill selector props
  skills: SkillItem[];
  selectedSkill: string | null;
  onSkillChange: (skill: string | null) => void;
  onDeleteSkill?: (name: string) => void;
  onUploadSkill?: () => void;
  installingSkill?: boolean;
  overrideLabel?: string | null;
  skillDirection?: 'up' | 'down';
  // Drag-drop
  dragOver?: boolean;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export default function CreateInputBox({
  input,
  slotWidth,
  collapseSlot = false,
  isInline = false,
  isDesktop = false,
  boxRef,
  textareaRef: externalTextareaRef,
  swipeRef,
  placeholder = '',
  createLabel = 'Create',
  promptPanel,
  actionMode = false,
  actionEyebrow,
  actionTitle,
  actionSubtitle,
  actionMeta,
  actionIdleNote = 'No credit card',
  actionSelectedNote = 'Photo selected',
  showLoginIcon = false,
  onSubmit,
  onSlotClick,
  onFilesSelected,
  onTextareaFocus,
  onTextareaBlur,
  skills,
  selectedSkill,
  onSkillChange,
  onDeleteSkill,
  onUploadSkill,
  installingSkill,
  overrideLabel,
  skillDirection,
  dragOver = false,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: CreateInputBoxProps) {
  const {
    files, previews, text, setText, creating,
    fileInputRef, cardIndex, setCardIndex, cardDragX, setCardDragX,
    addFiles, removeFile,
  } = input;

  const cardTouchRef = useRef<{ startX: number; startY: number; locked: 'x' | 'y' | null } | null>(null);
  const mobileSwipeElRef = useRef<HTMLDivElement | null>(null);

  const setMobileSwipeRef = useCallback((el: HTMLDivElement | null) => {
    mobileSwipeElRef.current = el;
    if (swipeRef) {
      (swipeRef as { current: HTMLDivElement | null }).current = el;
    }
  }, [swipeRef]);

  const registerSwipe = useCallback((el: HTMLDivElement | null) => {
    if (!el) return () => {};
    const onMove = (e: TouchEvent) => {
      if (!cardTouchRef.current) return;
      const dx = e.touches[0].clientX - cardTouchRef.current.startX;
      const dy = e.touches[0].clientY - cardTouchRef.current.startY;
      if (!cardTouchRef.current.locked) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        cardTouchRef.current.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (cardTouchRef.current.locked !== 'x') return;
      e.preventDefault();
      e.stopPropagation();
      setCardDragX(() => dx);
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [setCardDragX]);

  useEffect(() => {
    const el = mobileSwipeElRef.current;
    if (!el || isDesktop || files.length < 2) return;
    const cleanup = registerSwipe(el);
    return cleanup;
  }, [files.length, isDesktop, registerSwipe]);

  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const taRef = externalTextareaRef || internalTextareaRef;
  const handlePrimaryAction = useCallback(() => {
    if (creating) return;
    if (files.length > 0 || text.trim()) {
      onSubmit();
      return;
    }
    onSlotClick ? onSlotClick() : fileInputRef.current?.click();
  }, [creating, fileInputRef, files.length, onSlotClick, onSubmit, text]);

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*,video/*,.heic,.heif"
      multiple
      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      onChange={(e) => {
        const f = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (f.length) {
          onFilesSelected?.(f);
          addFiles(f);
        }
      }}
    />
  );

  if (actionMode) {
    const firstPreview = previews[0];
    const hasFiles = files.length > 0;
    return (
      <div
        ref={boxRef}
        className="mkr-input-box"
        role="button"
        tabIndex={0}
        onClick={handlePrimaryAction}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handlePrimaryAction();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          minHeight: isDesktop ? 96 : 86,
          borderRadius: 18,
          overflow: 'hidden',
          cursor: creating ? 'default' : 'pointer',
          pointerEvents: 'auto',
          border: dragOver ? '1px solid rgba(217,70,239,0.58)' : '1px solid rgba(255,255,255,0.18)',
          background: dragOver
            ? 'rgba(217,70,239,0.08)'
            : 'rgba(15,15,15,0.65)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.8), 0 0 60px 30px rgba(0,0,0,0.5)',
          transition: 'transform 0.18s ease, border-color 0.2s ease, background 0.2s ease',
        }}
      >
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06), transparent 42%), radial-gradient(circle at 88% 75%, rgba(217,70,239,0.10), transparent 30%)',
          pointerEvents: 'none',
        }} />

        <div
          data-testid="photo-slot"
          onClick={(e) => {
            e.stopPropagation();
            if (!creating) onSlotClick ? onSlotClick() : fileInputRef.current?.click();
          }}
          style={{
            position: 'relative',
            zIndex: 1,
            width: collapseSlot ? 0 : isDesktop ? 96 : 82,
            flexShrink: 0,
            borderRight: collapseSlot ? 'none' : '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: collapseSlot ? 0 : 1,
            background: hasFiles ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.12)',
            overflow: 'hidden',
            transition: 'width 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s',
          }}
        >
          <div style={{
            width: isDesktop ? 62 : 56,
            height: isDesktop ? 62 : 56,
            borderRadius: 14,
            overflow: 'hidden',
            border: hasFiles ? '1px solid rgba(255,255,255,0.24)' : '1px solid rgba(217,70,239,0.28)',
            background: hasFiles ? 'rgba(255,255,255,0.08)' : 'rgba(217,70,239,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: hasFiles ? '0 8px 20px rgba(0,0,0,0.32)' : 'none',
          }}>
            {hasFiles && firstPreview && firstPreview !== 'heic-pending' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={firstPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : hasFiles && firstPreview === null ? (
              <Spinner size={18} />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.55)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </div>
          {hasFiles && files.length > 1 && (
            <div style={{
              position: 'absolute',
              right: 10,
              bottom: 9,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'rgba(217,70,239,0.92)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              boxShadow: '0 4px 12px rgba(0,0,0,0.32)',
            }}>
              {files.length}
            </div>
          )}
          {hasFiles && !creating && (
            <div
              onClick={(e) => { e.stopPropagation(); input.removeFile(0); }}
              style={{
                position: 'absolute',
                top: 14,
                right: 10,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.62)',
                border: '1px solid rgba(255,255,255,0.18)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              &#x2715;
            </div>
          )}
        </div>

        <div style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: collapseSlot ? 8 : 10,
          padding: isDesktop ? '14px 14px 12px' : '12px 12px 10px',
        }}>
          {!collapseSlot && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {actionEyebrow && (
              <span style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                height: 22,
                padding: '0 8px',
                borderRadius: 999,
                background: 'rgba(217,70,239,0.13)',
                border: '1px solid rgba(217,70,239,0.20)',
                color: '#f0abfc',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.01em',
              }}>
                {actionEyebrow}
              </span>
            )}
            {actionMeta && (
              <span style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.58)',
                fontSize: 12,
                fontWeight: 650,
              }}>
                {actionMeta}
              </span>
            )}
          </div>
          )}
          <div>
            <div style={{
              color: 'rgba(255,255,255,0.96)',
              fontSize: isDesktop ? 18 : 17,
              lineHeight: 1.18,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}>
              {actionTitle || createLabel}
            </div>
            {actionSubtitle && (
              <div style={{
                marginTop: 5,
                color: 'rgba(255,255,255,0.54)',
                fontSize: isDesktop ? 13 : 12,
                lineHeight: 1.32,
                fontWeight: 500,
              }}>
                {actionSubtitle}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'rgba(255,255,255,0.56)',
              fontSize: 12,
              fontWeight: 650,
              minWidth: 0,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f0abfc', boxShadow: '0 0 12px rgba(240,171,252,0.9)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hasFiles ? actionSelectedNote : actionIdleNote}
              </span>
            </div>
            <div style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: isDesktop ? '9px 13px' : '8px 12px',
              borderRadius: 999,
              background: 'rgba(217,70,239,0.13)',
              border: '1px solid rgba(217,70,239,0.20)',
              color: 'rgba(240,171,252,0.98)',
              fontSize: isDesktop ? 14 : 13,
              fontWeight: 750,
              letterSpacing: '0.015em',
              boxShadow: 'none',
            }}>
              {creating ? <Spinner size={13} /> : null}
              {createLabel}
              {!creating && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              )}
            </div>
          </div>
        </div>
        {hiddenFileInput}
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className="mkr-input-box"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: 'flex', gap: 0,
        borderRadius: 18,
        border: dragOver ? '1px solid rgba(217,70,239,0.6)' : `1px solid rgba(255,255,255,${isInline ? 0.1 : 0.18})`,
        background: dragOver ? 'rgba(217,70,239,0.08)' : isInline ? 'rgba(255,255,255,0.03)' : 'rgba(15,15,15,0.65)',
        overflow: 'hidden',
        transition: 'border-color 0.2s, background 0.2s',
        ...(isInline ? {} : {
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          pointerEvents: 'auto' as const,
          boxShadow: '0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.8), 0 0 60px 30px rgba(0,0,0,0.5)',
        }),
      }}
    >
      {/* Left: + button / photo slot */}
      <div
        data-testid="photo-slot"
        onClick={() => { if (!creating && !collapseSlot) { onSlotClick ? onSlotClick() : fileInputRef.current?.click(); } }}
        style={{
          width: collapseSlot ? 0 : slotWidth,
          flexShrink: 0, alignSelf: 'stretch',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: creating || collapseSlot ? 'default' : 'pointer',
          borderRight: collapseSlot ? 'none' : '1px solid rgba(255,255,255,0.08)',
          position: 'relative', overflow: 'hidden',
          background: files.length > 0 ? 'transparent' : 'rgba(217,70,239,0.04)',
          transition: 'width 0.25s cubic-bezier(0.22, 1, 0.36, 1), border-right 0.2s',
        }}
      >
        {files.length === 0 ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        ) : files.length === 1 ? (
          <>
            {previews[0] && previews[0] !== 'heic-pending' ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[0]} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                {creating && files[0]?.type.startsWith('video/') && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                    <Spinner size={16} />
                  </div>
                )}
              </>
            ) : previews[0] === null ? (
              <Spinner size={16} />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(217,70,239,0.7)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
            )}
            {!creating && <div style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 2 }}
              onClick={(e) => { e.stopPropagation(); input.removeFile(0); }}>&#x2715;</div>}
          </>
        ) : (
          <>
            {isDesktop ? (
              <div style={{ position: 'absolute', inset: 6, pointerEvents: 'none' }}>
                {(() => {
                  const cardStyle = (rotate: number, zIdx: number): React.CSSProperties => ({
                    position: 'absolute', inset: 0, borderRadius: 6, overflow: 'hidden',
                    transform: `rotate(${rotate}deg)`,
                    border: '1.5px solid rgba(255,255,255,0.12)',
                    background: '#1a1a1a', zIndex: zIdx, boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                  });
                  const n = files.length;
                  const layers: { preview: string | null; rotate: number; z: number }[] = [];
                  if (n >= 3) layers.push({ preview: previews[0], rotate: -6, z: 1 });
                  if (n >= 2) layers.push({ preview: previews[n >= 3 ? 1 : 0], rotate: n >= 3 ? 4 : -5, z: 2 });
                  layers.push({ preview: previews[n - 1], rotate: 0, z: 3 });
                  return layers.map((layer, li) => (
                    <div key={li} style={cardStyle(layer.rotate, layer.z)}>
                      {layer.preview && layer.preview !== 'heic-pending' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : layer.preview === null ? (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={12} /></div>
                      ) : null}
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <div
                ref={setMobileSwipeRef}
                data-testid="mobile-upload-swipe-stack"
                data-idx={Math.min(cardIndex, files.length - 1)}
                data-count={files.length}
                style={{ position: 'absolute', inset: 6 }}
                onTouchStart={(e) => { cardTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, locked: null }; }}
                onTouchEnd={() => {
                  const touch = cardTouchRef.current; cardTouchRef.current = null;
                  if (!touch || touch.locked !== 'x') { setCardDragX(0); return; }
                  const idx = Math.min(cardIndex, files.length - 1);
                  const n = files.length;
                  if (cardDragX < -25) setCardIndex((idx + 1) % n);
                  else if (cardDragX > 25) setCardIndex((idx - 1 + n) % n);
                  setCardDragX(0);
                }}
              >
                {(() => {
                  const n = files.length; const idx = Math.min(cardIndex, n - 1); const dragging = cardDragX !== 0;
                  const layers: { preview: string | null; baseRotate: number; z: number; key: number; isFront: boolean }[] = [];
                  if (idx + 1 < n) layers.push({ preview: previews[idx + 1], baseRotate: 4, z: 1, key: idx + 1, isFront: false });
                  if (idx > 0) layers.push({ preview: previews[idx - 1], baseRotate: -4, z: 1, key: idx - 1, isFront: false });
                  layers.push({ preview: previews[idx], baseRotate: 0, z: 3, key: idx, isFront: true });
                  return layers.map((layer) => {
                    const tx = layer.isFront ? cardDragX : 0; const rot = layer.isFront ? cardDragX * 0.15 : layer.baseRotate;
                    const opacity = layer.isFront ? Math.max(0.5, 1 - Math.abs(cardDragX) / 150) : 1;
                    return (
                      <div key={layer.key} style={{
                        position: 'absolute', inset: 0, borderRadius: 6, overflow: 'hidden',
                        transform: `translateX(${tx}px) rotate(${rot}deg)`,
                        border: '1.5px solid rgba(255,255,255,0.12)', background: '#1a1a1a', zIndex: layer.z,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.4)', opacity,
                        transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
                      }}>
                        {layer.preview && layer.preview !== 'heic-pending' ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={layer.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                        ) : layer.preview === null ? (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={12} /></div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: 4, right: 4, zIndex: 4, background: 'rgba(217,70,239,0.85)', color: '#fff', borderRadius: 8, padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
              {isDesktop ? files.length : Math.min(cardIndex, files.length - 1) + 1}
            </div>
            <div style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', cursor: 'pointer', zIndex: 5 }}
              onClick={(e) => {
                e.stopPropagation();
                if (isDesktop) { input.removeFile(-1); /* clear all handled externally */ }
                else {
                  const idx = Math.min(cardIndex, files.length - 1);
                  if (files.length <= 1) { removeFile(0); setCardIndex(0); }
                  else { removeFile(idx); if (idx >= files.length - 1) setCardIndex(Math.max(0, idx - 1)); }
                }
              }}>&#x2715;</div>
          </>
        )}
      </div>

      {/* Right: textarea + bottom toolbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {promptPanel ? (
          <div
            role={onSlotClick ? 'button' : undefined}
            tabIndex={onSlotClick ? 0 : undefined}
            onClick={() => { if (!creating) onSlotClick?.(); }}
            onKeyDown={(e) => {
              if (!onSlotClick || creating) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSlotClick();
              }
            }}
            style={{
              padding: '14px 16px 5px',
              minHeight: 76,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              cursor: onSlotClick && !creating ? 'pointer' : 'default',
            }}
          >
            {promptPanel}
          </div>
        ) : (
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => { setText(e.target.value); }}
            onFocus={onTextareaFocus}
            onBlur={onTextareaBlur}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.code === 'Enter') && e.altKey) {
                e.preventDefault();
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const val = ta.value;
                setText(val.substring(0, start) + '\n' + val.substring(end));
                requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
                return;
              }
              const isMobile = 'ontouchstart' in window;
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isMobile && (text.trim() || files.length > 0)) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={placeholder}
            disabled={creating}
            rows={2}
            style={{
              border: 'none', background: 'transparent',
              color: 'rgba(255,255,255,0.88)', fontSize: '17px', lineHeight: 1.45,
              padding: '12px 14px 4px',
              outline: 'none', resize: 'none',
              fontFamily: 'inherit',
              caretColor: '#d946ef',
              minHeight: 40,
              maxHeight: '8rem',
              overflowY: 'auto',
              display: 'block', width: '100%',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 8px' }}>
          <div className="hide-scrollbar" onWheel={(e) => { if (e.deltaY !== 0) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto', paddingTop: 4 }}>
            {isDesktop && files.length >= 2 && previews.map((preview, i) => (
              <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                {preview && preview !== 'heic-pending' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', display: 'block', border: '1px solid rgba(255,255,255,0.12)' }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={10} /></div>
                )}
                <div onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'rgba(20,20,20,0.9)', border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </div>
              </div>
            ))}
          </div>
          {/* Skill selector */}
          <SkillSelector
            skills={skills}
            selectedSkill={selectedSkill}
            onSkillChange={onSkillChange}
            onDeleteSkill={onDeleteSkill}
            onUploadSkill={onUploadSkill}
            installing={installingSkill}
            overrideLabel={overrideLabel}
            direction={skillDirection}
          />
          <button
            className="mkr-create-btn"
            data-testid="create-project"
            onClick={(e) => {
              e.stopPropagation();
              if (text.trim() || files.length > 0) {
                onSubmit();
              } else {
                onSlotClick ? onSlotClick() : fileInputRef.current?.click();
              }
            }}
            disabled={creating}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '14px', background: 'none', border: 'none', color: 'rgba(217,70,239,0.9)', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.03em', cursor: creating ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >
            {creating && <Spinner size={12} />}
            {!creating && showLoginIcon && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            )}
            {!creating && !showLoginIcon && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            )}
            {createLabel}
          </button>
        </div>
      </div>
      {/* Hidden file input for photo/video uploads */}
      {hiddenFileInput}
    </div>
  );
}
