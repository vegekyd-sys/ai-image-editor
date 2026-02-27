'use client';

import React, { useState, useRef } from 'react';

const COLORS = ['#dc2626', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff'];
const SIZES: ('S' | 'M' | 'L')[] = ['S', 'M', 'L'];
const SIZE_W = { S: 1, M: 3, L: 6 };

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
  // Color & size
  color: string;
  onColorChange: (c: string) => void;
  brushSize: 'S' | 'M' | 'L';
  onBrushSizeChange: (s: 'S' | 'M' | 'L') => void;
  // Text editing mode
  textEditing: boolean;
  textColor: string;
  onTextColorChange: (c: string) => void;
  textBgEnabled: boolean;
  onTextBgToggle: () => void;
  onTextDone: () => void;
  onTextCancel: () => void;
}

const TOOLS: { id: 'brush' | 'rect' | 'text'; label: string; icon: React.ReactNode }[] = [
  {
    id: 'brush', label: '画笔',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" /></svg>,
  },
  {
    id: 'rect', label: '框',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>,
  },
  // TODO: text tool — uncomment when text editing flow is ready
  // {
  //   id: 'text', label: '文字',
  //   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>,
  // },
];

export default function AnnotationToolbar({
  activeTool, onToolChange, onUndo, onClear, onCancel,
  canUndo, onSend, isSending, hasEntries,
  color, onColorChange, brushSize, onBrushSizeChange,
  textEditing, textColor, onTextColorChange, textBgEnabled, onTextBgToggle, onTextDone, onTextCancel,
}: AnnotationToolbarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canSend = hasEntries || input.trim();
  const [panelOpen, setPanelOpen] = useState(false);

  // Text editing mode: show only color row
  if (textEditing) {
    return (
      <div className="flex-shrink-0">
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* T toggle (background on/off) */}
          <button
            onClick={onTextBgToggle}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-[14px] font-bold cursor-pointer ${textBgEnabled ? 'bg-white/15 text-white' : 'text-white/40'}`}
          >
            T
          </button>
          {/* Color dots */}
          <div className="flex items-center gap-2 flex-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onTextColorChange(c)}
                className="w-6 h-6 rounded-full cursor-pointer flex-shrink-0"
                style={{
                  background: c,
                  border: textColor === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: textColor === c ? '0 0 0 1px rgba(255,255,255,0.3)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Normal annotation toolbar
  return (
    <div className="flex-shrink-0">
      {/* Row 1: Short input */}
      <div className="flex items-center gap-2 px-3 py-1.5">
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
          placeholder="描述你想要的修改..."
          disabled={isSending}
          className="flex-1 bg-transparent text-[13px] outline-none border border-white/10 rounded-full leading-normal h-8"
          style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', padding: '0 12px', background: '#161616' }}
        />
        <button
          onClick={() => { if (canSend) { onSend(input.trim()); setInput(''); } }}
          disabled={isSending || !canSend}
          className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full transition-all cursor-pointer"
          style={{
            background: canSend && !isSending ? '#c026d3' : 'rgba(255,255,255,0.08)',
            color: canSend && !isSending ? '#fff' : 'rgba(255,255,255,0.25)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>

      {/* Row 2: Tools + Actions */}
      <div className="flex items-center justify-between px-3 py-1.5 pb-2">
        <div className="flex items-center gap-0.5">
          {TOOLS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => {
                if (activeTool === id) {
                  setPanelOpen(p => !p); // toggle panel on re-click
                } else {
                  onToolChange(id);
                  setPanelOpen(false);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                activeTool === id ? 'bg-fuchsia-500/20 text-fuchsia-400' : 'text-white/50 hover:text-white/70'
              }`}
            >
              {icon}
              <span className="text-[10px] font-medium">{label}</span>
              {activeTool === id && <span className="text-[8px] opacity-50">{panelOpen ? '▲' : '▼'}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={onUndo} disabled={!canUndo} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white/70 disabled:opacity-30 cursor-pointer transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
          <button onClick={onClear} disabled={!canUndo} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white/70 disabled:opacity-30 cursor-pointer transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
          <button onClick={onCancel} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white/70 cursor-pointer transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      {/* Expandable panel */}
      {panelOpen && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {/* Color dots */}
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onColorChange(c)}
                className="w-6 h-6 rounded-full cursor-pointer flex-shrink-0"
                style={{
                  background: c,
                  border: color === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: color === c ? '0 0 0 1px rgba(255,255,255,0.3)' : 'none',
                }}
              />
            ))}
          </div>
          {/* Brush size (only for brush/rect) */}
          {(activeTool === 'brush' || activeTool === 'rect') && (
            <div className="flex items-center gap-3">
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => onBrushSizeChange(s)}
                  className={`flex items-center gap-1.5 cursor-pointer transition-colors ${brushSize === s ? 'text-fuchsia-400' : 'text-white/40'}`}
                >
                  <div className="w-6 flex items-center justify-center">
                    <div className="rounded-full" style={{ width: SIZE_W[s] * 3 + 4, height: SIZE_W[s] * 3 + 4, background: brushSize === s ? '#d946ef' : 'rgba(255,255,255,0.3)' }} />
                  </div>
                  <span className="text-[10px] font-medium">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
