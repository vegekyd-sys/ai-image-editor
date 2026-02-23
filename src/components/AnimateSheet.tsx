'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Snapshot } from '@/types';

interface AnimateSheetProps {
  snapshots: Snapshot[];
  projectId: string;
  onClose: () => void;
}

type AnimateStatus = 'idle' | 'generating_prompt' | 'ready' | 'submitting' | 'polling' | 'done' | 'error';

export default function AnimateSheet({ snapshots, projectId, onClose }: AnimateSheetProps) {
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<AnimateStatus>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(10);
  const [pollSeconds, setPollSeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFullscreen, setVideoFullscreen] = useState(false);

  // Only use Supabase Storage URLs (http) — base64 is too large for PiAPI
  const imageUrls = snapshots.map(s => s.imageUrl).filter((u): u is string => !!u && u.startsWith('http'));

  // Auto-generate prompt on open
  useEffect(() => {
    if (imageUrls.length < 2) { setStatus('error'); setError('需要至少 2 张已上传的图片才能生成视频。请等待图片上传完成后重试。'); return; }
    generatePrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generatePrompt = useCallback(async () => {
    setStatus('generating_prompt');
    setPrompt('');
    try {
      const res = await fetch('/api/animate/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls }),
      });
      if (!res.ok || !res.body) throw new Error('Failed to generate prompt');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const { delta } = JSON.parse(payload);
            if (delta) { accumulated += delta; setPrompt(accumulated); }
          } catch { /* skip */ }
        }
      }
      setStatus('ready');
    } catch (err) {
      console.warn('prompt gen error:', err);
      setPrompt('三张照片讲述一个故事：@image_1 作为开场，@image_2 在中段，@image_3 作为结尾，镜头缓缓推进，情绪层层递进。');
      setStatus('ready');
    }
  }, [imageUrls]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, imageUrls, prompt: prompt.trim(), duration }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create task');
      setTaskId(json.taskId);
      setStatus('polling');
      setPollSeconds(0);
      startPolling(json.taskId);
    } catch (err) {
      setError(String(err));
      setStatus('error');
    }
  }, [prompt, projectId, imageUrls, duration]);

  const startPolling = useCallback((tid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    // Elapsed timer
    timerRef.current = setInterval(() => setPollSeconds(s => s + 1), 1000);

    // Poll every 8s
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/animate/${tid}`);
        const data = await res.json();
        if (data.status === 'completed' && data.videoUrl) {
          clearInterval(pollRef.current!);
          clearInterval(timerRef.current!);
          setVideoUrl(data.videoUrl);
          setStatus('done');
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current!);
          clearInterval(timerRef.current!);
          setError('视频生成失败，请重试');
          setStatus('error');
        }
      } catch { /* ignore poll errors */ }
    }, 8000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: '72dvh',
        background: '#0e0e0e',
        borderRadius: '20px 20px 0 0',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        animation: 'slideUpSheet 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
      }}>
        <style>{`
          @keyframes slideUpSheet {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px 12px' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, color: '#fff' }}>🎬 生成视频</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '1.4rem', cursor: 'pointer', padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>

          {/* Snapshot filmstrip — only show snapshots with uploaded URLs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
            {snapshots.filter(s => s.imageUrl?.startsWith('http')).map((s, i) => (
              <div key={s.id} style={{
                flexShrink: 0, width: 64, height: 64, borderRadius: 10,
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
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>✨ 视频故事</div>
              {status === 'ready' && (
                <button
                  onClick={generatePrompt}
                  style={{
                    background: 'none', border: '1px solid rgba(217,70,239,0.4)',
                    color: 'rgba(217,70,239,0.9)', borderRadius: 8, padding: '3px 10px',
                    fontSize: '0.72rem', cursor: 'pointer',
                  }}
                >
                  AI 重写
                </button>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); if (status !== 'ready') setStatus('ready'); }}
              disabled={status === 'generating_prompt' || status === 'submitting' || status === 'polling'}
              placeholder={status === 'generating_prompt' ? 'AI 正在分析照片...' : '描述你的视频故事...'}
              style={{
                width: '100%', minHeight: 100,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '12px',
                color: status === 'generating_prompt' ? 'rgba(255,255,255,0.4)' : '#fff',
                fontSize: '0.88rem', lineHeight: 1.6,
                resize: 'none', outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Options */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>时长</div>
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                disabled={status === 'polling' || status === 'done'}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '8px 10px',
                  color: '#fff', fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                <option value={5}>5 秒</option>
                <option value={10}>10 秒</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>费用预估</div>
              <div style={{
                padding: '8px 10px', background: 'rgba(255,255,255,0.04)',
                borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)',
              }}>
                ~${(duration * 0.168).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Generate button */}
          {(status === 'idle' || status === 'ready' || status === 'error') && (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || status !== 'ready'}
              style={{
                width: '100%', padding: '14px',
                background: !prompt.trim() || status !== 'ready'
                  ? 'rgba(217,70,239,0.2)'
                  : 'linear-gradient(135deg, #d946ef, #a855f7)',
                border: 'none', borderRadius: 14,
                color: !prompt.trim() || status !== 'ready' ? 'rgba(255,255,255,0.4)' : '#fff',
                fontSize: '0.95rem', fontWeight: 600,
                cursor: !prompt.trim() || status !== 'ready' ? 'not-allowed' : 'pointer',
                letterSpacing: '0.02em',
              }}
            >
              🎬 生成视频
            </button>
          )}

          {/* Submitting */}
          {status === 'submitting' && (
            <div style={{ textAlign: 'center', padding: '14px', color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
              提交中...
            </div>
          )}

          {/* Polling progress */}
          {status === 'polling' && (
            <div style={{
              background: 'rgba(217,70,239,0.08)',
              border: '1px solid rgba(217,70,239,0.2)',
              borderRadius: 14, padding: '16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>🎬</div>
              <div style={{ color: '#d946ef', fontWeight: 600, marginBottom: 4 }}>渲染中...</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>
                已等待 {formatTime(pollSeconds)}，约需 3-5 分钟
              </div>
              <div style={{
                marginTop: 10, height: 3, background: 'rgba(255,255,255,0.1)',
                borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', background: '#d946ef',
                  width: `${Math.min(95, (pollSeconds / 300) * 100)}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 12, padding: '12px', color: 'rgba(239,68,68,0.9)',
              fontSize: '0.85rem', marginTop: 8,
            }}>
              {error}
            </div>
          )}

          {/* Video player */}
          {status === 'done' && videoUrl && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>✅ 视频已生成</div>
              <div
                style={{
                  borderRadius: 14, overflow: 'hidden', background: '#000',
                  cursor: 'pointer', position: 'relative',
                }}
                onClick={() => { if (videoRef.current?.requestFullscreen) videoRef.current.requestFullscreen() }}
              >
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  playsInline
                  style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'contain' }}
                />
              </div>
              <button
                onClick={() => window.open(videoUrl, '_blank')}
                style={{
                  marginTop: 10, width: '100%', padding: '11px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 12, color: '#fff',
                  fontSize: '0.88rem', cursor: 'pointer',
                }}
              >
                ↗ 在浏览器打开
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
