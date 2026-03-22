'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Snapshot, ProjectAnimation } from '@/types';
import type { AnimationState } from '@/components/Editor';
import { useLocale } from '@/lib/i18n';

interface AnimateSheetProps {
  snapshots: Snapshot[];
  projectId: string;
  onClose: () => void;
  onOpenCUI?: () => void;
  onGeneratePrompt?: (imageUrls: string[]) => void;
  onPreviewImage?: (snapshotId: string) => void;
  animationState: AnimationState;
  onStateChange: (update: Partial<AnimationState>) => void;
  isDesktop?: boolean;
  mode?: 'create' | 'detail';
  detailAnimation?: ProjectAnimation;
}

export default function AnimateSheet({
  snapshots, projectId, onClose, onOpenCUI, onGeneratePrompt, onPreviewImage,
  animationState, onStateChange, isDesktop,
  mode = 'create', detailAnimation,
}: AnimateSheetProps) {
  const { t } = useLocale();
  const isDetail = mode === 'detail' && !!detailAnimation;
  const { prompt, userHint, status, error, duration } = animationState;

  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [selectedThumbId, setSelectedThumbId] = useState<string | null>(null);

  const allSnapshots = snapshots.filter(s => s.imageUrl?.startsWith('http'));
  const activeSnapshots = allSnapshots.filter((_, i) => !excludedIndices.has(i));
  const activeUrls = activeSnapshots.map(s => s.imageUrl!);

  // ── Drag-to-dismiss (mobile only) ──
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [entryAnimDone, setEntryAnimDone] = useState(false);

  // Mark entry animation as done after it plays
  useEffect(() => {
    if (isDesktop) { setEntryAnimDone(true); return; }
    const timer = setTimeout(() => setEntryAnimDone(true), 350);
    return () => clearTimeout(timer);
  }, [isDesktop]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isDesktop) return;
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, [isDesktop]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    // Only allow dragging down
    setDragY(Math.max(0, dy));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragStartY.current === null) return;
    if (dragY > 120) {
      onClose();
    } else {
      setDragY(0);
    }
    dragStartY.current = null;
    setIsDragging(false);
  }, [dragY, onClose]);

  // Auto-resize textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.max(80, el.scrollHeight) + 'px';
    }
  }, [prompt]);

  const handleGenerateScript = useCallback(() => {
    if (activeUrls.length < 1) return;
    const urls = activeUrls.length <= 7
      ? activeUrls
      : [0, 1, 2, Math.floor(activeUrls.length / 2), activeUrls.length - 3, activeUrls.length - 2, activeUrls.length - 1]
        .map(i => activeUrls[Math.min(i, activeUrls.length - 1)]);
    onStateChange({ imageUrls: urls, error: null, prompt: '' });
    onGeneratePrompt?.(urls);
  }, [activeUrls, onStateChange, onGeneratePrompt]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || activeUrls.length < 1) return;
    const urls = activeUrls.length <= 7
      ? activeUrls
      : [0, 1, 2, Math.floor(activeUrls.length / 2), activeUrls.length - 3, activeUrls.length - 2, activeUrls.length - 1]
        .map(i => activeUrls[Math.min(i, activeUrls.length - 1)]);
    onStateChange({ imageUrls: urls, status: 'submitting', error: null });
    try {
      const res = await fetch('/api/animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, imageUrls: urls, prompt: prompt.trim(), duration }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create task');
      onStateChange({ taskId: json.taskId, status: 'polling', pollSeconds: 0 });
    } catch (err) {
      const raw = String(err);
      const friendly = raw.includes('523') || raw.includes('unreachable') ? t('animate.errUnavailable')
        : raw.includes('500') || raw.includes('502') || raw.includes('503') ? t('animate.errFailed')
        : raw.replace(/Error:\s*/g, '').replace(/<[^>]+>/g, '').slice(0, 100);
      onStateChange({ error: friendly, status: 'error' });
    }
  }, [prompt, projectId, activeUrls, duration, onStateChange, t]);

  const canGenerate = prompt.trim().length > 0 && status === 'ready' && activeUrls.length >= 1;
  const canGenerateScript = activeUrls.length >= 1 && (status === 'idle' || status === 'error' || status === 'ready');

  const detailUrls = detailAnimation?.snapshotUrls ?? [];
  const detailPrompt = detailAnimation?.prompt ?? '';
  const detailDuration = detailAnimation?.duration;

  const getBottomButton = () => {
    if (status === 'submitting') {
      return { label: t('animate.submitting'), disabled: true, onClick: () => {} };
    }
    if (status === 'generating_prompt') {
      return { label: t('animate.aiWriting'), disabled: true, onClick: () => {} };
    }
    if (!prompt.trim()) {
      return { label: t('animate.autoScript'), disabled: !canGenerateScript, onClick: handleGenerateScript };
    }
    return { label: t('animate.generateVideo'), disabled: !canGenerate, onClick: handleGenerate };
  };

  const bottomBtn = !isDetail ? getBottomButton() : null;
  const thumbSize = isDesktop ? 56 : 64;

  return (
    <>
      <style>{`
        @keyframes slideUpSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideLeftSheet { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .animate-sheet-thumb { transition: transform 0.15s, box-shadow 0.15s; }
        .animate-sheet-thumb:active { transform: scale(0.93); }
      `}</style>

      <div ref={sheetRef} style={{
        position: 'fixed',
        ...(isDesktop ? {
          top: 0, right: 0, bottom: 0, width: 340,
          borderRadius: 0,
          animation: 'slideLeftSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
          zIndex: 300,
        } : {
          bottom: 0, left: 0, right: 0,
          maxHeight: '72dvh',
          borderRadius: '24px 24px 0 0',
          animation: !entryAnimDone ? 'slideUpSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' : 'none',
          zIndex: 202,
          transform: entryAnimDone ? `translateY(${dragY}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }),
        background: 'linear-gradient(180deg, #141416 0%, #0c0c0e 100%)',
        boxShadow: isDesktop ? '-12px 0 40px rgba(0,0,0,0.7)' : '0 -12px 40px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
        border: isDesktop ? 'none' : undefined,
        borderTop: isDesktop ? undefined : '1px solid rgba(255,255,255,0.06)',
      }}>

        {/* Handle bar (mobile, drag-to-dismiss) / Header */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ padding: isDesktop ? '16px 20px 0' : '0 20px', position: 'relative', touchAction: isDesktop ? undefined : 'none' }}
        >
          {!isDesktop && (
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: 'rgba(255,255,255,0.15)',
              margin: '10px auto 12px',
              cursor: 'grab',
            }} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{
              fontSize: isDesktop ? '0.95rem' : '1rem',
              fontWeight: 700, color: '#fff',
              letterSpacing: '-0.01em',
            }}>
              {isDetail ? t('animate.detailTitle') : t('animate.title')}
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '50%',
                color: 'rgba(255,255,255,0.5)', fontSize: '1rem',
                width: 30, height: 30,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px' }}>

          {/* ─── DETAIL MODE ─── */}
          {isDetail ? (
            <>
              {/* Filmstrip — read-only */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
              }}>
                {detailUrls.map((url, i) => (
                  <div key={i} className="animate-sheet-thumb" style={{
                    flexShrink: 0, width: thumbSize, height: thumbSize, borderRadius: 10,
                    overflow: 'hidden', background: 'rgba(255,255,255,0.04)', position: 'relative',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`snapshot ${i + 1}`}
                      style={{ width: thumbSize, height: thumbSize, objectFit: 'cover', display: 'block' }} />
                    <div style={{
                      position: 'absolute', bottom: 2, right: 3,
                      fontSize: '0.55rem', color: 'rgba(255,255,255,0.8)',
                      background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '0px 4px',
                      fontWeight: 600, letterSpacing: '0.02em',
                    }}>@{i + 1}</div>
                  </div>
                ))}
              </div>

              {/* Script — read-only */}
              <div style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)',
                  fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {t('animate.storyLabel')}
                </div>
                <div style={{
                  width: '100%', minHeight: 72,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 14, padding: '12px 14px',
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: isDesktop ? '0.85rem' : '0.95rem', lineHeight: 1.65,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {detailPrompt || t('animate.noScript')}
                </div>
              </div>

              {/* Duration + Status pills */}
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{
                  padding: '6px 12px', background: 'rgba(255,255,255,0.04)',
                  borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)',
                }}>
                  {detailDuration != null ? t('animate.seconds', detailDuration) : t('animate.smart')}
                </div>
                <div style={{
                  padding: '6px 12px', borderRadius: 8,
                  border: '1px solid',
                  fontSize: '0.78rem', fontWeight: 500,
                  ...(detailAnimation?.status === 'completed'
                    ? { color: 'rgba(74,222,128,0.9)', borderColor: 'rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.06)' }
                    : detailAnimation?.status === 'processing'
                    ? { color: 'rgba(217,70,239,0.9)', borderColor: 'rgba(217,70,239,0.2)', background: 'rgba(217,70,239,0.06)' }
                    : { color: 'rgba(239,68,68,0.9)', borderColor: 'rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)' }),
                }}>
                  {detailAnimation?.status === 'completed' ? t('video.completed')
                    : detailAnimation?.status === 'processing' ? t('video.rendering')
                    : detailAnimation?.status === 'failed' ? t('video.failed')
                    : t('video.abandoned')}
                </div>
              </div>
            </>
          ) : (
            /* ─── CREATE MODE ─── */
            <>
              {/* Filmstrip — clickable thumbnails with delete */}
              <div style={{
                display: 'flex', gap: 8, marginBottom: 16,
                flexWrap: 'wrap', paddingBottom: 4,
              }}>
                {allSnapshots.map((s, i) => {
                  const excluded = excludedIndices.has(i);
                  if (excluded) return null;
                  const activeIdx = allSnapshots.slice(0, i + 1).filter((_, j) => !excludedIndices.has(j)).length;
                  return (
                    <div key={s.id} style={{
                      flexShrink: 0, position: 'relative',
                    }}>
                      <button
                        className="animate-sheet-thumb"
                        onClick={() => { setSelectedThumbId(s.id); onPreviewImage?.(s.id); }}
                        style={{
                          width: thumbSize, height: thumbSize, borderRadius: 10,
                          overflow: 'hidden', background: 'rgba(255,255,255,0.04)',
                          border: selectedThumbId === s.id ? '2.5px solid rgba(217,70,239,0.9)' : '1.5px solid rgba(255,255,255,0.1)',
                          boxShadow: selectedThumbId === s.id ? '0 0 8px rgba(217,70,239,0.3)' : 'none',
                          cursor: 'pointer', padding: 0, display: 'block',
                          transition: 'border-color 0.15s, box-shadow 0.15s',
                        }}
                        onMouseEnter={e => { if (selectedThumbId !== s.id) e.currentTarget.style.borderColor = 'rgba(217,70,239,0.5)'; }}
                        onMouseLeave={e => { if (selectedThumbId !== s.id) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={s.imageUrl!}
                          alt={`snapshot ${activeIdx}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                        />
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={() => setExcludedIndices(prev => new Set([...prev, i]))}
                        style={{
                          position: 'absolute', top: -5, right: -5, zIndex: 2,
                          width: 18, height: 18, borderRadius: '50%',
                          background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.15)',
                          color: 'rgba(255,255,255,0.7)', fontSize: '0.6rem',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', lineHeight: 1,
                        }}
                      >&times;</button>
                      {/* @index label */}
                      <div style={{
                        position: 'absolute', bottom: 2, right: 3,
                        fontSize: '0.55rem', color: 'rgba(255,255,255,0.8)',
                        background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '0px 4px',
                        fontWeight: 600, letterSpacing: '0.02em', pointerEvents: 'none',
                      }}>@{activeIdx}</div>
                    </div>
                  );
                })}
                {activeSnapshots.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8rem', padding: '12px 0' }}>
                    {t('animate.allImagesRemoved')}
                  </div>
                )}
              </div>

              {/* Image count + action badges */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14,
                flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: '3px 8px', borderRadius: 6,
                }}>
                  {t('animate.imageCount', activeSnapshots.length)}
                </span>
                {onOpenCUI && !isDesktop && status !== 'idle' && (
                  <button
                    onClick={onOpenCUI}
                    style={{
                      background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.4)', borderRadius: 6, padding: '3px 8px',
                      fontSize: '0.7rem', cursor: 'pointer',
                    }}
                  >
                    {t('chat.viewInChat')}
                  </button>
                )}
                {/* AI rewrite button */}
                {status === 'generating_prompt' ? (
                  <span style={{
                    fontSize: '0.7rem', color: 'rgba(217,70,239,0.7)',
                    background: 'linear-gradient(90deg, rgba(217,70,239,0.08) 0%, rgba(168,85,247,0.12) 50%, rgba(217,70,239,0.08) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 2s linear infinite',
                    padding: '3px 8px', borderRadius: 6,
                  }}>
                    {t('animate.aiWritingShort')}
                  </span>
                ) : status !== 'submitting' && prompt.trim() ? (
                  <button
                    onClick={handleGenerateScript}
                    disabled={!canGenerateScript}
                    style={{
                      background: 'none', border: '1px solid rgba(217,70,239,0.3)',
                      color: 'rgba(217,70,239,0.8)', borderRadius: 6, padding: '3px 8px',
                      fontSize: '0.7rem', cursor: canGenerateScript ? 'pointer' : 'default',
                      opacity: canGenerateScript ? 1 : 0.4,
                    }}
                  >
                    {status === 'error' ? t('animate.aiRetry') : t('animate.aiRewrite')}
                  </button>
                ) : null}
              </div>

              {/* User hint — optional requirements */}
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)',
                  fontWeight: 600, marginBottom: 5, letterSpacing: '0.03em',
                }}>
                  {t('animate.hintLabel')}
                </div>
                <input
                  type="text"
                  value={userHint}
                  onChange={e => onStateChange({ userHint: e.target.value })}
                  placeholder={t('animate.hintPlaceholder')}
                  disabled={status === 'generating_prompt' || status === 'submitting'}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 10, padding: '9px 12px',
                    color: '#fff',
                    fontSize: isDesktop ? '0.82rem' : '0.9rem',
                    outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'rgba(217,70,239,0.4)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>

              {/* Script textarea — auto-resizes */}
              <div style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)',
                  fontWeight: 600, marginBottom: 5, letterSpacing: '0.03em',
                }}>
                  {t('animate.storyLabel')}
                </div>
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => {
                    onStateChange({ prompt: e.target.value });
                    if (status !== 'ready') onStateChange({ status: 'ready' });
                  }}
                  disabled={status === 'generating_prompt'}
                  placeholder={status === 'generating_prompt' ? t('animate.aiAnalyzing') : t('animate.storyPlaceholder')}
                  style={{
                    width: '100%', minHeight: 80,
                    backgroundColor: status === 'generating_prompt' ? 'transparent' : 'rgba(255,255,255,0.04)',
                    backgroundImage: status === 'generating_prompt'
                      ? 'linear-gradient(90deg, rgba(217,70,239,0.04) 0%, rgba(168,85,247,0.08) 50%, rgba(217,70,239,0.04) 100%)'
                      : 'none',
                    backgroundSize: '200% 100%',
                    animation: status === 'generating_prompt' ? 'shimmer 2s linear infinite' : 'none',
                    border: '1px solid',
                    borderColor: status === 'generating_prompt' ? 'rgba(217,70,239,0.2)' : 'rgba(255,255,255,0.08)',
                    borderRadius: 14, padding: '12px 14px',
                    color: status === 'generating_prompt' ? 'rgba(255,255,255,0.4)' : '#fff',
                    fontSize: isDesktop ? '0.85rem' : '0.95rem', lineHeight: 1.65,
                    resize: 'none', outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.2s, background 0.2s',
                    overflow: 'hidden',
                  }}
                  onFocus={e => {
                    if (status !== 'generating_prompt') e.currentTarget.style.borderColor = 'rgba(217,70,239,0.4)';
                  }}
                  onBlur={e => {
                    if (status !== 'generating_prompt') e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  }}
                />
              </div>

              {/* Duration + cost row */}
              {status !== 'submitting' && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)',
                      fontWeight: 600, marginBottom: 5, letterSpacing: '0.03em',
                    }}>{t('animate.duration')}</div>
                    <select
                      value={duration ?? 'smart'}
                      onChange={e => {
                        const v = e.target.value;
                        onStateChange({ duration: v === 'smart' ? null : Number(v) });
                      }}
                      style={{
                        width: '100%', background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10, padding: '9px 12px',
                        color: '#fff', fontSize: '0.82rem', cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      {([3, 5, 7, 10, 15] as const).map(s => (
                        <option key={s} value={s}>{t('animate.seconds', s)}</option>
                      ))}
                      <option value="smart">{t('animate.smart')}</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)',
                      fontWeight: 600, marginBottom: 5, letterSpacing: '0.03em',
                    }}>{t('animate.costEstimate')}</div>
                    <div style={{
                      padding: '9px 12px', background: 'rgba(255,255,255,0.03)',
                      borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)',
                      fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)',
                    }}>
                      {duration != null ? `~$${(duration * 0.112).toFixed(2)}` : t('animate.costByDuration')}
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {status === 'error' && error && (
                <div style={{
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 12, padding: '10px 14px', color: 'rgba(239,68,68,0.85)',
                  fontSize: '0.82rem', marginTop: 4,
                }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky bottom button — create mode only */}
        {!isDetail && bottomBtn && (
          <div style={{
            padding: '14px 20px',
            paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            <button
              onClick={bottomBtn.onClick}
              disabled={bottomBtn.disabled}
              style={{
                width: '100%', padding: '14px',
                background: !bottomBtn.disabled
                  ? 'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #7c3aed 100%)'
                  : 'rgba(255,255,255,0.06)',
                border: 'none', borderRadius: 14,
                color: !bottomBtn.disabled ? '#fff' : 'rgba(255,255,255,0.25)',
                fontSize: '0.95rem', fontWeight: 700,
                cursor: !bottomBtn.disabled ? 'pointer' : 'not-allowed',
                letterSpacing: '-0.01em',
                transition: 'opacity 0.15s, transform 0.1s',
                boxShadow: !bottomBtn.disabled ? '0 4px 20px rgba(217,70,239,0.3)' : 'none',
              }}
              onMouseDown={e => { if (!bottomBtn.disabled) e.currentTarget.style.transform = 'scale(0.98)'; }}
              onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {bottomBtn.label}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
