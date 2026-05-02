'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { PreferredModel } from './AgentChatView';
import type { VideoModel } from '@/types';
import { getImageModels, getVideoModels, getModelInfo, type ModelInfo } from '@/lib/model-registry';
import { useLocale } from '@/lib/i18n';

interface ModelSelectorProps {
  preferredModel: PreferredModel;
  onModelChange: (model: PreferredModel) => void;
  videoModel?: VideoModel;
  onVideoModelChange?: (model: VideoModel) => void;
  onOpenChange?: (open: boolean) => void;
}

const ROW_HEIGHT = 68;
const MAX_VISIBLE_ROWS = 3;
const LIST_HEIGHT = ROW_HEIGHT * MAX_VISIBLE_ROWS;

function ModelIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function AutoToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
      <div
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          background: on ? '#c026d3' : 'rgba(255,255,255,0.12)',
          padding: 2,
          transition: 'background 0.2s',
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            background: '#fff',
            transition: 'transform 0.2s',
            transform: on ? 'translateX(16px)' : 'translateX(0)',
          }}
        />
      </div>
    </button>
  );
}

function ModelRow({
  model,
  name,
  desc,
  selected,
  disabled,
  onSelect,
}: {
  model: ModelInfo;
  name: string;
  desc: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        height: ROW_HEIGHT,
        padding: '0 12px',
        borderRadius: 12,
        border: 'none',
        background: selected && !disabled ? 'rgba(232,121,249,0.08)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s',
        textAlign: 'left',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: selected && !disabled ? '#e879f9' : 'rgba(255,255,255,0.4)',
        }}
      >
        <ModelIcon size={16} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: selected && !disabled ? '#e879f9' : 'rgba(255,255,255,0.85)',
          }}>
            {name}
          </span>
          {model.speedLabel && (
            <span style={{
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.35)',
            }}>
              {model.speedLabel}
            </span>
          )}
        </div>
        <div style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.35)',
          marginTop: 1,
          lineHeight: 1.3,
        }}>
          {desc}
        </div>
      </div>

      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          border: `2px solid ${disabled ? 'rgba(255,255,255,0.08)' : selected ? '#c026d3' : 'rgba(255,255,255,0.15)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          opacity: disabled ? 0.4 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {selected && !disabled && (
          <div style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: '#c026d3',
          }} />
        )}
      </div>
    </button>
  );
}

export default function ModelSelector({
  preferredModel,
  onModelChange,
  videoModel = 'kling',
  onVideoModelChange,
  onOpenChange,
}: ModelSelectorProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ bottom: number; left?: number; right?: number } | null>(null);
  const [autoTips, setAutoTips] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('mkr_auto_tips') ?? 'auto') !== 'off' : true
  );

  const isAuto = preferredModel === 'auto';

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const isMobile = window.innerWidth < 640;
      const bottom = window.innerHeight - rect.top + 8;
      if (isMobile) {
        setPopoverPos({ bottom, left: 12, right: 12 });
      } else {
        const panelWidth = 300;
        const spaceRight = window.innerWidth - rect.left;
        const spaceLeft = rect.right;
        if (spaceRight >= panelWidth + 8) {
          setPopoverPos({ bottom, left: Math.max(8, rect.left) });
        } else if (spaceLeft >= panelWidth + 8) {
          setPopoverPos({ bottom, right: Math.max(8, window.innerWidth - rect.right) });
        } else {
          setPopoverPos({ bottom, left: Math.max(8, (window.innerWidth - panelWidth) / 2) });
        }
      }
    }
  }, [open]);

  const handleAutoToggle = useCallback((on: boolean) => {
    if (on) {
      onModelChange('auto');
    } else {
      onModelChange('gemini');
    }
  }, [onModelChange]);

  const handleImageSelect = useCallback((id: string) => {
    onModelChange(id as PreferredModel);
  }, [onModelChange]);

  const handleVideoSelect = useCallback((id: string) => {
    onVideoModelChange?.(id as VideoModel);
  }, [onVideoModelChange]);

  const handleAutoTipsToggle = useCallback((on: boolean) => {
    setAutoTips(on);
    localStorage.setItem('mkr_auto_tips', on ? 'auto' : 'off');
  }, []);

  const imageModels = getImageModels();
  const videoModels = getVideoModels();
  const models = activeTab === 'image' ? imageModels : videoModels;
  const selectedId = activeTab === 'image' ? (isAuto ? null : preferredModel) : videoModel;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Trigger icon button */}
      <button
        ref={triggerRef}
        data-testid="model-selector"
        data-current-model={preferredModel}
        aria-label={`Model: ${preferredModel}. Click to open selector.`}
        onClick={() => setOpen(v => !v)}
        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-95"
        style={{
          background: !isAuto ? 'rgba(192,38,211,0.15)' : open ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
          color: !isAuto ? 'rgba(192,38,211,0.85)' : open ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </button>

      {/* Popover */}
      {open && popoverPos && (
        <div
          style={{
            position: 'fixed',
            bottom: popoverPos.bottom,
            ...(popoverPos.left != null ? { left: popoverPos.left } : {}),
            ...(popoverPos.right != null ? { right: popoverPos.right } : {}),
            ...(popoverPos.left != null && popoverPos.right != null ? {} : { width: 300 }),
            background: '#161616',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            zIndex: 500,
            padding: '14px 10px 10px',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 6px',
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
              {t('model.title')}
            </span>
            <AutoToggle on={isAuto} onChange={handleAutoToggle} label={t('model.auto')} />
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 10,
            padding: 3,
            marginBottom: 10,
            marginLeft: 4,
            marginRight: 4,
          }}>
            {(['image', 'video'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: activeTab === tab ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: activeTab === tab ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {t(`model.tab.${tab}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>

          {/* Model list — fixed height, scroll if > 3 rows */}
          <div style={{
            height: LIST_HEIGHT,
            overflowY: models.length > MAX_VISIBLE_ROWS ? 'auto' : 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
            {models.map(model => (
              <ModelRow
                key={model.id}
                model={model}
                name={t(model.nameKey as Parameters<typeof t>[0])}
                desc={t(model.descKey as Parameters<typeof t>[0])}
                selected={model.id === selectedId}
                disabled={isAuto}
                onSelect={() => {
                  if (activeTab === 'image') {
                    handleImageSelect(model.id);
                  } else {
                    handleVideoSelect(model.id);
                  }
                }}
              />
            ))}
          </div>

          {/* Auto Tips Previews — same style as model rows */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 6, paddingTop: 6 }}>
            <button
              onClick={() => handleAutoTipsToggle(!autoTips)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                height: ROW_HEIGHT,
                padding: '0 12px',
                borderRadius: 12,
                border: 'none',
                background: autoTips ? 'rgba(232,121,249,0.08)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s',
                textAlign: 'left',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                color: autoTips ? '#e879f9' : 'rgba(255,255,255,0.4)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 12h10M12 7v10" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: autoTips ? '#e879f9' : 'rgba(255,255,255,0.85)' }}>
                  {t('model.autoTips')}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1, lineHeight: 1.3 }}>
                  {t('model.autoTips.desc')}
                </div>
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: 9,
                border: `2px solid ${autoTips ? '#c026d3' : 'rgba(255,255,255,0.15)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {autoTips && <div style={{ width: 10, height: 10, borderRadius: 5, background: '#c026d3' }} />}
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
