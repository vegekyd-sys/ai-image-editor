'use client';

// Video Timeline V2 design prototype (dev only).
// Built on the real Editor shell: same GUI column / resizable CUI panel on
// desktop, same GUI ↔ full-screen CUI on mobile, same bottom-bar slot,
// AgentStatusBar, DesignEditorFrame + DesignFieldEditor, StudioRunStageCard,
// liquid-glass classes. Only TimelineDock is new, and it replaces the
// DesignEditPanel pill carousel in that slot for timeline videos.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import AgentStatusBar from '@/components/AgentStatusBar';
import DesignEditorFrame from '@/components/DesignEditorFrame';
import DesignFieldEditor from '@/components/DesignFieldEditor';
import { StudioRunStageCard } from '@/components/StudioRunDock';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { DesignPayload, EditableField } from '@/types';
import TimelineComposition from './TimelineComposition';
import TimelineDock from './TimelineDock';
import { AGENT_REQUEST, AGENT_SCRIPT, applyOp, docDuration, initialDoc, type Box, type Clip, type TimelineDoc, type TimelineOp } from './prototype-doc';

type Row = { time: string; text: string; clipId: string };
type AgentState = { active: boolean; status: string; clipId: string | null; rows: Row[]; done: boolean; request: string | null };

const IDLE_AGENT: AgentState = { active: false, status: '', clipId: null, rows: [], done: false, request: null };
const CAPTION_BOX: Box = { x: 80, y: 1920 - 260 - 110, w: 920, h: 110 };

