'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useLocale } from '@/lib/i18n';
import { buildVideoProxyUrl } from '@/lib/video-playback-url';

export default function VideoRetakeTimeline({ url, duration, time, sourceOffset = 0, isDesktop, onSeek, onContinue, onClose }: {
  url: string; duration: number; time: number; sourceOffset?: number;
  isDesktop?: boolean; onSeek?: (time: number) => void;
  onContinue: (start: number, end: number) => void; onClose: () => void;
}) {
  const { t } = useLocale();
  const length = Math.max(.1, duration);
  const [start, setStart] = useState(Math.min(Math.max(0, time), Math.max(0, length - 4)));
  const [end, setEnd] = useState(Math.min(length, Math.max(0, time) + 4));
  const [frames, setFrames] = useState<string[]>([]);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    const sampler = document.createElement('video');
    sampler.crossOrigin = 'anonymous'; sampler.muted = true; sampler.playsInline = true; sampler.preload = 'auto';
    sampler.setAttribute('aria-hidden', 'true');
    sampler.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    panel.current?.appendChild(sampler);
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const collect = async () => {
      const context = canvas.getContext('2d'); if (!context) return;
      const images: string[] = [];
      for (let i = 0; i < 8 && active; i++) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { sampler.onseeked = null; reject(new Error('seek')); }, 15000);
          sampler.onseeked = () => { clearTimeout(timer); resolve(); };
          sampler.currentTime = Math.min(sampler.duration - .05, sourceOffset + (i + .5) * length / 8);
        });
        if (!active) break;
        context.drawImage(sampler, 0, 0, 160, 90); images.push(canvas.toDataURL('image/jpeg', .65));
        if (active) setFrames([...images]);
      }
      if (active) setFrames(images);
    };
    let proxied = false;
    const load = (src: string) => {
      sampler.onloadeddata = () => { sampler.onloadeddata = null; collect().catch(fallback); };
      sampler.src = src; sampler.load();
    };
    const fallback = () => {
      if (!active || proxied) return;
      // Canvas requires CORS even when native playback succeeds. Reuse the
      // existing range proxy only after direct loading/seeking fails.
      proxied = true; load(buildVideoProxyUrl(url));
    };
    sampler.onerror = fallback;
    const loadTimeout = setTimeout(() => { if (sampler.readyState < 2) fallback(); }, 10000);
    load(url);
    return () => { active = false; clearTimeout(loadTimeout); sampler.onloadeddata = null; sampler.onerror = null; sampler.pause(); sampler.removeAttribute('src'); sampler.load(); sampler.remove(); };
  }, [url, sourceOffset, length]);
  const seek = (at: number) => onSeek?.(at);
  const changeStart = (at: number) => {
    const next = Math.max(0, Math.min(end - .1, at)); setStart(next);
    if (end - next > 15) setEnd(next + 15);
    seek(next);
  };
  const changeEnd = (at: number) => {
    const next = Math.min(length, Math.max(start + .1, at)); setEnd(next);
    if (next - start > 15) setStart(next - 15);
    seek(next);
  };
  const atPointer = (event: PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    return rect && rect.width ? Math.max(0, Math.min(length, Math.round((event.clientX - rect.left) / rect.width * length * 10) / 10)) : start;
  };
  const pointerStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const side = (event.target as HTMLElement).closest<HTMLElement>('[data-range-side]')?.dataset.rangeSide;
    const at = atPointer(event);
    dragging.current = side === 'start' || side === 'end' ? side : Math.abs(at - start) <= Math.abs(at - end) ? 'start' : 'end';
    event.currentTarget.setPointerCapture(event.pointerId);
    (dragging.current === 'start' ? changeStart : changeEnd)(at);
  };
  const keyboardMove = (side: 'start' | 'end', event: KeyboardEvent) => {
    const value = side === 'start' ? start : end;
    const step = event.shiftKey ? 1 : .1;
    const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? value - step
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + step
      : event.key === 'Home' ? 0 : event.key === 'End' ? length : undefined;
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation();
    (side === 'start' ? changeStart : changeEnd)(Math.round(next * 100) / 100);
  };
  const clock = (at: number) => `${Math.floor(at / 60)}:${(at % 60).toFixed(1).padStart(4, '0')}`;
  return <section ref={panel} data-testid="video-retake-timeline" aria-label={t('video.retakeTitle')}
    onMouseDown={event => event.stopPropagation()}
    className="mkr-liquid-pill mkr-liquid-pill-strong relative flex w-full min-w-0 flex-shrink-0 items-stretch overflow-hidden rounded-2xl border border-white/10 animate-tip-in text-white"
    style={{ height: isDesktop ? 64 : 72, background: 'linear-gradient(145deg, rgba(217,70,239,0.10), rgba(12,12,16,0.46))' }}>
    <button type="button" onClick={onClose} aria-label={t('video.retakeClose')} title={t('video.retakeClose')}
      className="flex w-10 flex-shrink-0 items-center justify-center text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-fuchsia-300">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 7-5 5 5 5" /></svg>
    </button>
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 pr-3">
      <div className="flex items-center justify-between gap-2 text-[10px] leading-none">
        <span className="truncate font-medium text-white/70">{t('video.retakeTitle')}</span>
        <span className="flex-shrink-0 font-mono tabular-nums text-fuchsia-100/80">{clock(start)}–{clock(end)}</span>
      </div>
      <div ref={track} data-testid="video-retake-track" className="relative h-8 touch-none select-none"
        onPointerDown={pointerStart}
        onPointerMove={event => { if (dragging.current) (dragging.current === 'start' ? changeStart : changeEnd)(atPointer(event)); }}
        onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
        onLostPointerCapture={() => { dragging.current = null; }}>
        <div className="absolute inset-0 flex overflow-hidden rounded-md bg-white/5" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => frames[i]
            ? <img key={i} src={frames[i]} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
            : <div key={i} className="h-full min-w-0 flex-1 bg-white/5" />)}
          <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${start / length * 100}%` }} />
          <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${(length - end) / length * 100}%` }} />
          <div className="absolute inset-y-0 border-y-2 border-fuchsia-300/90 bg-fuchsia-300/10" style={{ left: `${start / length * 100}%`, width: `${(end - start) / length * 100}%` }} />
        </div>
        {(['start', 'end'] as const).map(side => <button key={side} type="button" role="slider" data-range-side={side}
          aria-label={t(side === 'start' ? 'video.retakeStart' : 'video.retakeEnd')}
          aria-valuemin={side === 'start' ? 0 : Number((start + .1).toFixed(2))}
          aria-valuemax={side === 'start' ? Number((end - .1).toFixed(2)) : length}
          aria-valuenow={Number((side === 'start' ? start : end).toFixed(2))}
          aria-valuetext={clock(side === 'start' ? start : end)}
          onKeyDown={event => keyboardMove(side, event)}
          className="absolute -top-1.5 z-10 flex h-11 w-7 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-white"
          style={{ left: `${(side === 'start' ? start : end) / length * 100}%` }}>
          <span aria-hidden="true" className="flex h-8 w-2.5 items-center justify-center rounded-[3px] bg-fuchsia-200 shadow-sm"><span className="h-3 w-px rounded bg-fuchsia-900/60" /></span>
        </button>)}
      </div>
    </div>
    <button type="button" onClick={() => onContinue(start, end)} aria-label={t('video.retakeContinue')} title={t('video.retakeContinue')}
      className="mkr-liquid-side-action flex w-11 flex-shrink-0 flex-col items-center justify-center gap-0.5 border-l border-fuchsia-400/30 text-fuchsia-100/85 transition-all hover:brightness-110 active:scale-95 focus-visible:outline-2 focus-visible:outline-fuchsia-300"
      style={{ background: 'linear-gradient(135deg, rgba(217,70,239,0.18), rgba(192,38,211,0.30))' }}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
      <span className="text-[9px] font-medium">{t('video.retakeEdit')}</span>
    </button>
  </section>;
}
