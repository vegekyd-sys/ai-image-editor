'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n';
import type { RetakeModel } from '@/lib/video-retake-contract';

export default function VideoRetakeTimeline({ url, duration, time, sourceOffset = 0, onContinue, onClose }: {
  url: string; duration: number; time: number; sourceOffset?: number;
  onContinue: (start: number, end: number, model: RetakeModel) => void; onClose: () => void;
}) {
  const { t } = useLocale();
  const length = Math.max(.1, duration);
  const [start, setStart] = useState(Math.min(Math.max(0, time), Math.max(0, length - 4)));
  const [end, setEnd] = useState(Math.min(length, Math.max(0, time) + 4));
  const [frames, setFrames] = useState<string[]>([]);
  const [model, setModel] = useState<RetakeModel>('seedance-2.5');
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let active = true;
    const sampler = document.createElement('video');
    sampler.crossOrigin = 'anonymous'; sampler.muted = true; sampler.preload = 'auto';
    sampler.src = url;
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const collect = async () => {
      const context = canvas.getContext('2d'); if (!context) return;
      const images: string[] = [];
      for (let i = 0; i < 8 && active; i++) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { sampler.onseeked = null; reject(new Error('seek')); }, 5000);
          sampler.onseeked = () => { clearTimeout(timer); resolve(); };
          sampler.currentTime = Math.min(sampler.duration - .05, sourceOffset + (i + .5) * length / 8);
        });
        if (!active) break;
        context.drawImage(sampler, 0, 0, 160, 90); images.push(canvas.toDataURL('image/jpeg', .65));
      }
      if (active) setFrames(images);
    };
    sampler.onloadedmetadata = () => { collect().catch(() => {}); };
    return () => { active = false; sampler.onloadedmetadata = null; sampler.pause(); sampler.removeAttribute('src'); sampler.load(); };
  }, [url, sourceOffset, length]);
  const seek = (at: number) => { if (video.current) { video.current.pause(); video.current.currentTime = sourceOffset + at; } };
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
  return <section data-testid="video-retake-timeline" aria-label={t('video.retakeTitle')} className="mx-3 mb-3 rounded-2xl border border-fuchsia-300/20 bg-black/40 p-3 text-white">
    <div className="flex items-center justify-between gap-3">
      <strong className="text-sm">{t('video.retakeTitle')}</strong>
      <button type="button" onClick={onClose} className="px-2 py-1 text-sm text-white/70">{t('video.retakeClose')}</button>
    </div>
    <p className="mt-1 text-xs text-white/60">{t('video.retakeHint')}</p>
    <label className="mt-2 flex items-center gap-2 text-xs text-white/80">
      {t('video.retakeModel')}
      <select value={model} onChange={e => setModel(e.target.value as RetakeModel)} className="rounded-lg border border-white/15 bg-black px-2 py-1.5">
        {/* i18n-ignore: provider model brand names. */}
        <option value="seedance-2.5">Seedance 2.5</option>
        {/* i18n-ignore: provider model brand names. */}
        <option value="fal-h3-max">FAL H3 Max</option>
        {/* i18n-ignore: provider model brand names. */}
        <option value="ltx-2.3-retake">LTX 2.3</option>
      </select>
    </label>
    <video ref={video} src={url} controls playsInline preload="metadata"
      onLoadedMetadata={() => { if (video.current) video.current.currentTime = sourceOffset + start; }}
      onSeeking={() => {
        const v = video.current; if (!v) return;
        if (v.currentTime < sourceOffset) v.currentTime = sourceOffset;
        if (v.currentTime > sourceOffset + length) v.currentTime = sourceOffset + length;
      }}
      onTimeUpdate={() => { if (video.current && video.current.currentTime >= sourceOffset + length) video.current.pause(); }}
      className="mt-2 max-h-36 w-full rounded-lg" />
    <div className="relative mt-3 flex h-12 overflow-hidden rounded-lg bg-white/10" aria-hidden="true">
      {frames.map((frame, i) => <img key={i} src={frame} alt="" className="h-full min-w-0 flex-1 object-cover" />)}
      <div className="pointer-events-none absolute inset-y-0 border-2 border-fuchsia-300 bg-fuchsia-400/25" style={{ left: `${start / length * 100}%`, width: `${(end - start) / length * 100}%` }} />
    </div>
    <div className="mt-2 grid grid-cols-2 gap-3">
      {(['start', 'end'] as const).map(side => <label key={side} className="text-xs text-white/80">
        {t(side === 'start' ? 'video.retakeStart' : 'video.retakeEnd')}
        <input type="number" min={0} max={length} step={.1} value={Number((side === 'start' ? start : end).toFixed(2))}
          onChange={e => { if (e.target.value !== '') (side === 'start' ? changeStart : changeEnd)(Number(e.target.value)); }}
          className="ml-2 w-20 rounded bg-white/10 px-2 py-1" />
        <input type="range" min={0} max={length} step={.1} value={side === 'start' ? start : end}
          aria-label={t(side === 'start' ? 'video.retakeStart' : 'video.retakeEnd')}
          onChange={e => (side === 'start' ? changeStart : changeEnd)(Number(e.target.value))} className="mt-2 w-full accent-fuchsia-300" />
      </label>)}
    </div>
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="text-xs text-white/70">{t('video.retakeRange', start.toFixed(2), end.toFixed(2), (end - start).toFixed(2))}</span>
      <button type="button" disabled={end - start < .099 || end - start > 15.001} onClick={() => onContinue(start, end, model)}
        className="rounded-xl bg-fuchsia-500/25 px-4 py-2 text-sm font-semibold disabled:opacity-40">{t('video.retakeContinue')}</button>
    </div>
  </section>;
}
