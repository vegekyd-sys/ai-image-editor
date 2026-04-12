'use client';

import React, { useState, useRef } from 'react';
import { compressImageFile } from '@/lib/imageUtils';
import { useLocale } from '@/lib/i18n';
import FloatingPanel from '@/components/FloatingPanel';

export const ANNOTATION_COLOR = '#dc2626';

interface AnnotationToolbarProps {
  activeTool: 'brush' | 'rect' | 'text';
  onToolChange: (tool: 'brush' | 'rect' | 'text') => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onCancel: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSend: (text: string, refImage?: string) => void;
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
  isDesktop: boolean;
}

export default function AnnotationToolbar({
  activeTool, onToolChange, onUndo, onRedo, onCancel,
  canUndo, canRedo, onSend, isSending, hasEntries,
  brushSize, onBrushSizeChange, isDesktop,
}: AnnotationToolbarProps) {
  const { t } = useLocale();
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const canSend = hasEntries || input.trim();

  return (
    <FloatingPanel onClose={onCancel} isDesktop={isDesktop}>
        {/* Hidden file input for reference image */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const compressed = await compressImageFile(file);
            setAttachedImage(compressed);
          }}
        />

        {/* Row 1: Input + Send */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize: reset height then set to scrollHeight
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && canSend) {
                e.preventDefault();
                onSend(input.trim(), attachedImage || undefined);
                setInput('');
                setAttachedImage(null);
                // Reset height after send
                e.currentTarget.style.height = 'auto';
              }
            }}
            placeholder={t('annotation.placeholder')}
            disabled={isSending}
            className="flex-1 min-w-0 bg-transparent text-[15px] outline-none border-none leading-relaxed resize-none overflow-y-auto hide-scrollbar block"
            style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', maxHeight: 'calc(1.625em * 4 + 2px)', padding: 0 }}
          />
          <button
            onClick={() => { if (canSend) { onSend(input.trim(), attachedImage || undefined); setInput(''); setAttachedImage(null); } }}
            disabled={isSending || !canSend}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90 cursor-pointer"
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

        {/* Attached reference image thumbnail */}
        {attachedImage && (
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <div className="relative flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachedImage}
                alt=""
                className="w-9 h-9 rounded-lg object-cover"
                style={{ border: '1px solid rgba(255,255,255,0.12)' }}
              />
              <button
                onClick={() => setAttachedImage(null)}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: 'rgba(20,20,20,0.9)', border: '1px solid rgba(255,255,255,0.18)' }}
              >
                <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="mx-3 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Row 2: Tools + Slider + Undo + Redo */}
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

          {/* 📷 Reference image */}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={isSending}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all active:scale-95"
            style={{
              background: attachedImage ? 'rgba(217,70,239,0.18)' : undefined,
              color: attachedImage ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.30)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>

          {/* Slider — fixed 80px */}
          <input
            type="range"
            min={5}
            max={80}
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            className="annotation-slider"
            style={{ width: 80 }}
          />

          <div className="flex-1" />

          {/* Undo */}
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-white/30 hover:text-white/50 disabled:opacity-20 cursor-pointer transition-colors active:scale-95"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
          {/* Redo */}
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-white/30 hover:text-white/50 disabled:opacity-20 cursor-pointer transition-colors active:scale-95"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
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
    </FloatingPanel>
  );
}
