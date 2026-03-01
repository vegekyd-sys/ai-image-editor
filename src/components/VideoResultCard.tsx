'use client';

import { useState, useEffect } from 'react';
import { ProjectAnimation } from '@/types';

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(since).getTime()) / 1000));

  useEffect(() => {
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [since]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return <span>{mins}:{secs.toString().padStart(2, '0')}</span>;
}

interface VideoResultCardProps {
  animations: ProjectAnimation[];
  selectedVideoId: string | null;
  onSelectVideo: (id: string) => void;
  onCreateNew: () => void;
  onAbandon: (taskId: string) => void;
  onViewDetail: (anim: ProjectAnimation) => void;
  isDesktop?: boolean;
}

export default function VideoResultCard({
  animations, selectedVideoId, onSelectVideo, onCreateNew, onAbandon, onViewDetail, isDesktop,
}: VideoResultCardProps) {
  const completed = animations.filter(a => a.status === 'completed' && a.videoUrl);
  const processing = animations.filter(a => a.status === 'processing');
  const failed = animations.filter(a => a.status === 'failed');
  const all = [...processing, ...completed, ...failed];

  // Desktop: full-height side panel
  if (isDesktop) {
    return (
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0, width: 340,
        borderRadius: 0,
        animation: 'slideLeftResult 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
        zIndex: 300,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
        background: '#0e0e0e',
        display: 'flex', flexDirection: 'column',
      }}>
        <style>{`
          @keyframes slideLeftResult {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        `}</style>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
              视频 ({all.length})
            </span>
            <button
              onClick={onCreateNew}
              style={{
                background: 'none',
                border: '1px solid rgba(217,70,239,0.4)',
                borderRadius: 8, padding: '4px 12px',
                color: 'rgba(217,70,239,0.9)',
                fontSize: '0.75rem', fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + 新视频
            </button>
          </div>

          {all.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem', padding: '20px 0', textAlign: 'center' }}>
              还没有视频
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {all.map(anim => {
              const isSelected = anim.id === selectedVideoId;
              const isCompleted = anim.status === 'completed' && !!anim.videoUrl;
              const isProcessing = anim.status === 'processing';
              const thumbUrl = anim.snapshotUrls[0];

              return (
                <div
                  key={anim.id}
                  onClick={() => {
                    if (isCompleted) onSelectVideo(anim.id);
                  }}
                  style={{
                    display: 'flex', gap: 12, padding: '10px',
                    background: isSelected ? 'rgba(217,70,239,0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isSelected ? 'rgba(217,70,239,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 12,
                    cursor: isCompleted ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{
                    width: 80, height: 60, borderRadius: 8,
                    overflow: 'hidden', background: '#1a1a1a', flexShrink: 0, position: 'relative',
                  }}>
                    {thumbUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    {isCompleted && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                      </div>
                    )}
                    {isProcessing && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d946ef" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                          <path d="M4 12a8 8 0 018-8" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 500 }}>
                        {isCompleted ? '已完成' : isProcessing ? (<>渲染中 <ElapsedTimer since={anim.createdAt} /></>) : '失败'}
                      </span>
                      {anim.duration && (
                        <span style={{
                          fontSize: '0.62rem', color: 'rgba(255,255,255,0.6)',
                          background: 'rgba(255,255,255,0.08)', borderRadius: 4,
                          padding: '1px 5px',
                        }}>{anim.duration}s</span>
                      )}
                    </div>
                    {isProcessing && anim.taskId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAbandon(anim.taskId!); }}
                        style={{
                          alignSelf: 'flex-start', marginTop: 2,
                          padding: '3px 10px',
                          background: 'none', border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 8, color: 'rgba(255,255,255,0.4)',
                          fontSize: '0.68rem', cursor: 'pointer',
                        }}
                      >
                        放弃
                      </button>
                    )}
                  </div>

                  {/* Detail button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onViewDetail(anim); }}
                    style={{
                      alignSelf: 'center', flexShrink: 0,
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.08)', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#0e0e0e',
        }}>
          <button
            onClick={onCreateNew}
            style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #d946ef, #a855f7)',
              border: 'none', borderRadius: 12,
              color: '#fff',
              fontSize: '0.95rem', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + 生成新视频
          </button>
        </div>

        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // ─── Mobile: pill-strip (same height as TipsBar ~90px) ───
  return (
    <div style={{
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      zIndex: 30,
      background: 'linear-gradient(to top, rgba(0,0,0,0.85) 60%, transparent)',
      paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
    }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Horizontal scroll of pills */}
      <div
        className="hide-scrollbar"
        style={{
          display: 'flex', alignItems: 'flex-end',
          gap: 8, padding: '8px 12px 4px',
          overflowX: 'auto', overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {all.map(anim => {
          const isSelected = anim.id === selectedVideoId;
          const isCompleted = anim.status === 'completed' && !!anim.videoUrl;
          const isProcessing = anim.status === 'processing';
          const isFailed = anim.status === 'failed';
          const thumbUrl = anim.snapshotUrls[0];

          return (
            <div
              key={anim.id}
              style={{
                flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 0,
                background: isSelected ? 'rgba(217,70,239,0.12)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isSelected ? 'rgba(217,70,239,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 16,
                overflow: 'hidden',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              {/* Clickable area: thumbnail + info → switches video */}
              <button
                onClick={() => { if (isCompleted) onSelectVideo(anim.id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 0,
                  background: 'none', border: 'none', padding: 0,
                  cursor: isCompleted ? 'pointer' : 'default',
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: 56, height: 56, flexShrink: 0,
                  background: '#1a1a1a', position: 'relative',
                  borderRadius: '15px 0 0 15px', overflow: 'hidden',
                }}>
                  {thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  )}
                  {isCompleted && !isSelected && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  )}
                  {isProcessing && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d946ef" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                        <path d="M4 12a8 8 0 018-8" />
                      </svg>
                    </div>
                  )}
                  {/* Duration badge on thumbnail */}
                  {anim.duration && (
                    <div style={{
                      position: 'absolute', bottom: 2, right: 2,
                      background: 'rgba(0,0,0,0.7)', borderRadius: 3,
                      padding: '0px 4px',
                      fontSize: '0.56rem', color: 'rgba(255,255,255,0.85)',
                      lineHeight: '14px',
                    }}>
                      {anim.duration}s
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{
                  padding: '4px 8px', minWidth: 52,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1,
                }}>
                  <div style={{ fontSize: '0.68rem', color: '#fff', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {isCompleted ? '已完成' : isProcessing ? (<>渲染中 <ElapsedTimer since={anim.createdAt} /></>) : isFailed ? '失败' : '已放弃'}
                  </div>
                  {isProcessing && anim.taskId && (
                    <span
                      onClick={(e) => { e.stopPropagation(); onAbandon(anim.taskId!); }}
                      style={{
                        fontSize: '0.56rem', color: 'rgba(255,255,255,0.3)',
                        cursor: 'pointer', textDecoration: 'underline',
                      }}
                    >
                      放弃
                    </span>
                  )}
                </div>
              </button>

              {/* Detail ">" button */}
              <button
                onClick={(e) => { e.stopPropagation(); onViewDetail(anim); }}
                style={{
                  flexShrink: 0,
                  width: 32, height: 56,
                  background: 'none', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          );
        })}

        {/* + New video pill */}
        <button
          onClick={onCreateNew}
          style={{
            flexShrink: 0, height: 56,
            padding: '0 16px',
            background: 'none',
            border: '1px dashed rgba(217,70,239,0.4)',
            borderRadius: 16,
            color: 'rgba(217,70,239,0.8)',
            fontSize: '0.72rem', fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          + 新视频
        </button>
      </div>
    </div>
  );
}
