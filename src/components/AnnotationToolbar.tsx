'use client';

import React, { useState, useRef } from 'react';

const ANNOTATION_COLOR = '#dc2626'; // fixed red — universally understood as "mark this area"
const SIZES: ('S' | 'M' | 'L')[] = ['S', 'M', 'L'];
const SIZE_LW = { S: 2, M: 4, L: 7 };

interface AnnotationToolbarProps {
  activeTool: 'brush' | 'rect' | 'text';
  onToolChange: (tool: 'brush' | 'rect' | 'text') => void;
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
  canUndo: boolean;
  onSend: (text: string) => void;
  isSending: boolean;
  hasEntries: boolean;
  brushSize: 'S' | 'M' | 'L';
  onBrushSizeChange: (s: 'S' | 'M' | 'L') => void;
  // Text editing (reserved for future)
  textEditing: boolean;
  textColor: string;
  onTextColorChange: (c: string) => void;
  textBgEnabled: boolean;
  onTextBgToggle: () => void;
  onTextDone: () => void;
  onTextCancel: () => void;
}

export { ANNOTATION_COLOR };

export default function AnnotationToolbar({
  activeTool, onToolChange, onUndo, onCancel,
  canUndo, onSend, isSending, hasEntries,
  brushSize, onBrushSizeChange,
}: AnnotationToolbarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canSend = hasEntries || input.trim();

  return (
    <div className="flex-shrink-0 flex flex-col gap-1.5 px-3 pt-2 pb-1.5">
      {/* Row 1: Tools | Sizes | Undo + Close */}
      <div className="flex items-center">
        {/* Tool buttons */}
        <button
          onClick={() => onToolChange('brush')}
          className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
            activeTool === 'brush' ? 'bg-white/12 text-white' : 'text-white/30 hover:text-white/50'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" /></svg>
        </button>
        <button
          onClick={() => onToolChange('rect')}
          className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
            activeTool === 'rect' ? 'bg-white/12 text-white' : 'text-white/30 hover:text-white/50'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
        </button>

        <div className="w-px h-3.5 bg-white/10 mx-1.5" />

        {/* Brush sizes */}
        <div className="flex items-center gap-0.5">
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => onBrushSizeChange(s)}
              className="w-6 h-6 flex items-center justify-center cursor-pointer"
            >
              <div
                className="rounded-full transition-all"
                style={{
                  width: SIZE_LW[s] + 2,
                  height: SIZE_LW[s] + 2,
                  background: brushSize === s ? ANNOTATION_COLOR : 'rgba(255,255,255,0.18)',
                }}
              />
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo + Close */}
        <button onClick={onUndo} disabled={!canUndo} className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-white/35 hover:text-white/55 disabled:opacity-20 cursor-pointer transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
        </button>
        <button onClick={onCancel} className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-white/35 hover:text-white/55 cursor-pointer transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* Row 2: Input + Send */}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && canSend) {
              e.preventDefault();
              onSend(input.trim());
              setInput('');
            }
          }}
          placeholder="告诉 AI 怎么改..."
          disabled={isSending}
          className="flex-1 min-w-0 bg-transparent text-[13px] outline-none border border-white/10 rounded-full leading-normal h-[30px]"
          style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', padding: '0 10px', background: '#111' }}
        />
        <button
          onClick={() => { if (canSend) { onSend(input.trim()); setInput(''); } }}
          disabled={isSending || !canSend}
          className="h-[30px] px-2.5 flex-shrink-0 flex items-center justify-center gap-1 rounded-full transition-all cursor-pointer text-[11px] font-medium"
          style={{
            background: canSend && !isSending ? '#c026d3' : 'rgba(255,255,255,0.06)',
            color: canSend && !isSending ? '#fff' : 'rgba(255,255,255,0.2)',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </svg>
          发送
        </button>
      </div>
    </div>
  );
}
