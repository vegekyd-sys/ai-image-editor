'use client';

// Canvas layer for timeline videos, rendered by ImageCanvas over the Player.
// Same vocabulary as DesignOverlay (fuchsia frame, corner brackets, label tag).
// Only clicks are handled at the root so ImageCanvas swipe / pull-down gestures
// keep working; dragging is limited to the selected element's frame.
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n';
import type { Box, Clip, TimelineDoc, TimelineOp } from '@/lib/timeline/types';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

function trackKindOf(doc: TimelineDoc, clip: Clip) {
  return doc.tracks.find(t => t.id === clip.trackId)?.kind;
}

export function clipCanvasBox(doc: TimelineDoc, clip: Clip): Box | null {
  if ('box' in clip && clip.box) return clip.box;
  const kind = trackKindOf(doc, clip);
  if (clip.kind === 'caption') {
    const size = clip.style?.fontSize || Math.round(doc.width * 0.052);
    const pos = clip.style?.position || 'bottom';
    const h = size * 2;
    const y = pos === 'top' ? doc.height * 0.12 : pos === 'center' ? (doc.height - h) / 2 : doc.height * 0.86 - h;
    return { x: doc.width * 0.07, y, w: doc.width * 0.86, h };
  }
  if (kind === 'main' || kind === 'overlay') return { x: 0, y: 0, w: doc.width, h: doc.height };
  return null;
}

const HIT_ORDER = ['overlay', 'text', 'caption', 'main'] as const;

interface Props {
  doc: TimelineDoc;
  time: number;
  selectedId: string | null;
  agentClipId: string | null;
  readOnly?: boolean;
  onSelect: (id: string | null) => void;
  onEditText: (id: string) => void;
  onBeginGesture: () => void;
  onOp: (op: TimelineOp) => void;
  onInteract: () => void;
}

