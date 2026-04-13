'use client';

import { useState, useEffect, useRef } from 'react';
import { ProjectAnimation } from '@/types';
import { useLocale } from '@/lib/i18n';
import PillCarousel from '@/components/PillCarousel';

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
  const { t } = useLocale();

  function videoTitle(prompt: string, index: number): string {
    if (!prompt.trim()) return t('video.title', index + 1);
    const firstLine = prompt.split('\n').find(l => l.trim())?.trim() || '';
    const clean = firstLine.replace(/^[#*\->]+\s*/, '').replace(/<<<[^>]*>>>/g, '').trim();
    if (!clean) return t('video.title', index + 1);
    return clean.length > 14 ? clean.slice(0, 13) + '…' : clean;
  }

  const completed = animations.filter(a => a.status === 'completed' && a.videoUrl);
  const processing = animations.filter(a => a.status === 'processing');
  const failed = animations.filter(a => a.status === 'failed');
  const all = [...processing, ...completed, ...failed];

  const thumbSize = isDesktop ? 64 : 72;
  const cardWidth = isDesktop ? 176 : 200;

  const selectedPillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedPillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedVideoId]);

  const toolbar = (
    <span className={`text-white/20 tracking-wide font-medium ${isDesktop ? 'text-[10px]' : 'text-[11px]'}`}>
      {t('video.count', all.length)}
    </span>
  );

  return (
    <>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <PillCarousel toolbar={toolbar} isDesktop={isDesktop}>
        {all.map((anim, idx) => {
          const isSelected = anim.id === selectedVideoId;
          const isCompleted = anim.status === 'completed' && !!anim.videoUrl;
          const isProcessing = anim.status === 'processing';
          const isFailed = anim.status === 'failed';
          const thumbUrl = anim.snapshotUrls[0];
          const title = videoTitle(anim.prompt, idx);

          let statusText: React.ReactNode;
          if (isCompleted) {
            statusText = anim.duration ? `${anim.duration}s · ${t('video.completed')}` : t('video.completed');
          } else if (isProcessing) {
            statusText = <><ElapsedTimer since={anim.createdAt} /> {t('video.rendering')}</>;
          } else if (isFailed) {
            statusText = t('video.failed');
          } else {
            statusText = t('video.abandoned');
          }

          return (
            <div
              key={anim.id}
              ref={isSelected ? selectedPillRef : undefined}
              className={`flex-shrink-0 flex items-stretch rounded-2xl overflow-hidden border transition-all animate-tip-in ${
                isSelected
                  ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50'
                  : 'border-white/10'
              }`}
              style={{ background: isSelected ? 'rgba(217,70,239,0.12)' : 'rgba(217,70,239,0.06)' }}
            >
              <button
                onClick={() => { if (isCompleted) onSelectVideo(anim.id); }}
                className="text-left hover:brightness-110 active:scale-[0.97] overflow-hidden cursor-pointer"
                style={{
                  width: cardWidth,
                  transition: 'filter 0.15s, transform 0.1s',
                  background: 'transparent',
                  border: 'none',
                }}
              >
                <div className="flex">
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
                    {isCompleted && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                      </div>
                    )}
                    {isProcessing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d946ef" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                          <path d="M4 12a8 8 0 018-8" />
                        </svg>
                      </div>
                    )}
                    {anim.duration && (
                      <div className="absolute bottom-0.5 right-0.5 bg-black/70 rounded text-white/85 leading-none"
                        style={{ fontSize: '0.56rem', padding: '1px 4px' }}
                      >
                        {anim.duration}s
                      </div>
                    )}
                  </div>

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
                        {t('video.abandon')}
                      </span>
                    )}
                  </div>
                </div>
              </button>

              <button
                onClick={() => onViewDetail(anim)}
                className="flex flex-col items-center justify-center overflow-hidden cursor-pointer active:scale-95 hover:brightness-110"
                style={{
                  width: isDesktop ? 40 : 44,
                  background: 'rgba(255,255,255,0.03)',
                  borderLeft: '1px solid rgba(255,255,255,0.06)',
                  transition: 'transform 0.1s',
                  border: 'none',
                  borderLeftWidth: 1,
                  borderLeftStyle: 'solid',
                  borderLeftColor: 'rgba(255,255,255,0.06)',
                }}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={isSelected ? 'text-fuchsia-300' : 'text-white/40'}
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className={`font-medium ${isDesktop ? 'text-[9px]' : 'text-[10px]'} ${isSelected ? 'text-fuchsia-300/60' : 'text-white/30'}`}>
                  {t('video.detail')}
                </span>
              </button>
            </div>
          );
        })}

        <button
          onClick={onCreateNew}
          className={`flex-shrink-0 rounded-2xl border border-dashed border-fuchsia-500/30 flex flex-row items-center justify-center gap-1.5 active:scale-95 transition-transform cursor-pointer px-4 ${isDesktop ? 'h-[64px]' : 'h-[72px]'}`}
          style={{ background: 'rgba(217,70,239,0.06)', minWidth: isDesktop ? 80 : 90 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-fuchsia-400/60">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className={`font-medium text-fuchsia-400/70 ${isDesktop ? 'text-[11px]' : 'text-[12px]'}`}>{t('video.newVideo')}</span>
        </button>

        {all.length === 0 && (
          <div className={`flex-shrink-0 rounded-2xl border border-white/5 flex items-center justify-center text-white/20 ${isDesktop ? 'w-[176px] h-[64px] text-[11px]' : 'w-[200px] h-[72px] text-[12px]'}`}
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            {t('video.noVideos')}
          </div>
        )}
      </PillCarousel>
    </>
  );
}
