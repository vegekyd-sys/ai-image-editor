'use client';

import type { EditableField } from '@/types';
import FloatingPanel from '@/components/FloatingPanel';
import { getVideoTrimPropKeys } from '@/lib/editor/video-trim';

interface DesignVideoTrimEditorProps {
  field: EditableField;
  props: Record<string, unknown>;
  fps: number;
  durationInFrames: number;
  onUpdateProp: (key: string, value: number) => void;
  onClose: () => void;
  isDesktop: boolean;
}

function clampFrame(value: unknown, fallback: number, maxFrame: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(maxFrame, Math.round(n)));
}

function formatFrame(frame: number, fps: number): string {
  return `${(frame / fps).toFixed(2)}s / ${frame}f`;
}

export default function DesignVideoTrimEditor({
  field,
  props,
  fps,
  durationInFrames,
  onUpdateProp,
  onClose,
  isDesktop,
}: DesignVideoTrimEditorProps) {
  const { startKey, endKey, isLegacy } = getVideoTrimPropKeys(field);
  const maxFrame = Math.max(1, durationInFrames);
  const start = clampFrame(startKey ? props[startKey] : 0, 0, maxFrame);
  const end = clampFrame(endKey ? props[endKey] : maxFrame, maxFrame, maxFrame);
  const safeStart = Math.min(start, Math.max(0, end - 1));
  const safeEnd = Math.max(end, safeStart + 1);
  const canTrim = Boolean(startKey && endKey);

  const updateStart = (value: number) => {
    if (!startKey || !endKey) return;
    const next = Math.min(clampFrame(value, safeStart, maxFrame), safeEnd - 1);
    onUpdateProp(startKey, next);
  };

  const updateEnd = (value: number) => {
    if (!startKey || !endKey) return;
    const next = Math.max(clampFrame(value, safeEnd, maxFrame), safeStart + 1);
    onUpdateProp(endKey, next);
  };

  const resetTrim = () => {
    if (startKey) onUpdateProp(startKey, 0);
    if (endKey) onUpdateProp(endKey, maxFrame);
  };

  return (
    <FloatingPanel onClose={onClose} isDesktop={isDesktop}>
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-3 text-white w-full">
        <div className="flex items-center justify-between gap-2">
          <span
            className="px-2 py-0.5 rounded text-[11px] font-medium"
            style={{ background: 'rgba(217,70,239,0.3)', color: 'rgb(217,70,239)' }}
          >
            {field.label}
          </span>
          <span className="text-[11px] text-white/35 tabular-nums">
            {isLegacy ? 'Legacy trim' : formatFrame(safeEnd - safeStart, fps)}
          </span>
        </div>

        {canTrim ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/50">Start</span>
                <span className="text-white/70 tabular-nums">{formatFrame(safeStart, fps)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxFrame - 1}
                step={1}
                value={safeStart}
                onChange={(e) => updateStart(Number(e.target.value))}
                className="w-full accent-fuchsia-500"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/50">End</span>
                <span className="text-white/70 tabular-nums">{formatFrame(safeEnd, fps)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={maxFrame}
                step={1}
                value={safeEnd}
                onChange={(e) => updateEnd(Number(e.target.value))}
                className="w-full accent-fuchsia-500"
              />
            </label>

            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                onClick={resetTrim}
                className="h-8 rounded-full text-[12px] font-semibold text-white/70 border border-white/10 active:scale-95"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                Reset
              </button>
              <button
                onClick={onClose}
                className="h-8 rounded-full text-[12px] font-semibold text-white active:scale-95"
                style={{ background: '#c026d3' }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] leading-snug text-white/45">
              This video layer was not created with editable trim keys.
            </p>
            <button
              onClick={onClose}
              className="h-8 rounded-full text-[12px] font-semibold text-white active:scale-95"
              style={{ background: '#c026d3' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
