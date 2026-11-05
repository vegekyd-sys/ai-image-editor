'use client';

// Timeline dock for timeline videos. Occupies the Editor bottom-bar slot that
// DesignEditPanel uses for classic compositions. Vocabulary is reused from
// existing UI: pill gradients, fuchsia selection + trim handles
// (DesignVideoTrimEditor), liquid icon buttons, VideoRetakeTimeline playhead.
// Desktop: scroll + zoom, moving playhead. Mobile: fixed centre playhead, swipe
// to scrub. No popup editor: the bottom row turns into the selected element's
// inline editor; position/size is edited on the canvas.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n';
import { clipsOnTrack, newClipId } from '@/lib/timeline/reducer';
import type { Clip, TimelineDoc, TimelineOp, TrackKind } from '@/lib/timeline/types';
import { FRAME_STEP, useVideoFilmstrip } from './useVideoFilmstrip';

/** Mobile slot height for timeline videos (tips/pills keep MOBILE_EDITOR_SLOT_HEIGHT). */
export const TIMELINE_SLOT_HEIGHT = 192;

const LANE: Record<'desktop' | 'mobile', Record<TrackKind, number>> = {
  desktop: { overlay: 30, text: 28, caption: 28, main: 54, audio: 22 },
  mobile: { overlay: 22, text: 20, caption: 20, main: 44, audio: 12 },
};
const RULER = 20;
const INSPECTOR = 48;

