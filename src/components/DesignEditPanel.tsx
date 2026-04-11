'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { EditableField } from '@/types';

interface DesignEditPanelProps {
  editables: EditableField[];
  props: Record<string, unknown>;
  onUpdateProp: (key: string, value: string) => void;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  isDesktop?: boolean;
}

export default function DesignEditPanel({
  editables,
  props,
  onUpdateProp,
  selectedFieldId,
  onSelectField,
  isDesktop,
}: DesignEditPanelProps) {
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll selected card into view when canvas overlay selection changes
  useEffect(() => {
    if (!selectedFieldId) return;
    const el = cardRefs.current.get(selectedFieldId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selectedFieldId]);

  // Auto-focus textarea when editing
  useEffect(() => {
    if (editingFieldId && textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editingFieldId]);

  const handleCardClick = useCallback((field: EditableField) => {
    onSelectField(field.id);
    setEditingFieldId(field.id);
  }, [onSelectField]);

  const handleBlur = useCallback(() => {
    setEditingFieldId(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setEditingFieldId(null);
    }
    if (e.key === 'Escape') {
      setEditingFieldId(null);
      onSelectField(null);
    }
  }, [onSelectField]);

  return (
    <div className="w-full">
      {/* Category label row */}
      <div className="flex items-center px-3 pt-1.5 pb-0.5">
        <span className="text-[11px] font-medium" style={{ color: 'rgba(217,70,239,0.7)' }}>
          Editable Fields
        </span>
        <span className="text-[11px] ml-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
          {editables.length}
        </span>
      </div>

      {/* Horizontal scrollable cards */}
      <div
        ref={scrollContainerRef}
        className={`flex items-end gap-2 px-3 pt-1 pb-1.5 overflow-x-auto hide-scrollbar ${isDesktop ? 'min-h-[70px] select-none' : 'min-h-[78px]'}`}
      >
        {editables.map((field) => {
          const isSelected = selectedFieldId === field.id;
          const isEditing = editingFieldId === field.id;
          const value = String(props[field.propKey] ?? '');

          return (
            <div
              key={field.id}
              ref={(el) => {
                if (el) cardRefs.current.set(field.id, el);
                else cardRefs.current.delete(field.id);
              }}
              className="flex-shrink-0 animate-tip-in"
            >
              <div
                onClick={() => handleCardClick(field)}
                className={`${isDesktop ? 'w-[176px]' : 'w-[200px]'} text-left border overflow-hidden cursor-pointer transition-all duration-150 ${
                  isSelected
                    ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50'
                    : 'border-white/10 hover:border-white/20'
                }`}
                style={{
                  borderRadius: 16,
                  background: 'rgba(217,70,239,0.06)',
                }}
              >
                <div className="p-3 flex flex-col gap-1">
                  {/* Field label */}
                  <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {field.label}
                    {field.positionProps && (
                      <span className="ml-1" style={{ color: 'rgba(255,255,255,0.2)' }}>drag</span>
                    )}
                  </span>

                  {/* Value display or textarea */}
                  {isEditing ? (
                    <textarea
                      ref={textareaRef}
                      value={value}
                      onChange={(e) => onUpdateProp(field.propKey, e.target.value)}
                      onBlur={handleBlur}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-transparent text-white text-sm resize-none outline-none"
                      style={{
                        minHeight: 32,
                        maxHeight: 80,
                        lineHeight: '1.4',
                      }}
                      rows={1}
                    />
                  ) : (
                    <span
                      className="text-sm text-white/80 truncate block"
                      style={{ lineHeight: '1.4' }}
                    >
                      {value || '\u00A0'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
