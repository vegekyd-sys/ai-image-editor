'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { EditableField } from '@/types';
import { useHorizontalScroll } from '@/hooks/useHorizontalScroll';

interface DesignEditPanelProps {
  editables: EditableField[];
  props: Record<string, unknown>;
  onUpdateProp: (key: string, value: string) => void;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onStartEdit: (fieldId: string) => void;
  isDesktop?: boolean;
}

export default function DesignEditPanel({
  editables,
  props,
  selectedFieldId,
  onSelectField,
  onStartEdit,
  isDesktop,
}: DesignEditPanelProps) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { scrollRef, isDragging, scrollIntoView, dragHandlers } = useHorizontalScroll(!!isDesktop);

  // Scroll selected card into view
  useEffect(() => {
    if (!selectedFieldId) return;
    const el = cardRefs.current.get(selectedFieldId);
    scrollIntoView(el ?? null);
  }, [selectedFieldId, scrollIntoView]);

  const handleCardClick = useCallback((field: EditableField) => {
    if (isDragging) return; // don't select during drag-scroll
    onSelectField(field.id);
  }, [onSelectField, isDragging]);

  return (
    <div className="flex flex-col w-full">
      {/* Pill carousel (mirrors TipsBar / VideoResultCard layout) */}
      <div
        ref={scrollRef}
        className={`flex items-end gap-2 px-3 pt-2 pb-1.5 overflow-x-auto hide-scrollbar ${isDesktop ? 'min-h-[70px] select-none' : 'min-h-[78px]'}`}
        {...dragHandlers}
      >
        {editables.map((field) => {
          const isSelected = selectedFieldId === field.id;
          const value = String(props[field.propKey] ?? '');
          const showEditButton = isSelected;

          return (
            <div key={field.id} className="flex items-stretch flex-shrink-0">
              <div
                ref={(el) => {
                  if (el) cardRefs.current.set(field.id, el);
                  else cardRefs.current.delete(field.id);
                }}
                className={`flex items-stretch overflow-hidden border transition-all cursor-pointer active:scale-[0.97] ${isDesktop ? 'w-[176px]' : 'w-[200px]'} ${
                  isSelected
                    ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50 rounded-l-2xl rounded-r-none border-r-0'
                    : 'border-white/10 hover:border-white/20 rounded-2xl'
                }`}
                style={{
                  background: isSelected ? 'rgba(217,70,239,0.12)' : 'rgba(217,70,239,0.06)',
                }}
                onClick={() => handleCardClick(field)}
              >
                {/* Icon / type indicator — matches TipsBar thumbnail size */}
                <div
                  className={`flex-shrink-0 flex items-center justify-center bg-white/5 ${isDesktop ? 'w-[64px] h-[64px]' : 'w-[72px] h-[72px]'}`}
                >
                  <span className="text-white/30 text-[20px]">T</span>
                </div>

                {/* Text info */}
                <div className={`flex-1 min-w-0 flex flex-col justify-center ${isDesktop ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}>
                  <div className={`text-white font-semibold leading-tight truncate ${isDesktop ? 'text-[12px]' : 'text-[13px]'}`}>
                    {field.label}
                  </div>
                  <div className={`text-white/50 leading-snug mt-0.5 truncate ${isDesktop ? 'text-[11px]' : 'text-[11px]'}`}>
                    {value || '\u00A0'}
                  </div>
                </div>
              </div>

              {/* Edit button — slides out from right with width animation (like TipsBar commit button) */}
              <div
                className="overflow-hidden flex-shrink-0"
                style={{
                  width: showEditButton ? (isDesktop ? 64 : 72) : 0,
                  transition: 'width 0.2s ease-out',
                }}
              >
                <button
                  onClick={() => onStartEdit(field.id)}
                  className={`${isDesktop ? 'w-[64px]' : 'w-[72px]'} h-full flex flex-col items-center justify-center gap-1.5 rounded-r-2xl border border-l-0 border-fuchsia-500 active:scale-95 overflow-hidden relative group cursor-pointer`}
                  style={{
                    background: 'linear-gradient(135deg, rgba(217,70,239,0.18) 0%, rgba(192,38,211,0.32) 100%)',
                    transition: 'transform 0.1s',
                  }}
                >
                  {/* Hover shimmer */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(217,70,239,0.12) 0%, rgba(192,38,211,0.22) 100%)',
                      transition: 'opacity 0.2s',
                    }}
                  />
                  {/* Pencil icon */}
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className="text-fuchsia-300 relative z-10"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                  {/* Label */}
                  <span className="text-fuchsia-200 text-[10px] font-semibold tracking-wide leading-tight text-center relative z-10 whitespace-nowrap">
                    Edit
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom label row — py-2 matches TipsBar category toolbar and VideoResultCard */}
      <div className="flex items-center justify-center py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={{ color: 'rgba(217,70,239,0.7)' }}>
            Design
          </span>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
            · {editables.length} editable{editables.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
