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

/** Extract a short title from the video prompt (first meaningful segment, max ~12 chars) */
function videoTitle(prompt: string, index: number): string {
  if (!prompt.trim()) return `视频 ${index + 1}`;
  // Take first line, strip markdown/special chars, truncate
  const firstLine = prompt.split('\n').find(l => l.trim())?.trim() || '';
  const clean = firstLine.replace(/^[#*\->]+\s*/, '').replace(/<<<[^>]*>>>/g, '').trim();
  if (!clean) return `视频 ${index + 1}`;
  return clean.length > 14 ? clean.slice(0, 13) + '…' : clean;
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

  const thumbSize = isDesktop ? 64 : 72;
  const cardWidth = isDesktop ? 176 : 200;

  return (
    <div className="flex flex-col">
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Horizontal pill carousel — mirrors TipsBar layout exactly */}
      <div
        className={`flex items-end gap-2 px-3 pt-2 pb-1.5 overflow-x-auto hide-scrollbar ${isDesktop ? 'min-h-[70px] select-none' : 'min-h-[78px]'}`}
      >
        {all.map((anim, idx) => {
          const isSelected = anim.id === selectedVideoId;
          const isCompleted = anim.status === 'completed' && !!anim.videoUrl;
          const isProcessing = anim.status === 'processing';
          const isFailed = anim.status === 'failed';
          const thumbUrl = anim.snapshotUrls[0];
          const title = videoTitle(anim.prompt, idx);

          // Status line
          let statusText: React.ReactNode;
          if (isCompleted) {
            statusText = anim.duration ? `${anim.duration}s · 已完成` : '已完成';
          } else if (isProcessing) {
            statusText = <><ElapsedTimer since={anim.createdAt} /> 渲染中</>;
          } else if (isFailed) {
            statusText = '失败';
          } else {
            statusText = '已放弃';
          }

          return (
            <div key={anim.id} className="flex-shrink-0 flex items-stretch">
              {/* Main card — click to switch video */}
              <button
                onClick={() => { if (isCompleted) onSelectVideo(anim.id); }}
                className={`text-left hover:brightness-110 active:scale-[0.97] border overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50'
                    : 'border-white/10'
                }`}
                style={{
                  width: cardWidth,
                  borderRadius: '16px 0 0 16px',
                  transition: 'filter 0.15s, transform 0.1s, border-color 0.15s',
                  background: isSelected ? 'rgba(217,70,239,0.12)' : 'rgba(217,70,239,0.06)',
                }}
              >
                <div className="flex">
                  {/* Thumbnail */}
                  <div
                    className="flex-shrink-0 bg-white/5 relative overflow-hidden"
                    style={{ width: thumbSize, height: thumbSize }}
                  >
                    {thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-zinc-800" />
                    )}
                    {/* Play overlay for completed */}
                    {isCompleted && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                      </div>
                    )}
                    {/* Spinner for processing */}
                    {isProcessing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d946ef" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                          <path d="M4 12a8 8 0 018-8" />
                        </svg>
                      </div>
                    )}
                    {/* Duration badge on thumbnail */}
                    {anim.duration && (
                      <div className="absolute bottom-0.5 right-0.5 bg-black/70 rounded text-white/85 leading-none"
                        style={{ fontSize: '0.56rem', padding: '1px 4px' }}
                      >
                        {anim.duration}s
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  <div className={`flex-1 min-w-0 flex flex-col justify-center ${isDesktop ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}>
                    <div className={`text-white font-semibold leading-tight truncate ${isDesktop ? 'text-[12px]' : 'text-[13px]'}`}>
                      {title}
                    </div>
                    <div className={`text-white/50 leading-snug mt-0.5 truncate ${isDesktop ? 'text-[11px]' : 'text-[11px]'}`}>
                      {statusText}
                    </div>
                    {isProcessing && anim.taskId && (
                      <span
                        onClick={(e) => { e.stopPropagation(); onAbandon(anim.taskId!); }}
                        className="text-white/30 mt-0.5 cursor-pointer underline"
                        style={{ fontSize: '0.56rem' }}
                      >
                        放弃
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Detail ">" button — always visible, mirrors TipsBar commit button */}
              <button
                onClick={() => onViewDetail(anim)}
                className={`flex flex-col items-center justify-center border border-l-0 border-white/10 overflow-hidden cursor-pointer active:scale-95 hover:brightness-110 ${
                  isSelected ? 'border-fuchsia-500' : ''
                }`}
                style={{
                  width: isDesktop ? 40 : 44,
                  borderRadius: '0 16px 16px 0',
                  background: 'rgba(255,255,255,0.04)',
                  transition: 'transform 0.1s',
                }}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className="text-white/40"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className={`text-white/30 font-medium ${isDesktop ? 'text-[9px]' : 'text-[10px]'}`}>
                  详情
                </span>
              </button>
            </div>
          );
        })}

        {/* "+ 新视频" dashed card — mirrors TipsBar "更多" button */}
        <button
          onClick={onCreateNew}
          className={`flex-shrink-0 rounded-2xl border border-dashed border-fuchsia-500/30 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer ${isDesktop ? 'w-[44px] h-[64px]' : 'w-[52px] h-[72px]'}`}
          style={{ background: 'rgba(217,70,239,0.06)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-fuchsia-400/50">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[9px] font-medium text-fuchsia-400/60">新视频</span>
        </button>

        {/* Empty state */}
        {all.length === 0 && (
          <div className={`flex-shrink-0 rounded-2xl border border-white/5 flex items-center justify-center text-white/20 ${isDesktop ? 'w-[176px] h-[64px] text-[11px]' : 'w-[200px] h-[72px] text-[12px]'}`}
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            还没有视频
          </div>
        )}
      </div>
    </div>
  );
}
