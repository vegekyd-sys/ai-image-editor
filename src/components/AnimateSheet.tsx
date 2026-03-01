'use client';

import { useState, useCallback } from 'react';
import { Snapshot, ProjectAnimation } from '@/types';
import type { AnimationState } from '@/components/Editor';

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
      const friendly = raw.includes('523') || raw.includes('unreachable') ? '视频服务暂时不可用，请稍后重试'
        : raw.includes('500') || raw.includes('502') || raw.includes('503') ? '视频服务出错，请稍后重试'
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
      return { label: '提交中...', disabled: true, onClick: () => {} };
    }
    if (status === 'generating_prompt') {
      return { label: '✨ AI 正在写脚本...', disabled: true, onClick: () => {} };
    }
    if (!prompt.trim()) {
      return { label: '✨ 生成脚本', disabled: !canGenerateScript, onClick: handleGenerateScript };
    }
    return { label: '🎬 生成视频', disabled: !canGenerate, onClick: handleGenerate };
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
            {isDetail ? '视频详情' : '生成视频'}
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
                  ✨ 视频故事
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
                  {detailPrompt || '（无脚本）'}
                </div>
              </div>

              {/* Duration — static */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>时长</div>
                  <div style={{
                    padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)',
                  }}>
                    {detailDuration != null ? `${detailDuration} 秒` : '智能'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>状态</div>
                  <div style={{
                    padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                    borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: '0.82rem',
                    color: detailAnimation?.status === 'completed' ? 'rgba(74,222,128,0.9)'
                      : detailAnimation?.status === 'processing' ? 'rgba(217,70,239,0.9)'
                      : 'rgba(239,68,68,0.9)',
                  }}>
                    {detailAnimation?.status === 'completed' ? '已完成'
                      : detailAnimation?.status === 'processing' ? '渲染中'
                      : detailAnimation?.status === 'failed' ? '失败'
                      : '已放弃'}
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
                    所有图片已移除
                  </div>
                )}
              </div>

              {/* Prompt section — always visible */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>✨ 视频故事</div>
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
                        在 Chat 里看 ↗
                      </button>
                    )}
                    {/* AI generate/rewrite button */}
                    {status === 'generating_prompt' ? (
                      <div style={{
                        border: '1px solid rgba(217,70,239,0.3)',
                        color: 'rgba(217,70,239,0.7)', borderRadius: 8, padding: '3px 10px',
                        fontSize: '0.7rem',
                      }}>
                        AI 正在写...
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
                          ✨ {status === 'error' ? 'AI 重试' : 'AI 重写'}
                        </button>
                      ) : null
                    )}
                  </div>
                </div>
                <textarea
                  value={prompt}
                  onChange={e => { onStateChange({ prompt: e.target.value }); if (status !== 'ready') onStateChange({ status: 'ready' }); }}
                  disabled={status === 'generating_prompt'}
                  placeholder={status === 'generating_prompt' ? 'AI 正在分析照片...' : '描述你的视频故事...'}
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
                    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>时长</div>
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
                      <option value={3}>3 秒</option>
                      <option value={5}>5 秒</option>
                      <option value={7}>7 秒</option>
                      <option value={10}>10 秒</option>
                      <option value={15}>15 秒</option>
                      <option value="smart">智能</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>费用预估</div>
                    <div style={{
                      padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                      borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                      fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)',
                    }}>
                      {duration != null ? `~$${(duration * 0.112).toFixed(2)}` : '按实际时长'}
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