export default function TimelineCanvasOverlay({ doc, time, selectedId, agentClipId, readOnly, onSelect, onEditText, onBeginGesture, onOp, onInteract }: Props) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const gesture = useRef<{ x0: number; y0: number; box: Box; id: string; corner?: Corner; moved: boolean } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const scale = size.w && size.h ? Math.min(size.w / doc.width, size.h / doc.height) : 0;
  const ox = (size.w - doc.width * scale) / 2;
  const oy = (size.h - doc.height * scale) / 2;
  const visible = (c: Clip) => time >= c.start && time < c.start + c.duration;

  const hitTest = (clientX: number, clientY: number): Clip | undefined => {
    if (!scale || !rootRef.current) return undefined;
    const rect = rootRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - ox) / scale;
    const y = (clientY - rect.top - oy) / scale;
    for (const kind of HIT_ORDER) {
      const hit = Object.values(doc.clips)
        .filter(c => trackKindOf(doc, c) === kind && visible(c))
        .reverse()
        .find(c => {
          const b = clipCanvasBox(doc, c);
          return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
        });
      if (hit) return hit;
    }
    return undefined;
  };

  const selected = selectedId ? doc.clips[selectedId] : null;
  const agentClip = !selected && agentClipId ? doc.clips[agentClipId] : null;
  const frameClip = selected ?? agentClip;
  const frameBox = frameClip && visible(frameClip) ? clipCanvasBox(doc, frameClip) : null;
  const isAgentFrame = !selected && !!agentClip;
  const canTransform = !readOnly && !isAgentFrame && !!frameClip && 'box' in frameClip && !!frameClip.box;

  const start = (e: React.PointerEvent, clip: Clip, corner?: Corner) => {
    if (!canTransform || !('box' in clip) || !clip.box) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { x0: e.clientX, y0: e.clientY, box: clip.box, id: clip.id, corner, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !e.buttons || !scale) return;
    e.stopPropagation();
    const dx = (e.clientX - g.x0) / scale;
    const dy = (e.clientY - g.y0) / scale;
    if (!g.moved) { if (Math.hypot(dx, dy) * scale < 3) return; g.moved = true; onBeginGesture(); onInteract(); }
    const b = g.box;
    if (!g.corner) {
      onOp({ op: 'update', id: g.id, patch: { box: { ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) } } });
      return;
    }
    const right = g.corner[1] === 'r';
    const bottom = g.corner[0] === 'b';
    const w = Math.max(80, b.w + (right ? dx : -dx));
    const h = w * (b.h / b.w);
    onOp({ op: 'update', id: g.id, patch: { box: { ...b, w: Math.round(w), h: Math.round(h), x: Math.round(right ? b.x : b.x + b.w - w), y: Math.round(bottom ? b.y : b.y + b.h - h) } } });
  };
  const end = (e: React.PointerEvent) => { if (gesture.current?.moved) e.stopPropagation(); gesture.current = null; };

  const screen = (b: Box) => ({ left: ox + b.x * scale, top: oy + b.y * scale, width: b.w * scale, height: b.h * scale });

  return (
    <div
      ref={rootRef}
      data-testid="timeline-canvas-overlay"
      className="absolute inset-0 z-[15]"
      onClick={(e) => {
        if (gesture.current) return;
        const hit = hitTest(e.clientX, e.clientY);
        onInteract();
        onSelect(hit?.id ?? null);
      }}
      onDoubleClick={(e) => {
        const hit = hitTest(e.clientX, e.clientY);
        if (hit && (hit.kind === 'text' || hit.kind === 'caption')) onEditText(hit.id);
      }}
    >
      {frameBox && frameClip && scale > 0 && (
        <div
          className="absolute"
          style={{
            ...screen(frameBox),
            border: `1.5px solid ${isAgentFrame ? 'rgba(232,121,249,0.9)' : '#d946ef'}`,
            cursor: canTransform ? 'move' : 'default',
            transition: gesture.current ? 'none' : 'left 240ms cubic-bezier(.2,.8,.2,1), top 240ms cubic-bezier(.2,.8,.2,1), width 240ms cubic-bezier(.2,.8,.2,1), height 240ms cubic-bezier(.2,.8,.2,1)',
            touchAction: canTransform ? 'none' : undefined,
            pointerEvents: canTransform ? 'auto' : 'none',
          }}
          onPointerDown={e => start(e, frameClip)}
          onPointerMove={move}
          onPointerUp={end}
          onClick={e => { if (canTransform) e.stopPropagation(); }}
        >
          {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
            <div key={c}
              onPointerDown={e => start(e, frameClip, c)}
              onPointerMove={move}
              onPointerUp={end}
              className="absolute"
              style={{
                width: 16, height: 16,
                [c[0] === 't' ? 'top' : 'bottom']: -3, [c[1] === 'l' ? 'left' : 'right']: -3,
                [`border${c[0] === 't' ? 'Top' : 'Bottom'}`]: '3px solid #d946ef',
                [`border${c[1] === 'l' ? 'Left' : 'Right'}`]: '3px solid #d946ef',
                cursor: canTransform ? (c === 'tl' || c === 'br' ? 'nwse-resize' : 'nesw-resize') : 'default',
                touchAction: 'none',
              }} />
          ))}
          <span className="absolute left-0 text-[10px] font-medium text-white px-1.5 py-[1px] rounded-sm whitespace-nowrap flex items-center gap-1 pointer-events-none"
            style={{ background: 'rgb(217,70,239)', top: frameBox.y * scale < 20 ? 4 : -18, left: frameBox.y * scale < 20 ? 4 : 0 }}>
            {isAgentFrame && <span className="w-1.5 h-1.5 rounded-full bg-white" style={{ animation: 'mkr-timeline-breathe 1s ease-in-out infinite' }} />}
            {isAgentFrame ? `${t('timeline.agent')} · ${frameClip.label || t(`timeline.clip.${frameClip.kind}` as 'timeline.clip.video')}` : (frameClip.label || t(`timeline.clip.${frameClip.kind}` as 'timeline.clip.video'))}
          </span>
        </div>
      )}
    </div>
  );
}
