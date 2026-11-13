'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { EditableField } from '@/types';
import { useHorizontalScroll } from '@/hooks/useHorizontalScroll';
import { useLocale } from '@/lib/i18n';
import { ArrowUp, ArrowDown, Trash2, Undo2, Redo2, History, RotateCcw } from 'lucide-react';
import { readDesignEditHistory } from '@/lib/editor/design-edit-history';
import { readDesignLayerState, changeDesignLayer, DESIGN_LAYER_STATE_PROP } from '@/lib/editor/design-layer-state';
import PillCarousel from '@/components/PillCarousel';

interface DesignEditPanelProps {
  editables?: EditableField[];
  props?: Record<string, unknown>;
  onUpdateProp: (key: string, value: unknown) => void;
  onHistorySeek?: (cursor: number) => void;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onStartEdit: (fieldId: string) => void;
  isDesktop?: boolean;
}

export default function DesignEditPanel({
  editables = [],
  props = {},
  selectedFieldId,
  onUpdateProp,
  onHistorySeek,
  onSelectField,
  onStartEdit,
  isDesktop,
}: DesignEditPanelProps) {
  const { t, locale } = useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const history = readDesignEditHistory(props);
  const layerState = readDesignLayerState(editables, props);
  const fields = [...editables].sort((a, b) => layerState.order.indexOf(b.id) - layerState.order.indexOf(a.id)).filter(field => !layerState.deleted.includes(field.id));
  const activeOrder = layerState.order.filter(id => !layerState.deleted.includes(id));
  const selectedIndex = selectedFieldId ? activeOrder.indexOf(selectedFieldId) : -1;
  const changeLayer = (id: string, action: 'forward' | 'backward' | 'delete' | 'restore') => {
    onUpdateProp(DESIGN_LAYER_STATE_PROP, changeDesignLayer(layerState, id, action));
    if (action === 'delete') onSelectField(null);
    if (action === 'restore') onSelectField(id);
  };
  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: PointerEvent) => { if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setHistoryOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [historyOpen]);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { isDragging } = useHorizontalScroll(!!isDesktop);

  const handleCardClick = useCallback((field: EditableField) => {
    if (isDragging) return;
    onSelectField(field.id);
  }, [onSelectField, isDragging]);

  // Scroll selected item into view. The selected item's Edit button expands after
  // selection, so repeat once after the width transition starts.
  useEffect(() => {
    if (!selectedFieldId) return;
    const el = itemRefs.current.get(selectedFieldId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    const timer = window.setTimeout(() => {
      itemRefs.current
        .get(selectedFieldId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [selectedFieldId]);

  const toolbar = (
    <div className="flex items-center gap-1 animate-pop-in">
      <span className="text-[11px] text-white/50 mr-1 whitespace-nowrap">
        {t('design.editables', fields.length)}
      </span>
      <>
        {([
          ['forward', 'design.layerForward', ArrowUp, selectedIndex < 0 || selectedIndex === activeOrder.length - 1],
          ['backward', 'design.layerBackward', ArrowDown, selectedIndex <= 0],
          ['delete', 'design.layerDelete', Trash2, selectedIndex < 0],
        ] as const).map(([action, label, Icon, disabled]) => (
          <button key={action} type="button" title={t(label)} aria-label={t(label)} disabled={disabled}
            onClick={() => selectedFieldId && changeLayer(selectedFieldId, action)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 disabled:opacity-25 disabled:cursor-default">
            <Icon size={16} />
          </button>
        ))}
        <button type="button" title={t('design.layerRestore')} aria-label={t('design.layerRestore')} disabled={!layerState.deleted.length}
          onClick={() => changeLayer(layerState.deleted[layerState.deleted.length - 1], 'restore')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 disabled:opacity-25 disabled:cursor-default">
          <RotateCcw size={16} />
        </button>
      </>
      <span className="h-4 w-px bg-white/15 mx-0.5" />
      <button type="button" title={t('design.undo')} aria-label={t('design.undo')} disabled={!onHistorySeek || history.cursor === 0}
        onClick={() => onHistorySeek?.(history.cursor - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 disabled:opacity-25"><Undo2 size={16} /></button>
      <button type="button" title={t('design.redo')} aria-label={t('design.redo')} disabled={!onHistorySeek || history.cursor === history.entries.length}
        onClick={() => onHistorySeek?.(history.cursor + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 disabled:opacity-25"><Redo2 size={16} /></button>
      <div ref={historyRef} className="relative">
        <button type="button" title={t('design.history')} aria-label={t('design.history')} aria-expanded={historyOpen}
          onClick={() => setHistoryOpen(open => !open)} className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10"><History size={16} /></button>
        {historyOpen && <div role="dialog" aria-label={t('design.history')} className="absolute right-0 bottom-full mb-2 z-50 w-[min(340px,calc(100vw-24px))] max-h-[50vh] overflow-y-auto rounded-xl border border-white/15 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-xl">
          <div className="px-2 py-1 text-xs text-white/60">{t('design.history')}</div>
          {[{ cursor: 0, label: t('design.historyStart'), time: '' }, ...history.entries.map((entry, index) => ({ cursor: index + 1,
            label: `${t(`design.history.${entry.kind}`)}${entry.label ? ` · ${entry.label}` : ''}`,
            time: new Date(entry.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }))].reverse().map(item =>
            <button key={item.cursor} type="button" aria-current={history.cursor === item.cursor ? 'step' : undefined} onClick={() => onHistorySeek?.(item.cursor)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-xs ${history.cursor === item.cursor ? 'bg-pink-400/15 text-pink-200' : 'text-white/70 hover:bg-white/5'}`}>
              <span className="truncate">{item.label}</span><span className="text-white/35 shrink-0">{item.time}</span>
            </button>)}
        </div>}
      </div>
    </div>
  );

  return (
    <PillCarousel toolbar={toolbar} isDesktop={isDesktop}>
      {fields.map((field) => {
        const isSelected = selectedFieldId === field.id;
        const value = String(props[field.propKey] ?? '');
        const canOpenEditor = field.type === 'text' || field.type === 'video';
        const showEditButton = isSelected && canOpenEditor;
        const icon = field.type === 'video' ? '▶' : field.type === 'image' ? '▧' : 'T';
        const valuePreview = field.type === 'video'
          ? t('design.trim')
          : field.type === 'image'
            ? t('design.moveScale')
            : value;

        return (
          <div
            key={field.id}
            ref={(el) => {
              if (el) itemRefs.current.set(field.id, el);
              else itemRefs.current.delete(field.id);
            }}
            className="flex items-stretch flex-shrink-0 animate-tip-in"
          >
            <div
              className={`mkr-liquid-pill flex items-stretch overflow-hidden border transition-all cursor-pointer active:scale-[0.97] ${isDesktop ? 'w-[176px]' : 'w-[200px]'} ${
                isSelected
                  ? showEditButton
                    ? 'border-fuchsia-500 ring-1 ring-fuchsia-500/50 rounded-l-2xl rounded-r-none border-r-0'
                    : 'border-fuchsia-500 ring-1 ring-fuchsia-500/50 rounded-2xl'
                  : 'border-white/10 hover:border-white/20 rounded-2xl'
              }`}
              style={{
                background: isSelected ? 'linear-gradient(145deg, rgba(217,70,239,0.14), rgba(12,12,16,0.46))' : 'linear-gradient(145deg, rgba(217,70,239,0.075), rgba(12,12,16,0.42))',
              }}
              role="button"
              tabIndex={0}
              aria-label={field.label}
              aria-pressed={isSelected}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleCardClick(field); } }}
              onClick={() => handleCardClick(field)}
            >
              <div
                className={`flex-shrink-0 flex items-center justify-center ${isDesktop ? 'w-[64px] h-[64px]' : 'w-[72px] h-[72px]'}`}
                style={{ background: 'rgba(255,255,255,0.045)' }}
              >
                <span className="text-white/30 text-[20px]">{icon}</span>
              </div>
              <div className={`flex-1 min-w-0 flex flex-col justify-center ${isDesktop ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}>
                <div className={`text-white font-semibold leading-tight truncate ${isDesktop ? 'text-[12px]' : 'text-[13px]'}`}>
                  {field.label}
                </div>
                <div className={`text-white/50 leading-snug mt-0.5 truncate ${isDesktop ? 'text-[11px]' : 'text-[11px]'}`}>
                  {valuePreview || '\u00A0'}
                </div>
              </div>
            </div>

            <div
              className="overflow-hidden flex-shrink-0"
              style={{
                width: showEditButton ? (isDesktop ? 64 : 72) : 0,
                transition: 'width 0.2s ease-out',
              }}
            >
              {showEditButton && (
                <button
                  onClick={() => onStartEdit(field.id)}
                  className={`mkr-liquid-pill mkr-liquid-side-action ${isDesktop ? 'w-[64px]' : 'w-[72px]'} h-full flex flex-col items-center justify-center gap-1.5 rounded-r-2xl border border-l-0 border-fuchsia-500 active:scale-95 overflow-hidden relative group cursor-pointer`}
                  style={{
                    background: 'linear-gradient(135deg, rgba(217,70,239,0.18) 0%, rgba(192,38,211,0.32) 100%)',
                    transition: 'transform 0.1s',
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(217,70,239,0.12) 0%, rgba(192,38,211,0.22) 100%)',
                      transition: 'opacity 0.2s',
                    }}
                  />
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className="text-fuchsia-300 relative z-10"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                  <span className="text-fuchsia-200 text-[10px] font-semibold tracking-wide leading-tight text-center relative z-10 whitespace-nowrap">
                    {t('design.edit')}
                  </span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </PillCarousel>
  );
}