function fmt(t: number) {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

const ICON = {
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  split: <><path d="M12 3v18" /><path d="M7 8 4 12l3 4M17 8l3 4-3 4" /></>,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  text: <path d="M4 7V5h16v2M12 5v14M9 19h6" />,
};

function IconButton({ icon, label, onClick, disabled, accent }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-default"
      style={accent
        ? { background: 'linear-gradient(145deg, rgba(192,38,211,0.92), rgba(145,18,178,0.74))', color: '#fff', border: '0.5px solid rgba(232,121,249,0.40)' }
        : { background: 'linear-gradient(145deg, rgba(255,255,255,0.075), rgba(10,10,14,0.36))', color: 'rgba(255,255,255,0.72)', border: '0.5px solid rgba(255,255,255,0.10)' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
    </button>
  );
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className="animate-spin flex-shrink-0">
      <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
      <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Filmstrip({ clip, pps, height }: { clip: Clip; pps: number; height: number }) {
  const videoSrc = clip.kind === 'video' ? clip.src : undefined;
  const frames = useVideoFilmstrip(videoSrc);
  const still = clip.kind === 'image' ? clip.src : clip.kind === 'video' ? clip.poster : undefined;
  const sourceIn = clip.kind === 'video' ? clip.sourceIn ?? 0 : 0;
  const tileW = Math.max(30, Math.round(height * 9 / 16));
  const count = Math.max(1, Math.ceil((clip.duration * pps) / tileW));
  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {Array.from({ length: Math.min(count, 400) }, (_, i) => {
        const t = sourceIn + (i * tileW + tileW / 2) / pps;
        const f = frames.length ? frames[Math.min(frames.length - 1, Math.floor(t / FRAME_STEP))] : undefined;
        const src = f ?? still;
        return (
          <div key={i} className="h-full flex-shrink-0" style={{ width: tileW, background: src ? `url("${src}") center / cover` : 'rgba(255,255,255,0.06)', boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.35)' }} />
        );
      })}
    </div>
  );
}

const WAVE = Array.from({ length: 160 }, (_, i) => Math.round((0.2 + Math.abs(Math.sin(i * 0.61 + 3) * Math.cos(i * 0.23)) * 0.8) * 100) / 100);
function Waveform() {
  return (
    <svg className="absolute inset-x-0 w-full" style={{ top: 3, height: 'calc(100% - 6px)' }} preserveAspectRatio="none" viewBox="0 0 160 10" aria-hidden="true">
      {WAVE.map((h, i) => <rect key={i} x={i + 0.25} y={5 - h * 5} width={0.5} height={h * 10} rx={0.25} fill="rgba(255,255,255,0.28)" />)}
    </svg>
  );
}

export interface TimelineDockProps {
  doc: TimelineDoc;
  duration: number;
  time: number;
  playing: boolean;
  selectedId: string | null;
  agentClipId: string | null;
  isDesktop: boolean;
  canUndo: boolean;
  focusToken: number;
  readOnly?: boolean;
  onSelect: (id: string | null) => void;
  onSeek: (time: number) => void;
  onUndo: () => void;
  onBeginGesture: () => void;
  onOp: (op: TimelineOp) => void;
}

type DragState = { id: string; mode: 'move' | 'trim-l' | 'trim-r'; x0: number; start0: number; dur0: number; in0: number; moved: boolean };

export default function TimelineDock(props: TimelineDockProps) {
  const { doc, duration, time, playing, selectedId, agentClipId, isDesktop, canUndo, focusToken, readOnly, onSelect, onSeek, onUndo, onBeginGesture, onOp } = props;
  const { t } = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<DragState | null>(null);
  const tap = useRef<number | null>(null);
  const [mainDragDx, setMainDragDx] = useState<{ id: string; dx: number } | null>(null);
  const [viewW, setViewW] = useState(600);
  const [zoom, setZoom] = useState(1);
  const lanes = LANE[isDesktop ? 'desktop' : 'mobile'];

  const contentEnd = Math.max(duration, ...Object.values(doc.clips).map(c => c.start + c.duration));
  const fitPps = (viewW - 32) / Math.max(contentEnd, 1);
  const pps = isDesktop ? Math.max(48, fitPps) * zoom : 58 * zoom;
  const pad = isDesktop ? 16 : viewW / 2;
  const contentW = contentEnd * pps + pad * 2;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || drag.current) return;
    const x = time * pps;
    if (!isDesktop) {
      if (Math.abs(el.scrollLeft - x) > 0.5) el.scrollLeft = x;
    } else if (x + pad < el.scrollLeft + 24 || x + pad > el.scrollLeft + el.clientWidth - 24) {
      el.scrollLeft = Math.max(0, x + pad - el.clientWidth / 3);
    }
  }, [time, pps, pad, isDesktop]);

  useEffect(() => { if (focusToken) inputRef.current?.focus(); }, [focusToken]);

  const onScroll = () => {
    if (isDesktop || playing) return;
    const left = scrollRef.current!.scrollLeft;
    if (Math.abs(left - time * pps) < 1) return; // our own sync, not a swipe
    onSeek(Math.min(duration, left / pps));
  };

  const timeAt = useCallback((clientX: number) => {
    const rect = scrollRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left + scrollRef.current!.scrollLeft - pad) / pps));
  }, [duration, pad, pps]);

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
    e.stopPropagation();
    if (readOnly || (!isDesktop && mode === 'move' && clip.id !== selectedId)) { tap.current = e.clientX; return; }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: clip.id, mode, x0: e.clientX, start0: clip.start, dur0: clip.duration, in0: clip.kind === 'video' || clip.kind === 'audio' ? clip.sourceIn ?? 0 : 0, moved: false };
  };

  const isMain = (clip: Clip) => doc.tracks.find(tr => tr.id === clip.trackId)?.kind === 'main';
  const r1 = (v: number) => Math.round(v * 100) / 100;

  const onClipPointerMove = (e: React.PointerEvent, clip: Clip) => {
    const d = drag.current;
    if (!d || d.id !== clip.id || !e.buttons) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    if (!d.moved) { d.moved = true; onBeginGesture(); }
    const dt = (e.clientX - d.x0) / pps;
    const hasSource = clip.kind === 'video' || clip.kind === 'audio';
    if (d.mode === 'move') {
      if (isMain(clip)) setMainDragDx({ id: clip.id, dx: e.clientX - d.x0 });
      else onOp({ op: 'update', id: clip.id, patch: { start: Math.max(0, r1(d.start0 + dt)) } });
    } else if (d.mode === 'trim-r') {
      let next = Math.max(0.2, d.dur0 + dt);
      if (clip.kind === 'video' && clip.sourceDuration) next = Math.min(next, clip.sourceDuration - (clip.sourceIn ?? 0));
      onOp({ op: 'update', id: clip.id, patch: { duration: r1(next) } });
      onSeek(clip.start + next - 0.04);
    } else {
      const delta = Math.min(d.dur0 - 0.2, Math.max(hasSource ? -d.in0 : -d.start0, dt));
      const patch: Record<string, unknown> = { duration: r1(d.dur0 - delta) };
      if (hasSource) patch.sourceIn = r1(Math.max(0, d.in0 + delta));
      if (!isMain(clip)) patch.start = r1(Math.max(0, d.start0 + delta));
      onOp({ op: 'update', id: clip.id, patch });
      onSeek(isMain(clip) ? clip.start : d.start0 + delta);
    }
  };

  const onClipPointerUp = (e: React.PointerEvent, clip: Clip) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      if (d.mode === 'move' && isMain(clip) && mainDragDx) {
        // Drop position decides the new order; the reducer re-packs the main track.
        const target = d.start0 + mainDragDx.dx / pps;
        onOp({ op: 'update', id: clip.id, patch: { start: Math.max(0, target + (mainDragDx.dx > 0 ? clip.duration : 0)) } });
      }
      setMainDragDx(null);
      return;
    }
    if (!d && (tap.current === null || Math.abs(e.clientX - tap.current) > 6)) { tap.current = null; return; }
    tap.current = null;
    onSelect(clip.id);
    const inside = time >= clip.start && time < clip.start + clip.duration;
    if (!inside) onSeek(clip.start + Math.min(0.6, clip.duration / 2));
  };

  const visibleTracks = doc.tracks.filter(tr => !tr.hidden && (tr.kind === 'main' || clipsOnTrack(doc, tr.id).length > 0));
  const selected = selectedId ? doc.clips[selectedId] : null;
  const laneGap = isDesktop ? 6 : 3;
  const radius = isDesktop ? 10 : 7;
  const labelOf = (clip: Clip) => clip.label || t(`timeline.clip.${clip.kind}` as 'timeline.clip.video');

  // ── inline inspector ──
  const segIndex = selected?.kind === 'caption' ? selected.segments.findIndex(s => time - selected.start >= s.start && time - selected.start < s.end) : -1;
  const seg = selected?.kind === 'caption' ? (segIndex >= 0 ? selected.segments[segIndex] : selected.segments[0]) : undefined;
  const splitAtPlayhead = () => {
    if (!selected || selected.kind === 'pending') return;
    const off = time - selected.start;
    if (off < 0.2 || off > selected.duration - 0.2) return;
    onBeginGesture();
    onOp({ op: 'split', id: selected.id, at: time, newId: newClipId(selected.kind[0]) });
  };
  const remove = () => { if (!selected) return; onBeginGesture(); onOp({ op: 'remove', id: selected.id }); onSelect(null); };
  const textInputClass = `flex-1 min-w-0 h-9 rounded-xl px-3 outline-none ${isDesktop ? 'text-[14px]' : 'text-[16px]'}`;
  const textInputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.92)', caretColor: '#d946ef' };
  const canSplit = !!selected && selected.kind !== 'pending' && time - selected.start > 0.2 && selected.start + selected.duration - time > 0.2;

  let inspector: React.ReactNode;
  if (!selected || readOnly) {
    inspector = (
      <>
        <span className="text-[13px] tabular-nums" style={{ color: 'rgba(255,255,255,0.72)' }}>{fmt(time)}</span>
        <span className="text-[13px] tabular-nums" style={{ color: 'rgba(255,255,255,0.3)' }}>/ {fmt(duration)}</span>
        <div className="flex-1" />
        {isDesktop && <IconButton icon={ICON.minus} label={t('timeline.zoomOut')} onClick={() => setZoom(z => Math.max(0.5, z / 1.4))} />}
        {isDesktop && <IconButton icon={ICON.plus} label={t('timeline.zoomIn')} onClick={() => setZoom(z => Math.min(8, z * 1.4))} />}
        {!readOnly && <IconButton icon={ICON.undo} label={t('timeline.undo')} onClick={onUndo} disabled={!canUndo} />}
      </>
    );
  } else if (selected.kind === 'text') {
    inspector = (
      <>
        <input ref={inputRef} aria-label={t('timeline.textInput')} className={textInputClass} style={textInputStyle} value={selected.text}
          onFocus={onBeginGesture}
          onChange={e => onOp({ op: 'update', id: selected.id, patch: { text: e.target.value } })}
          onKeyDown={e => { if (e.key === 'Enter') onSelect(null); }} />
        <IconButton icon={ICON.trash} label={t('timeline.delete')} onClick={remove} />
        <IconButton icon={ICON.check} label={t('timeline.done')} onClick={() => onSelect(null)} accent />
      </>
    );
  } else if (selected.kind === 'caption' && seg) {
    inspector = (
      <>
        <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: 'rgba(255,255,255,0.38)' }}>{t('timeline.captionIndex', String(Math.max(0, segIndex) + 1), String(selected.segments.length))}</span>
        <input ref={inputRef} aria-label={t('timeline.captionInput')} className={textInputClass} style={textInputStyle} value={seg.text}
          onFocus={onBeginGesture}
          onChange={e => onOp({ op: 'update', id: selected.id, patch: { segments: selected.segments.map(s => (s.id === seg.id ? { ...s, text: e.target.value } : s)) } })}
          onKeyDown={e => { if (e.key === 'Enter') onSelect(null); }} />
        <IconButton icon={ICON.trash} label={t('timeline.delete')} onClick={remove} />
        <IconButton icon={ICON.check} label={t('timeline.done')} onClick={() => onSelect(null)} accent />
      </>
    );
  } else {
    const hasBox = 'box' in selected && !!selected.box;
    const detail = selected.kind === 'pending'
      ? t('timeline.generating', String(Math.round((selected.progress ?? 0) * 100)))
      : hasBox ? t('timeline.dragHint')
        : (selected.kind === 'video' || selected.kind === 'audio') && selected.sourceIn ? t('timeline.sourceFrom', selected.sourceIn.toFixed(1)) : '';
    inspector = (
      <>
        <div className="min-w-0 flex flex-col leading-tight">
          <span className="text-[13px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.86)' }}>{labelOf(selected)}</span>
          <span className="text-[11px] tabular-nums truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
            {`${selected.duration.toFixed(1)}s`}{detail ? ` · ${detail}` : ''}
          </span>
        </div>
        <div className="flex-1" />
        {selected.kind !== 'pending' && <IconButton icon={ICON.split} label={t('timeline.split')} onClick={splitAtPlayhead} disabled={!canSplit} />}
        <IconButton icon={ICON.trash} label={t('timeline.delete')} onClick={remove} />
        <IconButton icon={ICON.check} label={t('timeline.done')} onClick={() => onSelect(null)} accent />
      </>
    );
  }

  const tracksHeight = (isDesktop ? RULER + 4 : 0) + visibleTracks.reduce((h, tr) => h + lanes[tr.kind], 0) + laneGap * (visibleTracks.length - 1);

  return (
    <div data-testid="timeline-dock" role="region" aria-label={t('timeline.aria')} className="flex flex-col" style={isDesktop ? undefined : { height: TIMELINE_SLOT_HEIGHT }}>
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full hide-scrollbar overflow-x-auto overflow-y-auto"
          style={{ overscrollBehaviorX: 'contain' }}
          onWheel={(e) => { if (isDesktop && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setZoom(z => Math.min(8, Math.max(0.5, z * (e.deltaY < 0 ? 1.12 : 0.89)))); } }}
        >
          <div
            className="relative select-none"
            style={{ width: contentW, height: tracksHeight + 10, paddingTop: isDesktop ? 0 : 6 }}
            onPointerDown={(e) => {
              if (!isDesktop) return;
              onSelect(null);
              onSeek(timeAt(e.clientX));
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => { if (isDesktop && e.buttons && !drag.current) onSeek(timeAt(e.clientX)); }}
          >
            {isDesktop && (
              <div className="relative mb-1" style={{ height: RULER, marginLeft: pad }}>
                {Array.from({ length: Math.floor(contentEnd) + 1 }, (_, s) => (pps >= 40 || s % 5 === 0) && (
                  <span key={s} className="absolute top-1 text-[10px] leading-none tabular-nums -translate-x-1/2" style={{ left: s * pps, color: 'rgba(255,255,255,0.3)' }}>{`${s}s`}</span>
                ))}
                {Array.from({ length: Math.floor(contentEnd * 2) + 1 }, (_, i) => (
                  <div key={`t${i}`} className="absolute bottom-0 w-px" style={{ left: i * pps / 2, height: i % 2 ? 3 : 5, background: 'rgba(255,255,255,0.14)' }} />
                ))}
              </div>
            )}

            <div className="flex flex-col" style={{ gap: laneGap, marginLeft: pad, marginRight: pad }}>
              {visibleTracks.map(track => (
                <div key={track.id} className="relative" style={{ height: lanes[track.kind] }}>
                  {clipsOnTrack(doc, track.id).map(clip => {
                    const isSel = clip.id === selectedId;
                    const isAgent = clip.id === agentClipId;
                    const isPending = clip.kind === 'pending';
                    const onMain = track.kind === 'main';
                    const left = clip.start * pps + (onMain ? 1 : 0);
                    const w = Math.max(8, clip.duration * pps - (onMain ? 2 : 0));
                    const h = lanes[track.kind];
                    const handleW = isDesktop ? 10 : 14;
                    const dragging = mainDragDx?.id === clip.id;
                    return (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        onPointerDown={(e) => onClipPointerDown(e, clip, 'move')}
                        onPointerMove={(e) => onClipPointerMove(e, clip)}
                        onPointerUp={(e) => onClipPointerUp(e, clip)}
                        onDoubleClick={() => { if (clip.kind === 'text' || clip.kind === 'caption') { onSelect(clip.id); requestAnimationFrame(() => inputRef.current?.focus()); } }}
                        className="absolute top-0 bottom-0 cursor-pointer animate-tip-in"
                        style={{
                          left,
                          width: w,
                          borderRadius: radius,
                          zIndex: dragging ? 5 : undefined,
                          transform: dragging ? `translateX(${mainDragDx!.dx}px) scale(1.03)` : undefined,
                          transition: drag.current ? 'none' : 'left 360ms cubic-bezier(.2,.8,.2,1), width 360ms cubic-bezier(.2,.8,.2,1), box-shadow 200ms',
                          boxShadow: isAgent ? '0 0 0 1px rgba(232,121,249,0.75), 0 0 20px rgba(217,70,239,0.45)' : dragging ? '0 8px 24px rgba(0,0,0,0.5)' : undefined,
                        }}
                      >
                        {clip.kind === 'caption' ? (
                          <div className="absolute inset-0">
                            {clip.segments.map(s => {
                              const active = isSel && seg?.id === s.id;
                              return (
                                <div key={s.id} className="absolute top-0 bottom-0 flex items-center px-2 overflow-hidden animate-tip-in"
                                  style={{
                                    left: s.start * pps, width: Math.max(6, (s.end - s.start) * pps - 3), borderRadius: radius - 2,
                                    background: active ? 'linear-gradient(145deg, rgba(217,70,239,0.34), rgba(12,12,16,0.5))' : 'linear-gradient(145deg, rgba(217,70,239,0.12), rgba(12,12,16,0.46))',
                                    border: '0.5px solid rgba(255,255,255,0.12)',
                                  }}
                                  onPointerUp={() => { if (isSel) onSeek(clip.start + s.start + 0.05); }}>
                                  <span className={`${isDesktop ? 'text-[11px]' : 'text-[10px]'} truncate`} style={{ color: 'rgba(255,255,255,0.8)' }}>{s.text}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="absolute inset-0 overflow-hidden" style={{
                            borderRadius: radius,
                            border: isPending ? '1px dashed rgba(255,255,255,0.28)' : '0.5px solid rgba(255,255,255,0.12)',
                            background: track.kind === 'audio'
                              ? 'linear-gradient(145deg, rgba(255,255,255,0.07), rgba(12,12,16,0.42))'
                              : 'linear-gradient(145deg, rgba(217,70,239,0.12), rgba(12,12,16,0.46))',
                          }}>
                            {(clip.kind === 'video' || clip.kind === 'image') && <Filmstrip clip={clip} pps={pps} height={h} />}
                            {clip.kind === 'audio' && <Waveform />}
                            {isPending && <div className="absolute inset-y-0 left-0" style={{ width: `${(clip.progress ?? 0) * 100}%`, background: 'rgba(217,70,239,0.22)', transition: 'width 300ms linear' }} />}
                            <div className={`absolute inset-0 flex items-center min-w-0 ${isDesktop ? 'px-2.5 gap-1.5' : 'px-2 gap-1'}`}>
                              {isAgent && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#e879f9', animation: 'mkr-timeline-breathe 1s ease-in-out infinite' }} />}
                              {isPending && <Spinner size={isDesktop ? 12 : 10} />}
                              {clip.kind === 'text' && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.2" strokeLinecap="round" className="flex-shrink-0" aria-hidden="true">{ICON.text}</svg>
                              )}
                              {clip.kind === 'text' && <span className={`${isDesktop ? 'text-[12px]' : 'text-[11px]'} font-medium truncate text-white/90`}>{clip.text}</span>}
                              {isPending && <span className={`${isDesktop ? 'text-[11px]' : 'text-[10px]'} truncate`} style={{ color: 'rgba(255,255,255,0.7)' }}>{t('timeline.generating', String(Math.round((clip.progress ?? 0) * 100)))}</span>}
                              {clip.kind === 'audio' && isDesktop && <span className="relative text-[10px] truncate px-1.5 rounded" style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.35)' }}>{labelOf(clip)}</span>}
                            </div>
                            {(clip.kind === 'video' || clip.kind === 'image') && onMain && w > 44 && (
                              <span className="absolute right-1.5 bottom-1 text-[9px] tabular-nums px-1 rounded" style={{ color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.5)' }}>{`${clip.duration.toFixed(1)}s`}</span>
                            )}
                          </div>
                        )}

                        {isSel && (
                          <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: radius, border: '2px solid #d946ef', boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 0 18px rgba(217,70,239,0.25)' }} />
                        )}
                        {isSel && !readOnly && clip.kind !== 'pending' && (['trim-l', 'trim-r'] as const).map(mode => (
                          <div key={mode}
                            onPointerDown={(e) => onClipPointerDown(e, clip, mode)} onPointerMove={(e) => onClipPointerMove(e, clip)} onPointerUp={(e) => onClipPointerUp(e, clip)}
                            className="absolute top-0 bottom-0 z-20 flex items-center justify-center cursor-ew-resize"
                            style={{ [mode === 'trim-l' ? 'left' : 'right']: 0, width: handleW, background: '#d946ef', borderRadius: mode === 'trim-l' ? `${radius}px 0 0 ${radius}px` : `0 ${radius}px ${radius}px 0` }}>
                            <div className="w-[2px] rounded-full bg-black/70" style={{ height: Math.min(16, h * 0.45) }} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {isDesktop && (
              <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: pad + time * pps }}>
                <div className="absolute top-0 -translate-x-1/2 rounded-full px-1.5 text-[10px] leading-[16px] tabular-nums font-medium whitespace-nowrap" style={{ background: '#fff', color: '#000' }}>{fmt(time)}</div>
                <div className="absolute top-[16px] bottom-0 w-[1.5px] -translate-x-1/2 bg-white" style={{ boxShadow: '0 0 6px rgba(0,0,0,0.6)' }} />
              </div>
            )}
          </div>
        </div>

        {!isDesktop && (
          <div className="absolute top-0 bottom-0 left-1/2 z-30 pointer-events-none">
            <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full bg-white" style={{ boxShadow: '0 0 8px rgba(0,0,0,0.7)' }} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 flex-shrink-0" style={{ height: INSPECTOR, borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
        {inspector}
      </div>
    </div>
  );
}
