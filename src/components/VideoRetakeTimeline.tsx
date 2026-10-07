'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useLocale } from '@/lib/i18n';
import { buildVideoProxyUrl } from '@/lib/video-playback-url';

export interface VideoRetakeRange { start: number; end: number }
export default function VideoRetakeTimeline({ url, duration, range, sourceOffset = 0, onSeek, onChange }: {
  url: string; duration: number; range: VideoRetakeRange | null; sourceOffset?: number;
  onSeek: (time: number) => void; onChange?: (range: VideoRetakeRange) => void;
}) {
  const { t } = useLocale();
  const length = Math.max(.1, duration);
  const lastRange = useRef<VideoRetakeRange>({ start: 0, end: Math.min(4, length) });
  if (range) lastRange.current = range;
  const { start, end } = range ?? lastRange.current;
  const active = Boolean(range);
  const [frames, setFrames] = useState<string[]>([]);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ kind: 'start' | 'end' | 'move' | 'seek'; x: number; range: VideoRetakeRange } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    let collecting = true;
    const sampler = document.createElement('video');
    sampler.crossOrigin = 'anonymous'; sampler.muted = true; sampler.playsInline = true; sampler.preload = 'auto';
    sampler.setAttribute('aria-hidden', 'true');
    sampler.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    panel.current?.appendChild(sampler);
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const collect = async () => {
      const context = canvas.getContext('2d'); if (!context) return;
      const images: string[] = [];
      for (let i = 0; i < 8 && collecting; i++) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { sampler.onseeked = null; reject(new Error('seek')); }, 15000);
          sampler.onseeked = () => { clearTimeout(timer); resolve(); };
          sampler.currentTime = Math.min(sampler.duration - .05, sourceOffset + (i + .5) * length / 8);
        });
        if (!collecting) break;
        context.drawImage(sampler, 0, 0, 160, 90); images.push(canvas.toDataURL('image/jpeg', .65));
        if (collecting) setFrames([...images]);
      }
      if (collecting) setFrames(images);
    };
    let proxied = false;
    const load = (src: string) => {
      sampler.onloadeddata = () => { sampler.onloadeddata = null; collect().catch(fallback); };
      sampler.src = src; sampler.load();
    };
    const fallback = () => {
      if (!collecting || proxied) return;
      // Canvas requires CORS even when native playback succeeds. Reuse the
      // existing range proxy only after direct loading/seeking fails.
      proxied = true; load(buildVideoProxyUrl(url));
    };
    sampler.onerror = fallback;
    const loadTimeout = setTimeout(() => { if (sampler.readyState < 2) fallback(); }, 10000);
    load(url);
    return () => { collecting = false; clearTimeout(loadTimeout); sampler.onloadeddata = null; sampler.onerror = null; sampler.pause(); sampler.removeAttribute('src'); sampler.load(); sampler.remove(); };
  }, [url, sourceOffset, length, active]);
  const commit = (next: VideoRetakeRange, seekAt = next.start) => {
    onChange?.(next); onSeek(seekAt);
  };
  const changeStart = (at: number) => commit({ start: Math.max(0, end - 15, Math.min(end - .1, at)), end });
  const changeEnd = (at: number) => {
    const next = Math.min(length, start + 15, Math.max(start + .1, at));
    commit({ start, end: next }, next);
  };
  const move = (at: number, original: VideoRetakeRange) => {
    const width = original.end - original.start;
    const next = Math.max(0, Math.min(length - width, at));
    commit({ start: next, end: next + width });
  };
  const atPointer = (event: PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    return rect && rect.width ? Math.max(0, Math.min(length, Math.round((event.clientX - rect.left) / rect.width * length * 10) / 10)) : start;
  };
  const pointerStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.target as HTMLElement;
    const side = target.closest<HTMLElement>('[data-range-side]')?.dataset.rangeSide;
    const kind = side === 'start' || side === 'end' ? side : target.closest('[data-range-body]') ? 'move' : 'seek';
    dragging.current = { kind, x: event.clientX, range: { start, end } };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === 'seek') onSeek(atPointer(event));
  };
  const keyboardMove = (side: 'start' | 'end' | 'move', event: KeyboardEvent) => {
    const value = side === 'end' ? end : start;
    const step = event.shiftKey ? 1 : .1;
    const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? value - step
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + step
      : event.key === 'Home' ? 0 : event.key === 'End' ? length : undefined;
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation();
    if (side === 'move') move(Math.round(next * 100) / 100, { start, end });
    else (side === 'start' ? changeStart : changeEnd)(Math.round(next * 100) / 100);
  };
  const clock = (at: number) => `${Math.floor(at / 60)}:${(at % 60).toFixed(1).padStart(4, '0')}`;
  return <div ref={panel} data-testid="video-retake-timeline" aria-hidden={!active}
    className={`absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
    <div ref={track} data-testid="video-retake-track" className="absolute inset-y-0 left-2 right-2 touch-none select-none"
      onPointerDown={pointerStart} onPointerMove={event => {
        const drag = dragging.current; if (!drag) return;
        event.preventDefault(); event.stopPropagation();
        if (drag.kind === 'move') {
          const width = track.current?.getBoundingClientRect().width ?? 0;
          if (width) move(drag.range.start + Math.round((event.clientX - drag.x) / width * length * 10) / 10, drag.range);
        } else if (drag.kind === 'seek') onSeek(atPointer(event));
        else (drag.kind === 'start' ? changeStart : changeEnd)(atPointer(event));
      }} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
      onLostPointerCapture={() => { dragging.current = null; }} onClick={event => event.stopPropagation()}>
      <div className="absolute inset-0 flex overflow-hidden rounded-md bg-white/10" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => frames[i]
          ? <img key={i} src={frames[i]} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
          : <div key={i} className="h-full min-w-0 flex-1 bg-white/5" />)}
        <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: `${start / length * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/65" style={{ width: `${(length - end) / length * 100}%` }} />
      </div>
      <button type="button" data-range-body data-testid="video-retake-selection" tabIndex={active ? 0 : -1}
        aria-label={t('video.retakeMove')}
        onKeyDown={event => keyboardMove('move', event)}
        className="absolute inset-y-0 cursor-grab rounded-md border-2 border-fuchsia-200 bg-fuchsia-300/10 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-white"
        style={{ left: `${start / length * 100}%`, width: `${(end - start) / length * 100}%` }} />
      {(['start', 'end'] as const).map(side => <button key={side} type="button" role="slider" data-range-side={side} tabIndex={active ? 0 : -1}
        aria-label={t(side === 'start' ? 'video.retakeStart' : 'video.retakeEnd')}
        aria-valuemin={side === 'start' ? Math.max(0, end - 15) : Number((start + .1).toFixed(2))}
        aria-valuemax={side === 'start' ? Number((end - .1).toFixed(2)) : Math.min(length, start + 15)}
        aria-valuenow={Number((side === 'start' ? start : end).toFixed(2))}
        aria-valuetext={clock(side === 'start' ? start : end)} onKeyDown={event => keyboardMove(side, event)}
        className="absolute inset-y-0 z-10 flex w-7 -translate-x-1/2 cursor-ew-resize items-stretch justify-center focus-visible:outline-2 focus-visible:outline-white"
        style={{ left: `${(side === 'start' ? start : end) / length * 100}%` }}>
        <span aria-hidden="true" className="flex h-full w-3 items-center justify-center rounded-[4px] bg-fuchsia-200 shadow-sm"><span className="h-4 w-px rounded bg-fuchsia-900/60" /></span>
      </button>)}
    </div>
  </div>;
}
