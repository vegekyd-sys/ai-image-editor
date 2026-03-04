'use client';

import { useState, useCallback } from 'react';
import { Snapshot, ProjectAnimation } from '@/types';
import type { AnimationState } from '@/components/Editor';
import { useLocale } from '@/lib/i18n';

interface AnimateSheetProps {
  snapshots: Snapshot[];
  projectId: string;
  onClose: () => void;
  onOpenCUI?: () => void;
  onGeneratePrompt?: () => void;
  animationState: AnimationState;
  onStateChange: (update: Partial<AnimationState>) => void;
  isDesktop?: boolean;
  // Detail mode
  mode?: 'create' | 'detail';
  detailAnimation?: ProjectAnimation;
}

export default function AnimateSheet({
  snapshots, projectId, onClose, onOpenCUI, onGeneratePrompt,
  animationState, onStateChange, isDesktop,
  mode = 'create', detailAnimation,
}: AnimateSheetProps) {
  const { t } = useLocale();
  const isDetail = mode === 'detail' && !!detailAnimation;
  const { prompt, status, error, duration } = animationState;

  // Track which snapshot indices are excluded (user deleted from filmstrip)
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());

  // All snapshots with valid URLs
  const allSnapshots = snapshots.filter(s => s.imageUrl?.startsWith('http'));
  // Active images (excluding user-removed ones)
  const activeSnapshots = allSnapshots.filter((_, i) => !excludedIndices.has(i));
  const activeUrls = activeSnapshots.map(s => s.imageUrl!);

  const thumbSize = isDesktop ? 72 : 80;

  const handleGenerateScript = useCallback(() => {
    if (activeUrls.length < 1) return;
    const urls = activeUrls.length <= 7
      ? activeUrls
      : [0, 1, 2, Math.floor(activeUrls.length / 2), activeUrls.length - 3, activeUrls.length - 2, activeUrls.length - 1]
        .map(i => activeUrls[Math.min(i, activeUrls.length - 1)]);
    // Update imageUrls + clear error, then trigger generation
    // Editor uses ref to read latest imageUrls, so this works synchronously
    onStateChange({ imageUrls: urls, error: null, prompt: '' });
    onGeneratePrompt?.();
  }, [activeUrls, onStateChange, onGeneratePrompt]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || activeUrls.length < 1) return;
    // Ensure imageUrls are up-to-date with active selection
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
  }, [prompt, projectId, activeUrls, duration, onStateChange]);

  const canGenerate = prompt.trim().length > 0 && status === 'ready' && activeUrls.length >= 1;
  const canGenerateScript = activeUrls.length >= 1 && (status === 'idle' || status === 'error' || status === 'ready');

  // Detail mode: data from the animation record
  const detailUrls = detailAnimation?.snapshotUrls ?? [];
  const detailPrompt = detailAnimation?.prompt ?? '';
  const detailDuration = detailAnimation?.duration;

  // Smart bottom button logic (create mode only)
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

  return (
    <>
      <div style={{
        position: 'fixed',
        ...(isDesktop ? {
          top: 0, right: 0, bottom: 0, width: 340,
          borderRadius: 0,
          animation: 'slideLeftSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
          zIndex: 300,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
        } : {
          bottom: 0, left: 0, right: 0,
          maxHeight: '66dvh',
          borderRadius: '20px 20px 0 0',
          animation: 'slideUpSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
          zIndex: 202,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
        }),
        background: '#0e0e0e',
        display: 'flex', flexDirection: 'column',
      }}>
        <style>{`
          @keyframes slideUpSheet {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
          @keyframes slideLeftSheet {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        `}</style>

        {/* X button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 8, right: 12, zIndex: 1,
            background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: '50%',
            color: 'rgba(255,255,255,0.6)', fontSize: '1.1rem',
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >×</button>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 8px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', marginBottom: 10 }}>
            {isDetail ? t('animate.detailTitle') : t('animate.title')}
          </div>

          {/* ─── DETAIL MODE ─── */}
          {isDetail ? (
            <>
              {/* Snapshot filmstrip — read-only, no delete */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, overflowX: 'auto', paddingBottom: 4 }}>
                {detailUrls.map((url, i) => (
                  <div key={i} style={{
                    flexShrink: 0, width: thumbSize, height: thumbSize, borderRadius: 12,
                    overflow: 'hidden', background: '#1a1a1a', position: 'relative',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`snapshot ${i + 1}`}
                      style={{ width: thumbSize, height: thumbSize, objectFit: 'cover', borderRadius: 12, display: 'block' }}
                    />
                    <div style={{
                      position: 'absolute', bottom: 3, right: 4,
                      fontSize: '0.6rem', color: 'rgba(255,255,255,0.7)',
                      background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '1px 4px',
                    }}>@{i + 1}</div>
                  </div>
                ))}
              </div>

              {/* Prompt — read-only */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500, marginBottom: 6 }}>
                  {t('animate.storyLabel')}
                </div>
                <div style={{
                  width: '100%', minHeight: 80,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: '10px',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: isDesktop ? '0.88rem' : '1.05rem', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {detailPrompt || t('animate.noScript')}
                </div>
              </div>

              {/* Duration — static */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{t('animate.duration')}</div>
                  <div style={{
                    padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)',
                  }}>
                    {detailDuration != null ? t('animate.seconds', detailDuration) : t('animate.smart')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{t('animate.status')}</div>
                  <div style={{
                    padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: '0.82rem',
                    color: detailAnimation?.status === 'completed' ? 'rgba(74,222,128,0.9)'
                      : detailAnimation?.status === 'processing' ? 'rgba(217,70,239,0.9)'
                      : 'rgba(239,68,68,0.9)',
                  }}>
                    {detailAnimation?.status === 'completed' ? t('video.completed')
                      : detailAnimation?.status === 'processing' ? t('video.rendering')
                      : detailAnimation?.status === 'failed' ? t('video.failed')
                      : t('video.abandoned')}
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* ─── CREATE MODE (original) ─── */
            <>
              {/* Snapshot filmstrip — larger thumbnails with delete button */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, overflowX: 'auto', paddingBottom: 4, flexWrap: 'wrap' }}>
                {allSnapshots.map((s, i) => {
                  const excluded = excludedIndices.has(i);
                  if (excluded) return null;
                  // Compute active index for @reference
                  const activeIdx = allSnapshots.slice(0, i + 1).filter((_, j) => !excludedIndices.has(j)).length;
                  return (
                    <div key={s.id} style={{
                      flexShrink: 0, width: thumbSize, height: thumbSize, borderRadius: 12,
                      overflow: 'visible', background: '#1a1a1a', position: 'relative',
                    }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.imageUrl!}
                        alt={`snapshot ${activeIdx}`}
                        style={{ width: thumbSize, height: thumbSize, objectFit: 'cover', borderRadius: 12, display: 'block' }}
                      />
                      {/* Delete button */}
                      <button
                        onClick={() => setExcludedIndices(prev => new Set([...prev, i]))}
                        style={{
                          position: 'absolute', top: -6, right: -6, zIndex: 2,
                          width: 20, height: 20, borderRadius: '50%',
                          background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)',
                          color: 'rgba(255,255,255,0.8)', fontSize: '0.65rem',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', lineHeight: 1,
                        }}
                      >×</button>
                      {/* @index label */}
                      <div style={{
                        position: 'absolute', bottom: 3, right: 4,
                        fontSize: '0.6rem', color: 'rgba(255,255,255,0.7)',
                        background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '1px 4px',
                      }}>@{activeIdx}</div>
                    </div>
                  );
                })}
                {activeSnapshots.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', padding: '10px 0' }}>
                    {t('animate.allImagesRemoved')}
                  </div>
                )}
              </div>

              {/* Prompt section — always visible */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{t('animate.storyLabel')}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onOpenCUI && !isDesktop && status !== 'idle' && (
                      <button
                        onClick={onOpenCUI}
                        style={{
                          background: 'none', border: '1px solid rgba(255,255,255,0.15)',
                          color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '3px 10px',
                          fontSize: '0.7rem', cursor: 'pointer',
                        }}
                      >
                        {t('chat.viewInChat')}
                      </button>
                    )}
                    {/* AI generate/rewrite button */}
                    {status === 'generating_prompt' ? (
                      <div style={{
                        border: '1px solid rgba(217,70,239,0.3)',
                        color: 'rgba(217,70,239,0.7)', borderRadius: 8, padding: '3px 10px',
                        fontSize: '0.7rem',
                      }}>
                        {t('animate.aiWritingShort')}
                      </div>
                    ) : status === 'submitting' ? null : (
                      prompt.trim() ? (
                        <button
                          onClick={handleGenerateScript}
                          disabled={!canGenerateScript}
                          style={{
                            background: 'none', border: '1px solid rgba(217,70,239,0.4)',
                            color: 'rgba(217,70,239,0.9)', borderRadius: 8, padding: '3px 10px',
                            fontSize: '0.7rem', cursor: canGenerateScript ? 'pointer' : 'default',
                            opacity: canGenerateScript ? 1 : 0.4,
                          }}
                        >
                          ✨ {status === 'error' ? t('animate.aiRetry') : t('animate.aiRewrite')}
                        </button>
                      ) : null
                    )}
                  </div>
                </div>
                <textarea
                  value={prompt}
                  onChange={e => { onStateChange({ prompt: e.target.value }); if (status !== 'ready') onStateChange({ status: 'ready' }); }}
                  disabled={status === 'generating_prompt'}
                  placeholder={status === 'generating_prompt' ? t('animate.aiAnalyzing') : t('animate.storyPlaceholder')}
                  style={{
                    width: '100%', minHeight: 100,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12, padding: '10px',
                    color: status === 'generating_prompt' ? 'rgba(255,255,255,0.4)' : '#fff',
                    fontSize: isDesktop ? '0.88rem' : '1.05rem', lineHeight: 1.6,
                    resize: 'none', outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Duration + cost */}
              {status !== 'submitting' && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{t('animate.duration')}</div>
                    <select
                      value={duration ?? 'smart'}
                      onChange={e => {
                        const v = e.target.value;
                        onStateChange({ duration: v === 'smart' ? null : Number(v) });
                      }}
                      style={{
                        width: '100%', background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8, padding: '7px 10px',
                        color: '#fff', fontSize: '0.82rem', cursor: 'pointer',
                      }}
                    >
                      {([3, 5, 7, 10, 15] as const).map(s => (
                        <option key={s} value={s}>{t('animate.seconds', s)}</option>
                      ))}
                      <option value="smart">{t('animate.smart')}</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{t('animate.costEstimate')}</div>
                    <div style={{
                      padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                      borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                      fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)',
                    }}>
                      {duration != null ? `~$${(duration * 0.112).toFixed(2)}` : t('animate.costByDuration')}
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {status === 'error' && error && (
                <div style={{
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 10, padding: '10px', color: 'rgba(239,68,68,0.9)',
                  fontSize: '0.82rem', marginTop: 6,
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
            padding: '12px 16px',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: '#0e0e0e',
          }}>
            <button
              onClick={bottomBtn.onClick}
              disabled={bottomBtn.disabled}
              style={{
                width: '100%', padding: '14px',
                background: !bottomBtn.disabled
                  ? 'linear-gradient(135deg, #d946ef, #a855f7)'
                  : 'rgba(217,70,239,0.2)',
                border: 'none', borderRadius: 12,
                color: !bottomBtn.disabled ? '#fff' : 'rgba(255,255,255,0.4)',
                fontSize: '0.95rem', fontWeight: 600,
                cursor: !bottomBtn.disabled ? 'pointer' : 'not-allowed',
              }}
            >
              {bottomBtn.label}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