function fmt(t: number) {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function clipBox(clip: Clip, doc: TimelineDoc): Box | null {
  if (clip.box) return clip.box;
  if (clip.kind === 'caption') return CAPTION_BOX;
  if (clip.trackId === 't-main') return { x: 0, y: 0, w: doc.width, h: doc.height };
  return null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function TimelinePrototype() {
  const isDesktop = useIsDesktop();
  const [doc, setDoc] = useState<TimelineDoc>(initialDoc);
  const [history, setHistory] = useState<TimelineDoc[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentState>(IDLE_AGENT);
  const [follow, setFollow] = useState(true);
  const [viewMode, setViewMode] = useState<'gui' | 'cui'>('gui');
  const [input, setInput] = useState('');
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const playerRef = useRef<PlayerRef>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  const followRef = useRef(follow);
  const runToken = useRef(0);
  docRef.current = doc;
  followRef.current = follow;

  const duration = docDuration(doc);
  const durationInFrames = Math.max(1, Math.round(duration * doc.fps));

  // ── Player wiring (same custom controls as ImageCanvas design playback) ──
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setTime(e.detail.frame / doc.fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
    };
  }, [doc.fps, isDesktop, viewMode]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop, viewMode]);

  const seek = useCallback((t: number) => {
    const frame = Math.round(Math.max(0, Math.min(duration, t)) * doc.fps);
    playerRef.current?.seekTo(Math.min(frame, durationInFrames - 1));
    setTime(frame / doc.fps);
  }, [doc.fps, duration, durationInFrames]);

  const pushHistory = useCallback(() => setHistory(h => [...h.slice(-30), docRef.current]), []);
  const dispatch = useCallback((op: TimelineOp) => setDoc(d => applyOp(d, op)), []);
  const undo = () => {
    setHistory(h => {
      if (!h.length) return h;
      setDoc(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  // ── The user takes the wheel → stop following the Agent (resume via "See") ──
  const userTouched = useCallback(() => {
    if (agent.active && followRef.current) setFollow(false);
  }, [agent.active]);

  // ── Scripted Agent run: stands in for edit_timeline tx over SSE/Realtime ──
  const runAgent = useCallback(async (request: string) => {
    const token = ++runToken.current;
    setDoc(initialDoc());
    setHistory([]);
    setSelectedId(null);
    setEditingId(null);
    setFollow(true);
    setAgent({ ...IDLE_AGENT, active: true, status: '思考中…', request });
    await sleep(900);
    for (const step of AGENT_SCRIPT) {
      if (runToken.current !== token) return;
      if (step.ops?.length) {
        setHistory(h => [...h, docRef.current]);
        setDoc(d => step.ops!.reduce(applyOp, d));
      }
      setAgent(a => ({
        ...a,
        status: step.status,
        clipId: step.focus?.clipId ?? a.clipId,
        rows: step.row ? [...a.rows, step.row] : a.rows,
      }));
      if (step.focus && followRef.current) {
        playerRef.current?.pause();
        const frame = Math.round(step.focus.time * 30);
        playerRef.current?.seekTo(frame);
        setTime(frame / 30);
      }
      if (step.pendingFor) {
        const id = step.pendingFor;
        const t0 = performance.now();
        while (performance.now() - t0 < step.delay) {
          if (runToken.current !== token) return;
          const progress = Math.min(0.99, (performance.now() - t0) / step.delay);
          setDoc(d => (d.clips[id] ? { ...d, clips: { ...d.clips, [id]: { ...d.clips[id], progress } } } : d));
          await sleep(120);
        }
      } else {
        await sleep(step.delay);
      }
    }
    if (runToken.current !== token) return;
    setAgent(a => ({ ...a, active: false, clipId: null, done: true, status: `已完成 ${a.rows.length} 处修改 · 可在时间线上继续调整` }));
    if (followRef.current) {
      playerRef.current?.seekTo(0);
      playerRef.current?.play();
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => runAgent(AGENT_REQUEST), 1400);
    return () => { clearTimeout(timer); runToken.current++; };
  }, [runAgent]);

  // Keep the newest Agent step in view (AgentChatView scrolls to messagesEnd the same way)
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [agent.rows.length, agent.active, agent.done, viewMode, isDesktop]);

  // ── Canvas geometry (Player letterboxes the 9:16 composition) ──
  const scale = canvasSize.w && canvasSize.h ? Math.min(canvasSize.w / doc.width, canvasSize.h / doc.height) : 0;
  const ox = (canvasSize.w - doc.width * scale) / 2;
  const oy = (canvasSize.h - doc.height * scale) / 2;
  const toScreen = (b: Box) => ({ left: ox + b.x * scale, top: oy + b.y * scale, width: b.w * scale, height: b.h * scale });

  const visibleAt = (c: Clip) => time >= c.start && time < c.start + c.duration;
  const hitOrder = ['t-overlay', 't-text', 't-caption', 't-main'];
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!scale) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left - ox) / scale;
    const y = (e.clientY - rect.top - oy) / scale;
    const hit = hitOrder
      .flatMap(tid => Object.values(docRef.current.clips).filter(c => c.trackId === tid && visibleAt(c)))
      .find(c => {
        const b = clipBox(c, docRef.current);
        return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      });
    userTouched();
    setSelectedId(hit?.id ?? null);
    if (hit) playerRef.current?.pause();
  };

  // Drag selected text / PiP on canvas (DesignOverlay-style move)
  const moveRef = useRef<{ x0: number; y0: number; box: Box; id: string } | null>(null);
  const onFramePointerDown = (e: React.PointerEvent, clip: Clip) => {
    if (!clip.box) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pushHistory();
    moveRef.current = { x0: e.clientX, y0: e.clientY, box: clip.box, id: clip.id };
  };
  const onFramePointerMove = (e: React.PointerEvent) => {
    const m = moveRef.current;
    if (!m || !e.buttons || !scale) return;
    dispatch({ op: 'update', id: m.id, patch: { box: { ...m.box, x: Math.round(m.box.x + (e.clientX - m.x0) / scale), y: Math.round(m.box.y + (e.clientY - m.y0) / scale) } } });
  };

  const selected = selectedId ? doc.clips[selectedId] : null;
  const agentClip = agent.clipId ? doc.clips[agent.clipId] : null;
  const frameClip = selected ?? (agent.active && follow ? agentClip : null);
  const frameBox = frameClip && visibleAt(frameClip) ? clipBox(frameClip, doc) : null;
  const isAgentFrame = !selected && !!frameClip;

  // ── Field editor reuse: map a clip to the existing EditableField contract ──
  const editing = editingId ? doc.clips[editingId] : null;
  const editorModel = useMemo(() => {
    if (!editing) return null;
    const field: EditableField = editing.kind === 'video'
      ? { id: editing.id, type: 'video', label: editing.label, propKey: 'src', trimBeforePropKey: 'tb', trimAfterPropKey: 'ta' }
      : { id: editing.id, type: 'text', label: editing.label, propKey: 'text' };
    const design: DesignPayload = {
      code: '',
      width: doc.width,
      height: doc.height,
      props: editing.kind === 'video'
        ? { src: editing.src, tb: Math.round((editing.sourceIn ?? 0) * doc.fps), ta: Math.round(((editing.sourceIn ?? 0) + editing.duration) * doc.fps) }
        : { text: editing.text },
      animation: { fps: doc.fps, durationInSeconds: duration },
    } as DesignPayload;
    return { field, design };
  }, [editing, doc.width, doc.height, doc.fps, duration]);

  const onEditorUpdate = (key: string, value: unknown) => {
    if (!editing) return;
    if (key === 'text') dispatch({ op: 'update', id: editing.id, patch: { text: String(value) } });
    if (key === 'tb') {
      const tb = Number(value) / doc.fps;
      const end = (editing.sourceIn ?? 0) + editing.duration;
      dispatch({ op: 'update', id: editing.id, patch: { sourceIn: tb, duration: Math.max(0.5, end - tb) } });
    }
    if (key === 'ta') dispatch({ op: 'update', id: editing.id, patch: { duration: Math.max(0.5, Number(value) / doc.fps - (editing.sourceIn ?? 0)) } });
  };

  const fieldEditor = editorModel && editing ? (
    <DesignFieldEditor
      field={editorModel.field}
      design={editorModel.design}
      posterImage={editing.poster}
      onUpdateProp={onEditorUpdate}
      onClose={() => setEditingId(null)}
      isDesktop={isDesktop}
    />
  ) : null;

  const statusText = agent.active
    ? agent.status
    : agent.done ? agent.status : '视频已就绪 · 点时间线上的元素直接编辑';

  // ── GUI column ──
  const canvas = (
    <div ref={canvasRef} className="flex-1 relative min-h-0 overflow-hidden" onPointerDown={onCanvasPointerDown}>
      <Player
        ref={playerRef}
        component={TimelineComposition}
        inputProps={{ doc }}
        durationInFrames={durationInFrames}
        fps={doc.fps}
        compositionWidth={doc.width}
        compositionHeight={doc.height}
        style={{ width: '100%', height: '100%' }}
        acknowledgeRemotionLicense
        loop
      />

      {/* Top toolbar — same as Editor overlay top bar, hidden while an element is selected */}
      {!selected && (
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10" onPointerDown={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button className="text-white/80 hover:text-white p-2 cursor-pointer" aria-label="Back">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <button className="text-white/80 hover:text-white p-2 cursor-pointer" aria-label="New">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <button
            className="mkr-liquid-pill px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer active:scale-95 text-white"
            style={{ border: '0.5px solid rgba(232,121,249,0.30)', background: 'linear-gradient(145deg, rgba(217,70,239,0.20), rgba(10,10,14,0.38))' }}
          >
            Save
          </button>
        </div>
      )}

      {/* Selection frame — DesignOverlay vocabulary (fuchsia frame + corner brackets + label tag) */}
      {frameBox && frameClip && scale > 0 && (
        <div
          className="absolute z-20"
          style={{ ...toScreen(frameBox), border: `1.5px solid ${isAgentFrame ? 'rgba(232,121,249,0.9)' : '#d946ef'}`, cursor: frameClip.box && !isAgentFrame ? 'move' : 'default', transition: moveRef.current ? 'none' : 'all 260ms cubic-bezier(.2,.8,.2,1)' }}
          onPointerDown={e => !isAgentFrame && onFramePointerDown(e, frameClip)}
          onPointerMove={onFramePointerMove}
          onPointerUp={() => { moveRef.current = null; }}
        >
          {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
            <div key={c} className="absolute" style={{
              width: 10, height: 10,
              [c[0] === 't' ? 'top' : 'bottom']: -2, [c[1] === 'l' ? 'left' : 'right']: -2,
              [`border${c[0] === 't' ? 'Top' : 'Bottom'}`]: '3px solid #d946ef',
              [`border${c[1] === 'l' ? 'Left' : 'Right'}`]: '3px solid #d946ef',
            }} />
          ))}
          <span className="absolute -top-[18px] left-0 text-[10px] font-medium text-white px-1.5 py-[1px] rounded-sm whitespace-nowrap flex items-center gap-1" style={{ background: 'rgb(217,70,239)' }}>
            {isAgentFrame && <span className="w-1.5 h-1.5 rounded-full bg-white" style={{ animation: 'breathe 1s ease-in-out infinite' }} />}
            {isAgentFrame ? `Agent · ${frameClip.label}` : frameClip.label}
          </span>
        </div>
      )}

      {/* Play/pause — bottom-left (ImageCanvas) */}
      <div className="absolute z-30" style={{ bottom: 8, left: 12 }} onPointerDown={e => e.stopPropagation()}>
        <button
          onClick={() => { if (playing) playerRef.current?.pause(); else { setSelectedId(null); playerRef.current?.play(); } }}
          className="mkr-liquid-play-button w-14 h-14 rounded-full flex items-center justify-center active:scale-90 transition-transform"
        >
          {playing
            ? <svg width="18" height="18" viewBox="0 0 10 10" fill="white"><rect x="1" y="0.5" width="2.8" height="9" rx="0.7" /><rect x="6.2" y="0.5" width="2.8" height="9" rx="0.7" /></svg>
            : <svg width="18" height="18" viewBox="0 0 10 10" fill="white"><polygon points="3.5,1.5 8.5,5 3.5,8.5" /></svg>}
        </button>
      </div>

      {/* History dot rail — unchanged; the timeline video is one snapshot (v2 square marker) */}
      {!selected && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center" style={{ bottom: 12 }} onPointerDown={e => e.stopPropagation()}>
          <div className={`mkr-liquid-timeline-rail rounded-full flex items-center ${isDesktop ? 'gap-1.5 px-3 py-1.5' : 'gap-[5px] px-[10px] py-[5px]'}`}>
            <span className={`mkr-liquid-timeline-dot rounded-full ${isDesktop ? 'w-2 h-2' : 'w-[5px] h-[5px]'}`} />
            <span className={`mkr-liquid-timeline-dot rounded-full ${isDesktop ? 'w-2 h-2' : 'w-[5px] h-[5px]'}`} />
            <span className={`mkr-liquid-timeline-dot mkr-liquid-timeline-dot-active ${isDesktop ? 'w-5 h-2 rounded-[2px]' : 'w-3 h-[5px] rounded-[1px]'}`} />
            <span className={`${isDesktop ? 'text-[12px]' : 'text-[10px]'} ml-1`} style={{ color: 'rgba(255,255,255,0.4)' }}>Video</span>
          </div>
        </div>
      )}

      {/* Time badge — bottom-right */}
      <div className="absolute z-20 pointer-events-none" style={{ bottom: 14, right: 10 }}>
        <span className="mkr-liquid-media-badge tabular-nums rounded-full select-none" style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', padding: '2px 6px' }}>
          {fmt(time)} / {fmt(duration)}
        </span>
      </div>

      {/* Seek bar — 2px, fuchsia fill */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none" style={{ height: 2 }}>
        <div className="absolute inset-0 bg-white/12" />
        <div className="absolute inset-y-0 left-0 bg-fuchsia-500/75" style={{ width: `${(time / duration) * 100}%` }} />
      </div>

      {/* Desktop field editor floats over the GUI column (DesignEditorFrame) */}
      {isDesktop && fieldEditor && (
        <div onPointerDown={e => e.stopPropagation()}>
          <DesignEditorFrame isDesktop desktopWidth={editing?.kind === 'video' ? 420 : 340} keyboardInset={0}>{fieldEditor}</DesignEditorFrame>
        </div>
      )}
    </div>
  );

  const bottomBar = (
    <div className="makaron-editor-bottom-bar flex-shrink-0 bg-gradient-to-t from-black from-70% via-black/95 to-transparent">
      <AgentStatusBar
        statusText={statusText}
        isActive={agent.active}
        onOpenChat={() => setViewMode('cui')}
        hideChat={isDesktop}
        notification={agent.active && !follow ? { text: 'Agent 仍在剪辑 · 已暂停跟随' } : null}
        onSeeNotification={() => setFollow(true)}
      />
      {!isDesktop && fieldEditor ? (
        <DesignEditorFrame isDesktop={false} desktopWidth={340} keyboardInset={0}>{fieldEditor}</DesignEditorFrame>
      ) : (
        <TimelineDock
          doc={doc}
          duration={duration}
          time={time}
          selectedId={selectedId}
          agentClipId={agent.active ? agent.clipId : null}
          isDesktop={isDesktop}
          canUndo={history.length > 0}
          onSelect={(id) => { userTouched(); setSelectedId(id); if (id) playerRef.current?.pause(); }}
          onSeek={(t) => { userTouched(); playerRef.current?.pause(); seek(t); }}
          onEdit={(id) => { setSelectedId(id); setEditingId(id); }}
          onUndo={undo}
          onDragStart={pushHistory}
          onOp={dispatch}
        />
      )}
    </div>
  );

  // ── CUI (shared between desktop panel and mobile full screen) ──
  const isPanel = isDesktop;
  const userBubble = (text: string) => (
    <div className="flex min-w-0 justify-end overflow-hidden">
      <div className={`min-w-0 overflow-hidden text-white/90 leading-relaxed max-w-[82%] ${isPanel ? 'text-[17px]' : 'text-[21px]'}`}
        style={{ background: '#222222', borderRadius: isPanel ? '14px 14px 4px 14px' : '18px 18px 5px 18px', wordBreak: 'break-word' }}>
        <div className={`whitespace-pre-wrap ${isPanel ? 'px-3 py-2' : 'px-4 py-2.5'}`}>{text}</div>
      </div>
    </div>
  );
  const assistant = (children: React.ReactNode) => (
    <div className={`${isPanel ? 'text-[17px] leading-[1.6]' : 'text-[22px] leading-[1.68]'} pr-2`} style={{ color: 'rgba(255,255,255,0.84)', wordBreak: 'break-word' }}>{children}</div>
  );

  const chat = (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0a' }}>
      <div ref={chatScrollRef} className={`flex-1 overflow-y-auto ${isPanel ? 'px-4 pt-4' : 'px-5 pt-[260px]'} pb-4 flex flex-col gap-5`}>
        {userBubble('用 Remotion 做一条 8 秒竖版视频：开场大标题“东京夜色”，三段夜景依次切换，配上音乐。')}
        <StudioRunStageCard
          stage={{ id: 'composition', status: 'completed', artifactVersion: 1, stageUpdatedAt: new Date().toISOString() }}
          status="completed"
          ordinal={6}
          total={8}
          isPanel={isPanel}
        />
        {assistant('第一版已经放到时间线上：3 段视频、开场标题和一条音乐。')}
        {agent.request && userBubble(agent.request)}
        {agent.request && (
          <div className="flex flex-col gap-2.5">
            {assistant('好，我直接在时间线上改，每一步你都能在下面看到：')}
            {/* Edit log — StudioRun TimedItems row layout (time column + text) */}
            {agent.rows.length > 0 && (
              <div className="divide-y divide-white/[0.055]">
                {agent.rows.map((row, i) => (
                  <button
                    key={i}
                    onClick={() => { const c = docRef.current.clips[row.clipId]; if (c) { setSelectedId(c.id); seek(c.start + 0.3); if (!isDesktop) setViewMode('gui'); } }}
                    className={`w-full text-left grid gap-3 py-2.5 animate-tip-in cursor-pointer active:opacity-60 ${isPanel ? 'grid-cols-[52px_1fr]' : 'grid-cols-[68px_1fr]'}`}
                  >
                    <span className={`${isPanel ? 'text-[11px]' : 'text-[13px]'} tabular-nums pt-0.5`} style={{ color: 'rgba(232,121,249,0.72)' }}>{row.time}</span>
                    <span className={`${isPanel ? 'text-[15px]' : 'text-[19px]'} leading-[1.65]`} style={{ color: 'rgba(255,255,255,0.78)' }}>{row.text}</span>
                  </button>
                ))}
              </div>
            )}
            {agent.done && assistant('改好了：开头缩短 1 秒、加了 3 句字幕、右下角放了画中画。都在时间线上，可以直接拖动、点开编辑或撤销。')}
          </div>
        )}
        {agent.active && (
          <div className="flex items-center gap-2 pl-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse flex-shrink-0" />
            <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>{agent.status}</span>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3" style={isPanel ? { paddingBottom: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' } : { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))', paddingTop: 8 }}>
        <div className="mkr-input-box-liquid" style={{ background: 'linear-gradient(145deg, rgba(24,24,30,0.72), rgba(8,8,12,0.58))', borderRadius: 20, border: '0.5px solid rgba(255,255,255,0.11)', boxShadow: '0 18px 48px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.09)', backdropFilter: 'blur(20px) saturate(1.35)' }}>
          <textarea
            value={input}
            rows={1}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) { runAgent(input.trim()); setInput(''); } } }}
            placeholder="让 Agent 改时间线，比如：字幕换成黄色"
            className={`w-full bg-transparent outline-none border-none leading-relaxed resize-none block ${isPanel ? 'text-[17px]' : 'text-[21px]'}`}
            style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', padding: isPanel ? '10px 14px 4px' : '12px 16px 6px' }}
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <div className="flex-1" />
            {agent.active ? (
              <button onClick={() => { runToken.current++; setAgent(a => ({ ...a, active: false, clipId: null, status: '已停止' })); }}
                className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full cursor-pointer"
                style={{ background: 'linear-gradient(145deg, rgba(239,68,68,0.22), rgba(10,10,14,0.36))', color: '#ef4444', border: '0.5px solid rgba(239,68,68,0.26)' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="2" /></svg>
              </button>
            ) : (
              <button onClick={() => { runAgent(input.trim() || AGENT_REQUEST); setInput(''); }}
                className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full cursor-pointer"
                style={{ background: 'linear-gradient(145deg, rgba(192,38,211,0.92), rgba(145,18,178,0.74))', color: '#fff', border: '0.5px solid rgba(232,121,249,0.40)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <div className="makaron-editor-shell h-dvh bg-black relative overflow-hidden flex flex-row">
        <div className="flex-1 min-w-0 flex flex-col relative">
          {canvas}
          {bottomBar}
        </div>
        <div className="flex-shrink-0 relative" style={{ width: 1 }}>
          <div className="absolute inset-y-0 -left-[0.5px] w-[1px] bg-white/[0.08]" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-[6px] py-3 rounded-full bg-white/15 flex flex-col items-center justify-center gap-[3px]">
              <div className="w-[2px] h-[2px] rounded-full bg-white/40" /><div className="w-[2px] h-[2px] rounded-full bg-white/40" /><div className="w-[2px] h-[2px] rounded-full bg-white/40" />
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 border-l border-white/[0.08]" style={{ width: 500 }}>{chat}</div>
      </div>
    );
  }

  return (
    <div className="makaron-editor-shell h-dvh bg-black relative overflow-hidden flex flex-col">
      {viewMode === 'gui' ? (
        <>
          {canvas}
          {bottomBar}
        </>
      ) : (
        <div className="fixed inset-0 z-40">
          {chat}
          <button onClick={() => setViewMode('gui')} className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/80 z-50" aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          {/* CUI PiP — same draggable preview as today, but it plays the live timeline */}
          <div onClick={() => setViewMode('gui')} className="absolute top-3 right-3 z-50 overflow-hidden rounded-2xl cursor-pointer" style={{ width: 132, height: 235, border: '1.5px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
            <Player
              ref={playerRef}
              component={TimelineComposition}
              inputProps={{ doc }}
              durationInFrames={durationInFrames}
              fps={doc.fps}
              compositionWidth={doc.width}
              compositionHeight={doc.height}
              style={{ width: '100%', height: '100%' }}
              acknowledgeRemotionLicense
              loop
            />
            <span className="absolute top-1.5 left-1.5 text-[10px] font-medium text-white/80 px-1.5 py-[1px] rounded-md" style={{ background: 'rgba(0,0,0,0.45)' }}>@3</span>
            {agent.active && (
              <span className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] text-white px-1.5 py-[2px] rounded-md flex items-center gap-1 truncate" style={{ background: 'rgba(217,70,239,0.85)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white flex-shrink-0" style={{ animation: 'breathe 1s ease-in-out infinite' }} />
                <span className="truncate">{agentClip?.label ?? 'Agent'}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
