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

function relativeTime(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

interface VideoResultCardProps {
  animations: ProjectAnimation[];
  selectedVideoId: string | null;
  onSelectVideo: (id: string) => void;
  onCreateNew: () => void;
  onAbandon: (taskId: string) => void;
  onClose: () => void;
  onViewDetail: (anim: ProjectAnimation) => void;
  isDesktop?: boolean;
}

export default function VideoResultCard({
  animations, selectedVideoId, onSelectVideo, onCreateNew, onAbandon, onClose, onViewDetail, isDesktop,
}: VideoResultCardProps) {
  const completed = animations.filter(a => a.status === 'completed' && a.videoUrl);
  const processing = animations.filter(a => a.status === 'processing');
  const failed = animations.filter(a => a.status === 'failed');
  const all = [...processing, ...completed, ...failed];

  // Desktop: full-height side panel (unchanged layout style)
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

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 8px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', marginBottom: 12 }}>
            视频 ({all.length})
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
                    onViewDetail(anim);
                  }}
                  style={{
                    display: 'flex', gap: 12, padding: '10px',
                    background: isSelected ? 'rgba(217,70,239,0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isSelected ? 'rgba(217,70,239,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 12,
                    cursor: 'pointer',
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
                    <div style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 500 }}>
                      {isCompleted ? '已完成' : isProcessing ? (<>渲染中 <ElapsedTimer since={anim.createdAt} /></>) : '失败'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
                      {relativeTime(anim.createdAt)}
                      {anim.duration ? ` · ${anim.duration}s` : ''}
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

  // Mobile: compact horizontal strip (matches TipsBar height ~160-180px)
  return (
    <div style={{
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      borderRadius: '20px 20px 0 0',
      animation: 'slideUpResult 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
      zIndex: 201,
      boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
      background: '#0e0e0e',
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes slideUpResult {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Top row: title + close + new */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px 6px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
            视频 ({all.length})
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%',
              color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem',
              width: 24, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >×</button>
        </div>
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

      {/* Horizontal scroll of video cards */}
      <div style={{
        overflowX: 'auto', overflowY: 'hidden',
        padding: '4px 16px',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
        WebkitOverflowScrolling: 'touch',
      }}>
        {all.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', padding: '20px 0', textAlign: 'center' }}>
            还没有视频
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            {all.map(anim => {
              const isSelected = anim.id === selectedVideoId;
              const isCompleted = anim.status === 'completed' && !!anim.videoUrl;
              const isProcessing = anim.status === 'processing';
              const isFailed = anim.status === 'failed';
              const thumbUrl = anim.snapshotUrls[0];

              return (
                <div
                  key={anim.id}
                  onClick={() => {
                    if (isCompleted) onSelectVideo(anim.id);
                    onViewDetail(anim);
                  }}
                  style={{
                    flexShrink: 0, width: 120,
                    background: isSelected ? 'rgba(217,70,239,0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isSelected ? 'rgba(217,70,239,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {/* Thumbnail 120x120 */}
                  <div style={{
                    width: 120, height: 120,
                    background: '#1a1a1a', position: 'relative',
                  }}>
                    {thumbUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    )}
                    {isCompleted && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                      </div>
                    )}
                    {isProcessing && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d946ef" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                          <path d="M4 12a8 8 0 018-8" />
                        </svg>
                      </div>
                    )}
                    {/* Duration badge */}
                    {anim.duration && (
                      <div style={{
                        position: 'absolute', bottom: 4, right: 4,
                        background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                        padding: '1px 5px',
                        fontSize: '0.62rem', color: 'rgba(255,255,255,0.8)',
                      }}>
                        {anim.duration}s
                      </div>
                    )}
                  </div>

                  {/* Info row */}
                  <div style={{ padding: '6px 8px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#fff', fontWeight: 500, marginBottom: 2 }}>
                      {isCompleted ? '已完成' : isProcessing ? (<>渲染中 <ElapsedTimer since={anim.createdAt} /></>) : isFailed ? '失败' : '已放弃'}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)' }}>
                      {relativeTime(anim.createdAt)}
                    </div>
                    {isProcessing && anim.taskId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAbandon(anim.taskId!); }}
                        style={{
                          marginTop: 4, width: '100%',
                          padding: '3px 0',
                          background: 'none', border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 6, color: 'rgba(255,255,255,0.35)',
                          fontSize: '0.62rem', cursor: 'pointer',
                        }}
                      >
                        放弃
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
