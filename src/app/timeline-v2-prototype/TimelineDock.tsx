'use client';

// Timeline dock prototype. It occupies the exact bottom-bar slot that
// DesignEditPanel (PillCarousel) uses today and reuses its vocabulary:
// mkr-liquid-pill clips, fuchsia selection ring, "Design · N editables"
// style toolbar row, trim handles from DesignVideoTrimEditor, playhead from
// VideoRetakeTimeline.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MOBILE_EDITOR_SLOT_HEIGHT } from '@/lib/editor/panel-layout';
import type { Clip, TimelineDoc, TimelineOp, TrackKind } from './prototype-doc';
import { clipsOnTrack } from './prototype-doc';

const LANE_DESKTOP: Record<TrackKind, number> = { overlay: 26, text: 26, caption: 26, main: 46, audio: 22 };
const LANE_MOBILE: Record<TrackKind, number> = { overlay: 12, text: 12, caption: 12, main: 24, audio: 5 };
const TRACK_ICON: Record<TrackKind, string> = { overlay: '▣', text: 'T', caption: '字', main: '▶', audio: '♪' };
const GUTTER = 30;

function fmt(t: number) {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className="animate-spin flex-shrink-0">
      <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
      <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Waveform({ seed }: { seed: number }) {
  const bars = Array.from({ length: 90 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.61 + seed) * Math.cos(i * 0.23)) * 0.75);
  return (
    <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 90 10">
      {bars.map((h, i) => <rect key={i} x={i + 0.2} y={5 - h * 4} width={0.6} height={h * 8} fill="rgba(255,255,255,0.22)" />)}
    </svg>
  );
}

interface TimelineDockProps {
  doc: TimelineDoc;
  duration: number;
  time: number;
  selectedId: string | null;
  agentClipId: string | null;
  isDesktop: boolean;
  canUndo: boolean;
  onSelect: (id: string | null) => void;
  onSeek: (time: number) => void;
  onEdit: (id: string) => void;
  onUndo: () => void;
  onDragStart: () => void;
  onOp: (op: TimelineOp) => void;
}

type DragState = { id: string; mode: 'move' | 'trim-l' | 'trim-r'; x0: number; start0: number; dur0: number; in0: number; moved: boolean };

