'use client';

import React, { useState, useRef } from 'react';

export const ANNOTATION_COLOR = '#dc2626';

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
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  textEditing: boolean;
  textColor: string;
  onTextColorChange: (c: string) => void;
  textBgEnabled: boolean;
  onTextBgToggle: () => void;
  onTextDone: () => void;
  onTextCancel: () => void;
}

export default function AnnotationToolbar({
  activeTool, onToolChange, onUndo, onCancel,
  canUndo, onSend, isSending, hasEntries,
  brushSize, onBrushSizeChange,
}: AnnotationToolbarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = hasEntries || input.trim();

  return (
    <div className="px-3 pb-3 pt-1">
      <div
        className="relative rounded-2xl"
        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* × close — top-right */}
        <button
          onClick={onCancel}
          className="absolute top-2.5 right-2.5 w-6 h-6 flex items-center justify-center rounded-full cursor-pointer z-10"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Row 1: Input + Send */}
        <div className="flex items-end gap-2 px-3 pt-3 pb-2 pr-10">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && canSend) {
                e.preventDefault();
                onSend(input.trim());
                setInput('');
              }
            }}
            placeholder="告诉 AI 怎么改..."
            disabled={isSending}
            className="flex-1 min-w-0 bg-transparent text-[15px] outline-none border-none leading-relaxed resize-none overflow-hidden block"
            style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', maxHeight: '5rem', padding: 0 }}
          />
          <button
            onClick={() => { if (canSend) { onSend(input.trim()); setInput(''); } }}
            disabled={isSending || !canSend}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer mb-0.5"
            style={{
              background: canSend && !isSending ? '#c026d3' : 'rgba(255,255,255,0.08)',
              color: canSend && !isSending ? '#fff' : 'rgba(255,255,255,0.25)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div className="mx-3 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Row 2: Tools + Slider + Undo */}
        <div className="flex items-center gap-1.5 px-3 py-2.5">
          {/* Brush */}
          <button
            onClick={() => onToolChange('brush')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
              activeTool === 'brush' ? 'text-white' : 'text-white/30'
            }`}
            style={activeTool === 'brush' ? { background: 'rgba(217,70,239,0.18)' } : {}}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" /></svg>
          </button>
          {/* Rect */}
          <button
            onClick={() => onToolChange('rect')}
            className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
              activeTool === 'rect' ? 'text-white' : 'text-white/30'
            }`}
            style={activeTool === 'rect' ? { background: 'rgba(217,70,239,0.18)' } : {}}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
          </button>

          {/* Slider */}
          <input
            type="range"
            min={5}
            max={80}
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            className="annotation-slider flex-1 mx-1"
          />

          {/* Undo */}
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-white/30 hover:text-white/50 disabled:opacity-20 cursor-pointer transition-colors active:scale-95"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
        </div>
      </div>

      <style>{`
        .annotation-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 2px;
          background: rgba(255,255,255,0.1);
          outline: none;
          cursor: pointer;
        }
        .annotation-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #d946ef;
          border: 2px solid rgba(255,255,255,0.4);
          cursor: pointer;
        }
        .annotation-slider::-webkit-slider-thumb:active {
          transform: scale(1.15);
        }
        .annotation-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #d946ef;
          border: 2px solid rgba(255,255,255,0.4);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
