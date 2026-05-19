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
  showLoginIcon?: boolean;
  onSubmit: () => void;
  onSlotClick?: () => void;
  onTextareaFocus?: () => void;
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
  skillFileRef?: React.RefObject<HTMLInputElement | null>;
  onSkillFileChange?: (file: File) => void;
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
  showLoginIcon = false,
  onSubmit,
  onSlotClick,
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
  skillFileRef,
  onSkillFileChange,
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
    if (!swipeRef?.current) return;
    const cleanup = registerSwipe(swipeRef.current);
    return cleanup;
  }, [files.length, registerSwipe, swipeRef]);

  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const taRef = externalTextareaRef || internalTextareaRef;

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
                ref={swipeRef}
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
          {skillFileRef && onSkillFileChange && (
            <input ref={skillFileRef} type="file" accept=".zip" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onSkillFileChange(f); e.target.value = ''; }} />
          )}
          <button
            className="mkr-create-btn"
            data-testid="create-project"
            onClick={() => { if (text.trim() || files.length > 0) { onSubmit(); } else { onSlotClick ? onSlotClick() : fileInputRef.current?.click(); } }}
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,.heic,.heif"
        multiple
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) addFiles(f); }}
      />
    </div>
  );
}
