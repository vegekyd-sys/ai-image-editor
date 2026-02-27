'use client';

import React, { useState, useRef, useEffect } from 'react';

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
}

const TOOLS: { id: 'brush' | 'rect' | 'text'; label: string; icon: React.ReactNode }[] = [
  {
    id: 'brush', label: '画笔',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
        <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
      </svg>
    ),
  },
  {
    id: 'rect', label: '框',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  {
    id: 'text', label: '文字',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
];

export default function AnnotationToolbar({
  activeTool, onToolChange, onUndo, onClear, onCancel,
  canUndo, onSend, isSending, hasEntries,
}: AnnotationToolbarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = hasEntries || input.trim();

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  return (
    <div className="flex-shrink-0 bg-gradient-to-t from-black from-70% via-black/95 to-transparent">
      {/* Row 1: Tools + Actions */}
      <div className="flex items-center justify-between px-4 py-2">
        {/* Tool buttons */}
        <div className="flex items-center gap-1">
          {TOOLS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => onToolChange(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTool === id
                  ? 'bg-fuchsia-500/20 text-fuchsia-400'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              {icon}
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white/70 disabled:opacity-30 cursor-pointer transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            onClick={onClear}
            disabled={!canUndo}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white/70 disabled:opacity-30 cursor-pointer transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white/70 cursor-pointer transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Row 2: Input bar */}
      <div className="flex items-end gap-2 px-3 pb-3">
        {/* Input + send */}
        <div className="flex-1 flex items-end rounded-2xl border border-white/10"
          style={{ background: '#161616' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && canSend) {
                e.preventDefault();
                onSend(input.trim());
                setInput('');
              }
            }}
            placeholder="描述你想要的修改..."
            rows={1}
            disabled={isSending}
            className="flex-1 bg-transparent text-[14px] outline-none border-none leading-relaxed resize-none overflow-hidden"
            style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', maxHeight: '5rem', padding: '10px 14px' }}
          />
          <button
            onClick={() => { if (canSend) { onSend(input.trim()); setInput(''); } }}
            disabled={isSending || !canSend}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all m-1.5 cursor-pointer"
            style={{
              background: canSend && !isSending ? '#c026d3' : 'rgba(255,255,255,0.08)',
              color: canSend && !isSending ? '#fff' : 'rgba(255,255,255,0.25)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
