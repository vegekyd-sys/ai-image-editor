'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EditableField } from '@/types';
import FloatingPanel from '@/components/FloatingPanel';
import { getVideoTrimPropKeys } from '@/lib/editor/video-trim';

interface DesignVideoTrimEditorProps {
  field: EditableField;
  props: Record<string, unknown>;
  fps: number;
  durationInFrames: number;
  posterImage?: string;
  onUpdateProp: (key: string, value: number) => void;
  onClose: () => void;
  isDesktop: boolean;
}

type DragMode = 'start' | 'end' | 'move' | 'scrub' | 'scrub-offset';

const MIN_TRIM_FRAMES = 6;

function clampFrame(value: unknown, fallback: number, maxFrame: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(maxFrame, Math.round(n)));
}

function formatTimelineTime(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function pct(frame: number, maxFrame: number): number {
  return maxFrame > 0 ? (frame / maxFrame) * 100 : 0;
}

function dispatchTrimPreview(sourceFrame: number, startFrame: number, play = false, endFrame?: number) {
  window.dispatchEvent(new CustomEvent('makaron:design-trim-preview', {
    detail: {
      sourceFrame,
      startFrame,
      compositionFrame: Math.max(0, sourceFrame - startFrame),
      play,
      endFrame,
    },
  }));
}

export default function DesignVideoTrimEditor({
  field,
  props,
  fps,
  durationInFrames,
  posterImage,
  onUpdateProp,
  onClose,
  isDesktop,
}: DesignVideoTrimEditorProps) {
  const { startKey, endKey } = getVideoTrimPropKeys(field);
  const maxFrame = Math.max(1, durationInFrames);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startFrame: number;
    endFrame: number;
    playheadFrame: number;
  } | null>(null);

  const startFromProps = clampFrame(startKey ? props[startKey] : 0, 0, maxFrame);
  const endFromProps = clampFrame(endKey ? props[endKey] : maxFrame, maxFrame, maxFrame);
  const safeStartFromProps = Math.min(startFromProps, Math.max(0, endFromProps - MIN_TRIM_FRAMES));
  const safeEndFromProps = Math.max(endFromProps, safeStartFromProps + MIN_TRIM_FRAMES);

  const [draftStart, setDraftStart] = useState(safeStartFromProps);
  const [draftEnd, setDraftEnd] = useState(safeEndFromProps);
  const [playhead, setPlayhead] = useState(safeStartFromProps);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setDraftStart(safeStartFromProps);
    setDraftEnd(safeEndFromProps);
    setPlayhead(prev => Math.max(safeStartFromProps, Math.min(safeEndFromProps, prev)));
  }, [safeStartFromProps, safeEndFromProps]);

  const thumbnails = useMemo(() => Array.from({ length: isDesktop ? 7 : 5 }), [isDesktop]);
  const playheadFrame = Math.max(draftStart, Math.min(draftEnd, playhead));
  const startPercent = pct(draftStart, maxFrame);
  const endPercent = pct(draftEnd, maxFrame);
  const playheadPercent = pct(playheadFrame, maxFrame);

  const updateTrim = useCallback((nextStart: number, nextEnd: number, nextPlayhead = playheadFrame) => {
    const boundedStart = Math.max(0, Math.min(maxFrame - MIN_TRIM_FRAMES, Math.round(nextStart)));
    const boundedEnd = Math.max(boundedStart + MIN_TRIM_FRAMES, Math.min(maxFrame, Math.round(nextEnd)));
    const boundedPlayhead = Math.max(boundedStart, Math.min(boundedEnd, Math.round(nextPlayhead)));
    setDraftStart(boundedStart);
    setDraftEnd(boundedEnd);
    setPlayhead(boundedPlayhead);
    if (startKey) onUpdateProp(startKey, boundedStart);
    if (endKey) onUpdateProp(endKey, boundedEnd);
    dispatchTrimPreview(boundedPlayhead, boundedStart);
  }, [endKey, maxFrame, onUpdateProp, playheadFrame, startKey]);

  const frameFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * maxFrame);
  }, [maxFrame]);

  const startDrag = useCallback((mode: DragMode, clientX: number) => {
    dragRef.current = {
      mode,
      startX: clientX,
      startFrame: draftStart,
      endFrame: draftEnd,
      playheadFrame,
    };
  }, [draftEnd, draftStart, playheadFrame]);

  const updateDrag = useCallback((clientX: number, clientY: number, releaseWhenOutside = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    const track = trackRef.current;
    const rect = track?.getBoundingClientRect();
    const outside = rect
      ? clientX < rect.left || clientX > rect.right || clientY < rect.top - 24 || clientY > rect.bottom + 24
      : false;
    const clampedClientX = rect ? Math.max(rect.left, Math.min(rect.right, clientX)) : clientX;
    const nextFrame = frameFromClientX(clampedClientX);

    if (drag.mode === 'start') {
      updateTrim(Math.min(nextFrame, draftEnd - MIN_TRIM_FRAMES), draftEnd, Math.max(nextFrame, playheadFrame));
      if (outside && releaseWhenOutside) dragRef.current = null;
      return;
    }

    if (drag.mode === 'end') {
      updateTrim(draftStart, Math.max(nextFrame, draftStart + MIN_TRIM_FRAMES), Math.min(nextFrame, playheadFrame));
      if (outside && releaseWhenOutside) dragRef.current = null;
      return;
    }

    if (drag.mode === 'move') {
      if (!rect) return;
      const deltaFrames = Math.round(((clampedClientX - drag.startX) / rect.width) * maxFrame);
      const duration = drag.endFrame - drag.startFrame;
      const nextStart = Math.max(0, Math.min(maxFrame - duration, drag.startFrame + deltaFrames));
      updateTrim(nextStart, nextStart + duration, drag.playheadFrame + (nextStart - drag.startFrame));
      if (outside && releaseWhenOutside) dragRef.current = null;
      return;
    }

    if (drag.mode === 'scrub-offset') {
      if (!rect) return;
      const deltaFrames = Math.round(((clientX - drag.startX) / rect.width) * maxFrame);
      const boundedOffsetPlayhead = Math.max(draftStart, Math.min(draftEnd, drag.playheadFrame + deltaFrames));
      setPlayhead(boundedOffsetPlayhead);
      dispatchTrimPreview(boundedOffsetPlayhead, draftStart);
      if (outside && releaseWhenOutside) dragRef.current = null;
      return;
    }

    const boundedPlayhead = Math.max(draftStart, Math.min(draftEnd, nextFrame));
    setPlayhead(boundedPlayhead);
    dispatchTrimPreview(boundedPlayhead, draftStart);
    if (outside && releaseWhenOutside) dragRef.current = null;
  }, [draftEnd, draftStart, frameFromClientX, maxFrame, playheadFrame, updateTrim]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => updateDrag(event.clientX, event.clientY, true);
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [updateDrag]);

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const next = Math.max(draftStart, Math.min(draftEnd, frameFromClientX(event.clientX)));
    setPlayhead(next);
    dispatchTrimPreview(next, draftStart);
    startDrag('scrub', event.clientX);
  };

  useEffect(() => {
    const onPlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ playing?: boolean }>).detail || {};
      setIsPlaying(!!detail.playing);
    };
    window.addEventListener('makaron:design-trim-playback', onPlayback);
    return () => window.removeEventListener('makaron:design-trim-playback', onPlayback);
  }, []);

  useEffect(() => {
    const onPlayhead = (event: Event) => {
      if (dragRef.current) return;
      const detail = (event as CustomEvent<{ sourceFrame?: number }>).detail || {};
      const next = clampFrame(detail.sourceFrame, playheadFrame, maxFrame);
      setPlayhead(Math.max(draftStart, Math.min(draftEnd, next)));
    };
    window.addEventListener('makaron:design-trim-playhead', onPlayhead);
    return () => window.removeEventListener('makaron:design-trim-playhead', onPlayhead);
  }, [draftEnd, draftStart, maxFrame, playheadFrame]);

  const togglePlayback = () => {
    if (isPlaying) {
      dispatchTrimPreview(playheadFrame, draftStart, false);
      setIsPlaying(false);
      return;
    }
    const frame = playheadFrame >= draftEnd - 1 ? draftStart : playheadFrame;
    setPlayhead(frame);
    setIsPlaying(true);
    dispatchTrimPreview(frame, draftStart, true, draftEnd);
  };

  return (
    <FloatingPanel onClose={onClose} isDesktop={isDesktop}>
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2.5 text-white">
        <div className="flex items-center justify-between gap-2">
          <span
            className="self-start px-2 py-0.5 rounded text-[11px] font-medium"
            style={{ background: 'rgba(217,70,239,0.3)', color: 'rgb(217,70,239)' }}
          >
            {field.label}
          </span>
          <span
            className="rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums text-white/70 cursor-ew-resize select-none touch-none"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startDrag('scrub-offset', event.clientX);
            }}
          >
            {formatTimelineTime(playheadFrame, fps)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={isPlaying ? 'Pause trim preview' : 'Play trim preview'}
            className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full cursor-pointer active:scale-90 transition-all border border-white/10"
            style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
          >
            {isPlaying ? (
              <svg width="13" height="13" viewBox="0 0 10 10" fill="currentColor">
                <rect x="1" y="0.5" width="2.8" height="9" rx="0.7" />
                <rect x="6.2" y="0.5" width="2.8" height="9" rx="0.7" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 10 10" fill="currentColor">
                <polygon points="3,1.4 8.2,5 3,8.6" />
              </svg>
            )}
          </button>

          <div
            ref={trackRef}
            className="relative h-[54px] flex-1 touch-none overflow-hidden rounded-lg border border-white/10"
            style={{ background: 'rgba(255,255,255,0.045)' }}
            onPointerDown={handleTrackPointerDown}
          >
            <div className="absolute inset-[5px] flex overflow-hidden rounded-md">
              {thumbnails.map((_, i) => (
                <div
                  key={i}
                  className="h-full flex-1 border-r border-black/30 bg-cover bg-center last:border-r-0"
                  style={posterImage ? { backgroundImage: `url(${posterImage})` } : { background: 'rgba(255,255,255,0.08)' }}
                />
              ))}
            </div>

            <div className="absolute inset-y-[5px] left-[5px] bg-black/55" style={{ width: `calc(${startPercent}% - 5px)` }} />
            <div className="absolute inset-y-[5px] right-[5px] bg-black/55" style={{ left: `calc(${endPercent}% + 5px)` }} />

            <div
              className="absolute inset-y-[5px] z-10 cursor-grab rounded-md border-2 border-fuchsia-500/95 active:cursor-grabbing"
              style={{
                left: `calc(${startPercent}% + 1px)`,
                width: `calc(${Math.max(0, endPercent - startPercent)}% - 2px)`,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 0 18px rgba(217,70,239,0.18)',
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startDrag('move', event.clientX);
              }}
            >
              <button
                type="button"
                aria-label="Trim start"
                className="absolute left-0 top-0 bottom-0 z-30 w-[18px] rounded-l-[4px] bg-fuchsia-500 active:scale-95"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startDrag('start', event.clientX);
                }}
              >
                <span className="absolute left-[7px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-black/70" />
              </button>
              <button
                type="button"
                aria-label="Trim end"
                className="absolute right-0 top-0 bottom-0 z-30 w-[18px] rounded-r-[4px] bg-fuchsia-500 active:scale-95"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startDrag('end', event.clientX);
                }}
              >
                <span className="absolute right-[7px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-black/70" />
              </button>
            </div>

            <div
              className="absolute bottom-[1px] top-[-12px] z-20 w-px -translate-x-1/2 bg-white/90 pointer-events-none"
              style={{ left: `${playheadPercent}%` }}
            />
            <button
              type="button"
              aria-label="Trim playhead"
              className="absolute bottom-0 top-[-12px] z-20 w-7 -translate-x-1/2 cursor-ew-resize"
              style={{ left: `${playheadPercent}%`, background: 'transparent' }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const next = Math.max(draftStart, Math.min(draftEnd, frameFromClientX(event.clientX)));
                setPlayhead(next);
                dispatchTrimPreview(next, draftStart);
                startDrag('scrub', event.clientX);
              }}
            />
          </div>

          <button
            onClick={onClose}
            className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full cursor-pointer active:scale-90 transition-all"
            style={{ background: '#c026d3', color: '#fff' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
