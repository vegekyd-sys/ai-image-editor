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
  color: string;
  lineWidth: number;
}

export default function AnnotationCanvas({
  imageRect, naturalWidth, naturalHeight,
  activeTool, entries, onAddEntry,
  color, lineWidth,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ type: 'brush'; points: { x: number; y: number }[] } | { type: 'rect'; sx: number; sy: number; cx: number; cy: number } | null>(null);

  // Text input state
  const [textInput, setTextInput] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);

  // Map client coords → canvas pixel coords
  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (el.width / rect.width),
      y: (clientY - rect.top) * (el.height / rect.height),
    };
  }, []);

  // Redraw all entries + current in-progress stroke
  const redraw = useCallback((tempEntry?: AnnotationEntry) => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    replayAnnotations(ctx, entries);
    if (tempEntry) replayAnnotations(ctx, [tempEntry]);
  }, [entries]);

  // Redraw when entries change
  useEffect(() => { redraw(); }, [redraw]);

  // Pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (activeTool === 'text') {
      // Show text input at click position
      const { x, y } = toCanvasCoords(e.clientX, e.clientY);
      const el = canvasRef.current!;
      const rect = el.getBoundingClientRect();
      setTextInput({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        canvasX: x,
        canvasY: y,
      });
      setTextValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }

    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    if (activeTool === 'brush') {
      drawingRef.current = { type: 'brush', points: [{ x, y }] };
    } else if (activeTool === 'rect') {
      drawingRef.current = { type: 'rect', sx: x, sy: y, cx: x, cy: y };
    }
  }, [activeTool, toCanvasCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    if (drawingRef.current.type === 'brush') {
      drawingRef.current.points.push({ x, y });
      // Draw live stroke
      const tempEntry: AnnotationEntry = {
        type: 'brush', color, lineWidth,
        data: { points: [...drawingRef.current.points] } as BrushData,
      };
      redraw(tempEntry);
    } else if (drawingRef.current.type === 'rect') {
      drawingRef.current.cx = x;
      drawingRef.current.cy = y;
      const { sx, sy, cx, cy } = drawingRef.current;
      const tempEntry: AnnotationEntry = {
        type: 'rect', color, lineWidth,
        data: { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) } as RectData,
      };
      redraw(tempEntry);
    }
  }, [toCanvasCoords, color, lineWidth, redraw]);

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;

    if (drawingRef.current.type === 'brush' && drawingRef.current.points.length >= 2) {
      onAddEntry({
        type: 'brush', color, lineWidth,
        data: { points: drawingRef.current.points } as BrushData,
      });
    } else if (drawingRef.current.type === 'rect') {
      const { sx, sy, cx, cy } = drawingRef.current;
      const w = Math.abs(cx - sx);
      const h = Math.abs(cy - sy);
      if (w > 5 && h > 5) {
        onAddEntry({
          type: 'rect', color, lineWidth,
          data: { x: Math.min(sx, cx), y: Math.min(sy, cy), w, h } as RectData,
        });
      }
    }
    drawingRef.current = null;
  }, [color, lineWidth, onAddEntry]);

  // Commit text entry
  const commitText = useCallback(() => {
    if (!textInput || !textValue.trim()) { setTextInput(null); return; }
    const fontSize = Math.max(24, Math.round(naturalWidth * 0.035));
    onAddEntry({
      type: 'text', color, lineWidth,
      data: { x: textInput.canvasX, y: textInput.canvasY, text: textValue.trim(), fontSize } as TextData,
    });
    setTextInput(null);
    setTextValue('');
  }, [textInput, textValue, color, lineWidth, naturalWidth, onAddEntry]);

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

      {/* Floating text input */}
      {textInput && (
        <input
          ref={textInputRef}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput(null); }}
          onBlur={commitText}
          className="absolute outline-none bg-black/60 text-white text-sm px-2 py-1 rounded-lg border border-fuchsia-500/50"
          style={{
            left: textInput.x, top: textInput.y,
            minWidth: 100, maxWidth: 200,
            caretColor: '#d946ef',
          }}
          placeholder="输入文字..."
        />
      )}
    </div>
  );
}
