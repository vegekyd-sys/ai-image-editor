'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { EditableField } from '@/types';
import FloatingPanel from '@/components/FloatingPanel';

interface DesignTextEditorProps {
  field: EditableField;
  value: string;
  onChangeValue: (value: string) => void;
  onClose: () => void;
  isDesktop: boolean;
}

export default function DesignTextEditor({
  field,
  value,
  onChangeValue,
  onClose,
  isDesktop,
}: DesignTextEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
      // Auto-resize to content
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onClose(); }
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <FloatingPanel onClose={onClose} isDesktop={isDesktop}>
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2">
        {/* Label tag — above the input, not competing for space */}
        <span
          className="self-start px-2 py-0.5 rounded text-[11px] font-medium"
          style={{ background: 'rgba(217,70,239,0.3)', color: 'rgb(217,70,239)' }}
        >
          {field.label}
        </span>

        {/* Input row: full-width input + Done button */}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => {
              onChangeValue(e.target.value);
              // Auto-resize
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 bg-transparent text-white text-[15px] outline-none placeholder-white/20 resize-none"
            style={{ caretColor: '#d946ef', lineHeight: '1.5', minHeight: '1.5em', maxHeight: 'calc(1.5em * 4 + 2px)' }}
            placeholder={`Edit ${field.label}...`}
            rows={1}
          />
          <button
            onClick={onClose}
            className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full cursor-pointer active:scale-90 transition-all mb-0.5"
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