export default function TimelineDock({ doc, duration, time, selectedId, agentClipId, isDesktop, canUndo, onSelect, onSeek, onEdit, onUndo, onDragStart, onOp }: TimelineDockProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const drag = useRef<DragState | null>(null);
  const lanes = isDesktop ? LANE_DESKTOP : LANE_MOBILE;
  const gutter = isDesktop ? GUTTER : 0;
  const contentEnd = Math.max(duration, ...Object.values(doc.clips).map(c => c.start + c.duration));
  const span = Math.max(contentEnd, 4) + 0.3;
  const pps = Math.max(10, (width - gutter) / span);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const timeAt = useCallback((clientX: number) => {
    const rect = areaRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left - gutter) / pps));
  }, [duration, gutter, pps]);

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: clip.id, mode, x0: e.clientX, start0: clip.start, dur0: clip.duration, in0: clip.sourceIn ?? 0, moved: false };
  };

  const onClipPointerMove = (e: React.PointerEvent, clip: Clip) => {
    const d = drag.current;
    if (!d || d.id !== clip.id || !e.buttons) return;
    const dt = (e.clientX - d.x0) / pps;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
    if (!d.moved) { d.moved = true; onDragStart(); }
    const isMain = clip.trackId === 't-main';
    if (d.mode === 'move' && !isMain && clip.kind !== 'audio') {
      onOp({ op: 'update', id: clip.id, patch: { start: Math.max(0, Math.round((d.start0 + dt) * 10) / 10) } });
    } else if (d.mode === 'trim-r') {
      onOp({ op: 'update', id: clip.id, patch: { duration: Math.max(0.5, Math.round((d.dur0 + dt) * 10) / 10) } });
    } else if (d.mode === 'trim-l') {
      const delta = Math.min(d.dur0 - 0.5, Math.max(-d.in0, dt));
      const patch: Partial<Clip> = { duration: Math.round((d.dur0 - delta) * 10) / 10, sourceIn: Math.max(0, d.in0 + delta) };
      if (!isMain) patch.start = Math.max(0, d.start0 + delta);
      onOp({ op: 'update', id: clip.id, patch });
    }
  };

  const onClipPointerUp = (clip: Clip) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) {
      onSelect(clip.id);
      const inside = time >= clip.start && time < clip.start + clip.duration;
      onSeek(inside ? time : clip.start + Math.min(0.8, clip.duration / 2));
    }
  };

  const selected = selectedId ? doc.clips[selectedId] : null;
  const editable = selected && (selected.kind === 'text' || selected.kind === 'video');
  const rulerH = isDesktop ? 16 : 0;
  const laneGap = isDesktop ? 4 : 1.5;
  const tracks = doc.tracks;

  const toolbar = selected ? (
    <div className="flex items-center gap-2 animate-pop-in">
      <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.62)' }}>{selected.label}</span>
      <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.28)' }}>
        · {fmt(selected.start)} – {fmt(selected.start + selected.duration)}
      </span>
      {editable && (
        <button
          onClick={() => onEdit(selected.id)}
          className="mkr-liquid-pill px-3 py-1 rounded-full text-[11px] font-medium active:scale-95 transition-all cursor-pointer"
          style={{ background: 'linear-gradient(145deg, rgba(217,70,239,0.20), rgba(10,10,14,0.38))', color: '#f5d0fe', border: '0.5px solid rgba(232,121,249,0.30)' }}
        >
          Edit
        </button>
      )}
      <button
        onClick={() => { onDragStart(); onOp({ op: 'remove', id: selected.id }); onSelect(null); }}
        className="text-[11px] px-1.5 cursor-pointer active:opacity-60"
        style={{ color: 'rgba(255,255,255,0.32)' }}
      >
        删除
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-1.5 animate-pop-in">
      <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.28)' }}>Timeline</span>
      <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.25)' }}>· {fmt(time)} / {fmt(duration)}</span>
      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className="text-[11px] cursor-pointer disabled:cursor-default active:opacity-60"
        style={{ color: canUndo ? 'rgba(232,121,249,0.75)' : 'rgba(255,255,255,0.18)' }}
      >
        撤销
      </button>
    </div>
  );

  return (
    <div data-testid="timeline-dock" className="flex flex-col" style={isDesktop ? undefined : { height: MOBILE_EDITOR_SLOT_HEIGHT }}>
      <div className={`px-3 ${isDesktop ? 'pt-2 pb-1.5 min-h-[70px]' : 'pt-1 pb-1 min-h-[78px]'}`}>
        <div
          ref={areaRef}
          className="relative select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => { onSelect(null); onSeek(timeAt(e.clientX)); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (e.buttons && !drag.current) onSeek(timeAt(e.clientX)); }}
        >
          {isDesktop && (
            <div className="relative" style={{ height: rulerH, marginLeft: gutter }}>
              {Array.from({ length: Math.floor(span) + 1 }, (_, s) => (
                <div key={s} className="absolute top-0 flex items-start" style={{ left: s * pps }}>
                  <div className="w-px h-1.5" style={{ background: 'rgba(255,255,255,0.14)' }} />
                  <span className="ml-1 text-[9px] leading-none tabular-nums" style={{ color: 'rgba(255,255,255,0.28)' }}>{s}s</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col" style={{ gap: laneGap }}>
            {tracks.map(track => (
              <div key={track.id} className="relative flex" style={{ height: lanes[track.kind] }}>
                {isDesktop && (
                  <div className="flex-shrink-0 flex items-center justify-center rounded-md mr-1" style={{ width: gutter - 4, background: 'rgba(255,255,255,0.045)' }}>
                    <span className="text-white/30 text-[10px]">{TRACK_ICON[track.kind]}</span>
                  </div>
                )}
                <div className="relative flex-1 rounded-md" style={{ background: 'rgba(255,255,255,0.025)' }}>
                  {clipsOnTrack(doc, track.id).map(clip => {
                    const isSel = clip.id === selectedId;
                    const isAgent = clip.id === agentClipId;
                    const isPending = clip.kind === 'pending';
                    const left = clip.start * pps;
                    const w = Math.max(6, clip.duration * pps - (track.kind === 'main' ? 2 : 0));
                    const thumb = (clip.kind === 'video' || clip.kind === 'image') && clip.poster;
                    return (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        onPointerDown={(e) => onClipPointerDown(e, clip, 'move')}
                        onPointerMove={(e) => onClipPointerMove(e, clip)}
                        onPointerUp={() => onClipPointerUp(clip)}
                        onDoubleClick={() => (clip.kind === 'text' || clip.kind === 'video') && onEdit(clip.id)}
                        className="absolute top-0 bottom-0 cursor-pointer animate-tip-in"
                        style={{
                          left,
                          width: w,
                          transition: drag.current ? 'none' : 'left 360ms cubic-bezier(.2,.8,.2,1), width 360ms cubic-bezier(.2,.8,.2,1)',
                        }}
                      >
                        <div
                          className={`mkr-liquid-pill w-full h-full overflow-hidden border ${isDesktop ? 'rounded-lg' : 'rounded-[4px]'} ${
                            isSel ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50' : isPending ? 'border-dashed border-white/25' : 'border-white/10 hover:border-white/20'
                          } ${isAgent ? 'mkr-liquid-pill-selected' : ''}`}
                          style={{
                            background: thumb
                              ? `linear-gradient(90deg, rgba(0,0,0,0.35), rgba(0,0,0,0) 40%), url(${clip.poster}) center 30% / cover no-repeat, rgba(12,12,16,0.6)`
                              : track.kind === 'audio'
                                ? 'linear-gradient(145deg, rgba(255,255,255,0.06), rgba(12,12,16,0.42))'
                                : isSel ? 'linear-gradient(145deg, rgba(217,70,239,0.14), rgba(12,12,16,0.46))' : 'linear-gradient(145deg, rgba(217,70,239,0.075), rgba(12,12,16,0.42))',
                          }}
                        />
                        {(isDesktop || track.kind !== 'audio') && (
                          <div className={`absolute inset-0 z-10 overflow-hidden flex items-center min-w-0 ${isDesktop ? 'rounded-lg gap-1.5 px-2 text-[10px]' : 'rounded-[4px] gap-1 px-1.5 text-[8.5px] leading-none'}`}>
                            {isAgent && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#e879f9', animation: 'breathe 1s ease-in-out infinite' }} />}
                            {isPending && <Spinner size={isDesktop ? 12 : 8} />}
                            {clip.kind === 'caption' && clip.segments ? (
                              <div className="absolute inset-0 flex">
                                {clip.segments.map((s, i) => (
                                  <div key={s.id} className={`h-full flex items-center min-w-0 animate-tip-in ${isDesktop ? 'px-2' : 'px-1'}`} style={{ width: (s.end - s.start) * pps, borderLeft: i ? '1px solid rgba(255,255,255,0.12)' : undefined }}>
                                    <span className={`${isDesktop ? 'text-[10px]' : ''} truncate`} style={{ color: 'rgba(255,255,255,0.62)' }}>{s.text}</span>
                                  </div>
                                ))}
                              </div>
                            ) : track.kind === 'audio' ? (
                              <>
                                <Waveform seed={3} />
                                <span className="relative text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{clip.label}</span>
                              </>
                            ) : thumb ? (
                              <span className={`truncate rounded-md ${isDesktop ? 'text-[10px] px-1.5 py-0.5' : 'hidden'}`} style={{ color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.45)' }}>{clip.label}</span>
                            ) : (
                              <span className={`truncate ${clip.kind === 'text' ? `${isDesktop ? 'text-[11px]' : ''} font-semibold text-white` : isDesktop ? 'text-[10px]' : ''}`} style={clip.kind === 'text' ? undefined : { color: 'rgba(255,255,255,0.55)' }}>
                                {clip.kind === 'text' ? clip.text : isPending ? `${clip.label} ${Math.round((clip.progress ?? 0) * 100)}%` : clip.label}
                              </span>
                            )}
                          </div>
                        )}
                        {isSel && (
                          <>
                            <div onPointerDown={(e) => onClipPointerDown(e, clip, 'trim-l')} onPointerMove={(e) => onClipPointerMove(e, clip)} onPointerUp={() => onClipPointerUp(clip)}
                              className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center cursor-ew-resize" style={{ width: isDesktop ? 9 : 7, background: '#d946ef' }}>
                              <div className="w-[2px] h-1/2 rounded-full bg-black/70" />
                            </div>
                            <div onPointerDown={(e) => onClipPointerDown(e, clip, 'trim-r')} onPointerMove={(e) => onClipPointerMove(e, clip)} onPointerUp={() => onClipPointerUp(clip)}
                              className="absolute right-0 top-0 bottom-0 z-20 flex items-center justify-center cursor-ew-resize" style={{ width: isDesktop ? 9 : 7, background: '#d946ef' }}>
                              <div className="w-[2px] h-1/2 rounded-full bg-black/70" />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Playhead — VideoRetakeTimeline vocabulary: white line + triangle */}
          <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: gutter + time * pps, transition: 'left 80ms linear' }}>
            <div className="absolute -top-0.5 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid #fff' }} />
            <div className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-white" style={{ boxShadow: '0 0 6px rgba(0,0,0,0.6)' }} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center py-2">{toolbar}</div>
    </div>
  );
}
