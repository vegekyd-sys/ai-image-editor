'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Snapshot } from '@/types';
import type { AnimationState } from '@/components/Editor';

interface AnimateSheetProps {
  snapshots: Snapshot[];
  projectId: string;
  onClose: () => void;
  onOpenCUI?: () => void;
  onGeneratePrompt?: () => void;
  onAbandon?: () => void;
  animationState: AnimationState;
  onStateChange: (update: Partial<AnimationState>) => void;
  isDesktop?: boolean;
}

export default function AnimateSheet({
  snapshots, projectId, onClose, onOpenCUI, onGeneratePrompt, onAbandon,
  animationState, onStateChange, isDesktop,
}: AnimateSheetProps) {
  const { prompt, status, taskId, videoUrl, error, duration, pollSeconds, imageUrls } = animationState;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-generate prompt when status is 'idle' — refresh imageUrls from latest snapshots
  useEffect(() => {
    if (status !== 'idle') return;
    // Rebuild imageUrls from current snapshots (may have more than old 4-image limit)
    const allUrls = snapshots.map(s => s.imageUrl).filter((u): u is string => !!u && u.startsWith('http'));
    const freshUrls = allUrls.length <= 7
      ? allUrls
      : [0, 1, 2, Math.floor(allUrls.length / 2), allUrls.length - 3, allUrls.length - 2, allUrls.length - 1].map(i => allUrls[Math.min(i, allUrls.length - 1)]);
    if (freshUrls.length < 2) {
      onStateChange({ status: 'error', error: '需要至少 2 张已上传的图片才能生成视频。请等待图片上传完成后重试。' });
      return;
    }
    onStateChange({ imageUrls: freshUrls });
    onGeneratePrompt?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Resume polling on mount if status is 'polling' and we have a taskId
  useEffect(() => {
    if (status === 'polling' && taskId) {
      startPolling(taskId);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = useCallback((tid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/animate/${tid}`);
        const data = await res.json();
        if (data.status === 'completed' && data.videoUrl) {
          clearInterval(pollRef.current!);
          onStateChange({ videoUrl: data.videoUrl, status: 'done' });
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!);
          onStateChange({ error: '视频生成失败，请重试', status: 'error' });
        }
      } catch { /* ignore */ }
    }, 4000);
  }, [onStateChange]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    onStateChange({ status: 'submitting', error: null });
    try {
      const res = await fetch('/api/animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, imageUrls, prompt: prompt.trim(), duration }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create task');
      onStateChange({ taskId: json.taskId, status: 'polling', pollSeconds: 0 });
      startPolling(json.taskId);
    } catch (err) {
      const raw = String(err);
      const friendly = raw.includes('523') || raw.includes('unreachable') ? '视频服务暂时不可用，请稍后重试'
        : raw.includes('500') || raw.includes('502') || raw.includes('503') ? '视频服务出错，请稍后重试'
        : raw.replace(/Error:\s*/g, '').replace(/<[^>]+>/g, '').slice(0, 100);
      onStateChange({ error: friendly, status: 'error' });
    }
  }, [prompt, projectId, imageUrls, duration, onStateChange, startPolling]);

  // pollSeconds is incremented by Editor (persists even when sheet is closed)

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* No backdrop — canvas stays fully visible */}

      {/* Sheet — compact, no overlay. Desktop: absolute within GUI; Mobile: fixed full-width */}
      <div style={{
        position: isDesktop ? 'absolute' : 'fixed',
        bottom: 0, left: 0, right: 0,
        maxHeight: isDesktop ? '40%' : '28dvh',
        background: '#0e0e0e',
        borderRadius: '20px 20px 0 0',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        animation: 'slideUpSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
      }}>
        <style>{`
          @keyframes slideUpSheet {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>

        {/* X button — floating fixed in top-right corner of sheet */}
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

        {/* Scrollable content — everything scrolls */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', marginBottom: 8 }}>生成视频</div>

          {/* Snapshot filmstrip — @image references */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {snapshots.filter(s => s.imageUrl?.startsWith('http')).map((s, i) => (
              <div key={s.id} style={{
                flexShrink: 0, width: 56, height: 56, borderRadius: 10,
                overflow: 'hidden', background: '#1a1a1a', position: 'relative',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.imageUrl!}
                  alt={`snapshot ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute', bottom: 2, right: 3,
                  fontSize: '0.55rem', color: 'rgba(255,255,255,0.7)',
                  background: 'rgba(0,0,0,0.5)', borderRadius: 3, padding: '1px 3px',
                }}>@{i + 1}</div>
              </div>
            ))}
          </div>

          {/* Prompt section */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>✨ 视频故事</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {onOpenCUI && (
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
                {status === 'ready' && (
                  <button
                    onClick={() => onStateChange({ status: 'idle' })}
                    style={{
                      background: 'none', border: '1px solid rgba(217,70,239,0.4)',
                      color: 'rgba(217,70,239,0.9)', borderRadius: 8, padding: '3px 10px',
                      fontSize: '0.7rem', cursor: 'pointer',
                    }}
                  >
                    AI 重写
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={e => { onStateChange({ prompt: e.target.value }); if (status !== 'ready') onStateChange({ status: 'ready' }); }}
              disabled={status === 'generating_prompt' || status === 'submitting' || status === 'polling'}
              placeholder={status === 'generating_prompt' ? 'AI 正在分析照片...' : '描述你的视频故事...'}
              style={{
                width: '100%', minHeight: 80,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '10px',
                color: status === 'generating_prompt' ? 'rgba(255,255,255,0.4)' : '#fff',
                fontSize: '0.82rem', lineHeight: 1.5,
                resize: 'none', outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Duration + cost */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>时长</div>
              <select
                value={duration ?? 'smart'}
                onChange={e => {
                  const v = e.target.value
                  onStateChange({ duration: v === 'smart' ? null : Number(v) })
                }}
                disabled={status === 'polling' || status === 'done'}
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

          {/* Generate button */}
          {(status === 'idle' || status === 'generating_prompt' || status === 'ready' || status === 'error') && (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || status !== 'ready'}
              style={{
                width: '100%', padding: '12px',
                background: !prompt.trim() || status !== 'ready'
                  ? 'rgba(217,70,239,0.2)'
                  : 'linear-gradient(135deg, #d946ef, #a855f7)',
                border: 'none', borderRadius: 12,
                color: !prompt.trim() || status !== 'ready' ? 'rgba(255,255,255,0.4)' : '#fff',
                fontSize: '0.9rem', fontWeight: 600,
                cursor: !prompt.trim() || status !== 'ready' ? 'not-allowed' : 'pointer',
              }}
            >
              {status === 'generating_prompt' ? '✨ AI 正在写脚本...' : '🎬 生成视频'}
            </button>
          )}

          {/* Submitting */}
          {status === 'submitting' && (
            <div style={{ textAlign: 'center', padding: '12px', color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
              提交中...
            </div>
          )}

          {/* Polling progress */}
          {status === 'polling' && (
            <div style={{
              background: 'rgba(217,70,239,0.08)',
              border: '1px solid rgba(217,70,239,0.2)',
              borderRadius: 12, padding: '14px',
              textAlign: 'center',
            }}>
              <div style={{ color: '#d946ef', fontWeight: 600, marginBottom: 4, fontSize: '0.88rem' }}>渲染中...</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem' }}>
                已等待 {formatTime(pollSeconds)}，约需 3-5 分钟
              </div>
              <div style={{
                marginTop: 8, height: 3, background: 'rgba(255,255,255,0.1)',
                borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', background: '#d946ef',
                  width: `${Math.min(95, (pollSeconds / 300) * 100)}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
              <button
                onClick={onAbandon}
                style={{
                  marginTop: 12, padding: '8px 20px',
                  background: 'none', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10, color: 'rgba(255,255,255,0.4)',
                  fontSize: '0.78rem', cursor: 'pointer',
                }}
              >
                放弃
              </button>
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

          {/* Done — video is in canvas, show regenerate */}
          {status === 'done' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => onStateChange({ status: 'idle', prompt: '', taskId: null, videoUrl: null, error: null, pollSeconds: 0 })}
                style={{
                  flex: 1, padding: '12px',
                  background: 'rgba(217,70,239,0.08)',
                  border: '1px solid rgba(217,70,239,0.2)',
                  borderRadius: 12, color: '#d946ef',
                  fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                重新生成视频
              </button>
              <button
                onClick={() => { if (videoUrl) window.open(videoUrl, '_blank'); }}
                style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, color: 'rgba(255,255,255,0.7)',
                  fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                ↗ 打开
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
