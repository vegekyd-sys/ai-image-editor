'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { AnnotationEntry, BrushData, RectData, TextData } from '@/types';
import { replayAnnotations } from '@/lib/annotationUtils';

interface AnnotationCanvasProps {
  imageRect: { l: number; t: number; w: number; h: number };
  naturalWidth: number;
  naturalHeight: number;
  activeTool: 'brush' | 'rect' | 'text';
  entries: AnnotationEntry[];
  onAddEntry: (entry: AnnotationEntry) => void;
  onUpdateEntry: (id: string, data: Partial<AnnotationEntry['data']>) => void;
  onDeleteEntry: (id: string) => void;
  color: string;
  lineWidth: number;
  onStartTextEdit?: (canvasX: number, canvasY: number) => void;
  textEditing?: { x: number; y: number; text: string; textColor: string; bgColor: string } | null;
}

let _idCounter = 0;
export function newAnnotationId() { return `ann_${Date.now()}_${++_idCounter}`; }

export default function AnnotationCanvas({
  imageRect, naturalWidth, naturalHeight,
  activeTool, entries, onAddEntry, onUpdateEntry, onDeleteEntry,
  color, lineWidth, onStartTextEdit, textEditing,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Drawing state
  const drawingRef = useRef<
    | { mode: 'brush'; points: { x: number; y: number }[] }
    | { mode: 'rect'; sx: number; sy: number; cx: number; cy: number }
    | { mode: 'move'; entryId: string; startX: number; startY: number; origData: RectData | TextData }
    | null
  >(null);

  // Selected entry (rect/text only)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Text editing preview is driven by parent via textEditing prop

  // Coord mapping
  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (el.width / rect.width),
      y: (clientY - rect.top) * (el.height / rect.height),
    };
  }, []);

  // Hit test: find rect/text entry near a point
  const hitTest = useCallback((cx: number, cy: number): string | null => {
    // Check in reverse order (topmost first)
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'rect') {
        const d = e.data as RectData;
        const margin = 20;
        if (cx >= d.x - margin && cx <= d.x + d.w + margin && cy >= d.y - margin && cy <= d.y + d.h + margin) {
          return e.id;
        }
      } else if (e.type === 'text') {
        const d = e.data as TextData;
        const margin = 20;
        // Approximate text bounding box
        const textW = d.text.length * d.fontSize * 0.6;
        if (cx >= d.x - margin && cx <= d.x + textW + margin && cy >= d.y - d.fontSize - margin && cy <= d.y + margin) {
          return e.id;
        }
      }
    }
    return null;
  }, [entries]);

  // Redraw
  const redraw = useCallback((tempEntry?: AnnotationEntry) => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    replayAnnotations(ctx, entries);
    if (tempEntry) replayAnnotations(ctx, [tempEntry]);

    // Draw selection indicator
    if (selectedId) {
      const sel = entries.find(e => e.id === selectedId);
      if (sel) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        if (sel.type === 'rect') {
          const d = sel.data as RectData;
          ctx.strokeRect(d.x - 4, d.y - 4, d.w + 8, d.h + 8);
        } else if (sel.type === 'text') {
          const d = sel.data as TextData;
          const textW = d.text.length * d.fontSize * 0.6;
          ctx.strokeRect(d.x - 4, d.y - d.fontSize - 4, textW + 8, d.fontSize + 12);
        }
        ctx.restore();
      }
    }
  }, [entries, selectedId]);

  useEffect(() => { redraw(); }, [redraw]);

  // Deselect when tool changes
  useEffect(() => { setSelectedId(null); }, [activeTool]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    // Text tool: place text input
    if (activeTool === 'text') {
      setSelectedId(null);
      onStartTextEdit?.(x, y);
      return;
    }

    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // Check if clicking on an existing rect/text to select/move
    const hitId = hitTest(x, y);
    if (hitId) {
      const entry = entries.find(en => en.id === hitId);
      if (entry && (entry.type === 'rect' || entry.type === 'text')) {
        setSelectedId(hitId);
        drawingRef.current = {
          mode: 'move', entryId: hitId, startX: x, startY: y,
          origData: { ...entry.data } as RectData | TextData,
        };
        return;
      }
    }

    setSelectedId(null);

    if (activeTool === 'brush') {
      drawingRef.current = { mode: 'brush', points: [{ x, y }] };
    } else if (activeTool === 'rect') {
      drawingRef.current = { mode: 'rect', sx: x, sy: y, cx: x, cy: y };
    }
  }, [activeTool, toCanvasCoords, hitTest, entries]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    if (drawingRef.current.mode === 'brush') {
      drawingRef.current.points.push({ x, y });
      const tempEntry: AnnotationEntry = {
        id: '_temp', type: 'brush', color, lineWidth,
        data: { points: [...drawingRef.current.points] } as BrushData,
      };
      redraw(tempEntry);
    } else if (drawingRef.current.mode === 'rect') {
      drawingRef.current.cx = x;
      drawingRef.current.cy = y;
      const { sx, sy, cx, cy } = drawingRef.current;
      const tempEntry: AnnotationEntry = {
        id: '_temp', type: 'rect', color, lineWidth,
        data: { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) } as RectData,
      };
      redraw(tempEntry);
    } else if (drawingRef.current.mode === 'move') {
      const dx = x - drawingRef.current.startX;
      const dy = y - drawingRef.current.startY;
      const orig = drawingRef.current.origData;
      if ('w' in orig) {
        // RectData
        onUpdateEntry(drawingRef.current.entryId, { x: orig.x + dx, y: orig.y + dy, w: orig.w, h: orig.h });
      } else {
        // TextData
        onUpdateEntry(drawingRef.current.entryId, { x: orig.x + dx, y: orig.y + dy, text: (orig as TextData).text, fontSize: (orig as TextData).fontSize });
      }
    }
  }, [toCanvasCoords, color, lineWidth, redraw, onUpdateEntry]);

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;

    if (drawingRef.current.mode === 'brush' && drawingRef.current.points.length >= 2) {
      onAddEntry({
        id: newAnnotationId(), type: 'brush', color, lineWidth,
        data: { points: drawingRef.current.points } as BrushData,
      });
    } else if (drawingRef.current.mode === 'rect') {
      const { sx, sy, cx, cy } = drawingRef.current;
      const w = Math.abs(cx - sx);
      const h = Math.abs(cy - sy);
      if (w > 5 && h > 5) {
        onAddEntry({
          id: newAnnotationId(), type: 'rect', color, lineWidth,
          data: { x: Math.min(sx, cx), y: Math.min(sy, cy), w, h } as RectData,
        });
      }
    }
    // move: already updated via onUpdateEntry during drag
    drawingRef.current = null;
  }, [color, lineWidth, onAddEntry]);


  return (
    <div
      className="absolute"
      style={{
        left: imageRect.l, top: imageRect.t,
        width: imageRect.w, height: imageRect.h,
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        width={naturalWidth}
        height={naturalHeight}
        className="w-full h-full"
        style={{ cursor: activeTool === 'text' ? 'text' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {/* Delete button for selected entry */}
      {selectedId && (() => {
        const sel = entries.find(en => en.id === selectedId);
        if (!sel || (sel.type !== 'rect' && sel.type !== 'text')) return null;
        const el = canvasRef.current;
        if (!el) return null;
        const scaleX = el.clientWidth / el.width;
        const scaleY = el.clientHeight / el.height;
        let bx: number, by: number;
        if (sel.type === 'rect') {
          const d = sel.data as RectData;
          bx = (d.x + d.w) * scaleX;
          by = d.y * scaleY;
        } else {
          const d = sel.data as TextData;
          const textW = d.text.length * d.fontSize * 0.6;
          bx = (d.x + textW) * scaleX;
          by = (d.y - d.fontSize) * scaleY;
        }
        return (
          <button
            onClick={() => { onDeleteEntry(selectedId); setSelectedId(null); }}
            className="absolute w-6 h-6 rounded-full bg-red-500 flex items-center justify-center cursor-pointer z-10"
            style={{ left: bx + 4, top: by - 12, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        );
      })()}

      {/* Text editing preview — shows live what text will look like */}
      {textEditing && textEditing.text && (() => {
        const el = canvasRef.current;
        if (!el) return null;
        const scaleX = el.clientWidth / el.width;
        const scaleY = el.clientHeight / el.height;
        return (
          <div
            className="absolute pointer-events-none font-bold text-[14px] px-1.5 py-0.5 rounded"
            style={{
              left: textEditing.x * scaleX,
              top: (textEditing.y - 20) * scaleY,
              color: textEditing.textColor,
              background: textEditing.bgColor || 'transparent',
              whiteSpace: 'nowrap',
              border: '1px dashed rgba(255,255,255,0.4)',
            }}
          >
            {textEditing.text}
          </div>
        );
      })()}
    </div>
  );
}
