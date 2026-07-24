'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import type { PreferredModel } from './AgentChatView';
import type { VideoModel, VideoResolution } from '@/types';
import { getAgentModels, getImageModels, getVideoModels, type ModelInfo } from '@/lib/model-registry';
import type { AgentModelPreference } from '@/lib/agent-models';
import { useLocale } from '@/lib/i18n';
import { getDefaultVideoModelId, getVideoModelCapability, normalizeVideoResolution } from '@/lib/video-model-capabilities';

interface ModelSelectorProps {
  preferredModel: PreferredModel;
  onModelChange: (model: PreferredModel) => void;
  videoAuto?: boolean;
  onVideoAutoChange?: (auto: boolean) => void;
  videoModel?: VideoModel;
  onVideoModelChange?: (model: VideoModel) => void;
  videoResolution?: VideoResolution;
  onVideoResolutionChange?: (resolution: VideoResolution) => void;
  agentModel?: AgentModelPreference;
  onAgentModelChange?: (model: AgentModelPreference) => void;
  onOpenChange?: (open: boolean) => void;
}

const ROW_HEIGHT = 68;
const PANEL_BODY_HEIGHT = ROW_HEIGHT * 5;
const AUTO_TIPS_FOOTER_HEIGHT = ROW_HEIGHT + 14;
const PANEL_CHROME_HEIGHT = 104;

function ModelIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function AutoToggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      data-testid={testId}
      aria-pressed={on}
      aria-label={label}
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
  testId,
}: {
  model: ModelInfo;
  name: string;
  desc: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      data-testid={testId}
      data-model-id={model.id}
      data-model-category={model.category}
      aria-pressed={selected}
      className={selected && !disabled ? 'mkr-liquid-pill' : ''}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        height: ROW_HEIGHT,
        padding: '0 12px',
        borderRadius: 12,
        border: 'none',
        background: selected && !disabled ? 'linear-gradient(145deg, rgba(232,121,249,0.12), rgba(10,10,14,0.32))' : 'transparent',
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

function ResolutionChips({
  label,
  options,
  selectedVideoResolution,
  onSelect,
}: {
  label: string;
  options: VideoResolution[];
  selectedVideoResolution?: VideoResolution;
  onSelect: (resolution: VideoResolution) => void;
}) {
  return (
    <div style={{ padding: '0 12px 12px 54px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(232,121,249,0.55)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(resolution => {
          const active = selectedVideoResolution === resolution;
          return (
            <button
              key={resolution}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(resolution);
              }}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 8,
                border: `1px solid ${active ? 'rgba(232,121,249,0.52)' : 'rgba(255,255,255,0.09)'}`,
                background: active ? 'rgba(232,121,249,0.14)' : 'rgba(255,255,255,0.04)',
                color: active ? '#e879f9' : 'rgba(255,255,255,0.48)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {resolution.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VideoModelRow({
  model,
  name,
  desc,
  selected,
  onSelect,
  resolutionLabel,
  resolutionOptions,
  selectedVideoResolution,
  onResolutionSelect,
}: {
  model: ModelInfo;
  name: string;
  desc: string;
  selected: boolean;
  onSelect: () => void;
  resolutionLabel: string;
  resolutionOptions: VideoResolution[];
  selectedVideoResolution?: VideoResolution;
  onResolutionSelect?: (resolution: VideoResolution) => void;
}) {
  return (
    <div
      className={selected ? 'mkr-liquid-pill' : ''}
      style={{
        width: '100%',
        borderRadius: 12,
        background: selected ? 'linear-gradient(145deg, rgba(232,121,249,0.12), rgba(10,10,14,0.32))' : 'transparent',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <button
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          height: ROW_HEIGHT,
          padding: '0 12px',
          borderRadius: 12,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
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
            color: selected ? '#e879f9' : 'rgba(255,255,255,0.4)',
          }}
        >
          <ModelIcon size={16} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: selected ? '#e879f9' : 'rgba(255,255,255,0.85)',
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
            border: `2px solid ${selected ? '#c026d3' : 'rgba(255,255,255,0.15)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {selected && (
            <div style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: '#c026d3',
            }} />
          )}
        </div>
      </button>

      {selected && resolutionOptions.length > 0 && onResolutionSelect && (
        <ResolutionChips
          label={resolutionLabel}
          options={resolutionOptions}
          selectedVideoResolution={selectedVideoResolution}
          onSelect={onResolutionSelect}
        />
      )}
    </div>
  );
}

export default function ModelSelector({
  preferredModel,
  onModelChange,
  videoAuto = true,
  onVideoAutoChange,
  videoModel = getDefaultVideoModelId(),
  onVideoModelChange,
  videoResolution = 'auto',
  onVideoResolutionChange,
  agentModel = 'auto',
  onAgentModelChange,
  onOpenChange,
}: ModelSelectorProps) {
  const { t } = useLocale();
  const popoverId = useId();
  const popoverTitleId = `${popoverId}-title`;
  const [open, setOpen] = useState(false);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'agent'>('image');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const didFocusPopoverRef = useRef(false);
  const [popoverPos, setPopoverPos] = useState<{
    bottom: number;
    bodyHeight: number;
    maxHeight: number;
    left?: number;
    right?: number;
  } | null>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [autoTips, setAutoTips] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('mkr_auto_tips') ?? 'auto') !== 'off' : true
  );

  const imageAuto = preferredModel === 'auto';
  const agentAuto = agentModel === 'auto';
  const currentAuto = activeTab === 'image'
    ? imageAuto
    : activeTab === 'video'
      ? videoAuto
      : agentAuto;

  const updateScrollHint = useCallback(() => {
    const el = scrollBodyRef.current;
    if (!el) {
      setCanScrollDown(false);
      return;
    }
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handler);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const updatePopoverPosition = useCallback(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const visualViewportTop = window.visualViewport?.offsetTop ?? 0;
    const isMobile = window.innerWidth < 640;
    // CSS fixed positioning uses the layout viewport. The trigger is already
    // raised above the software keyboard, so visualViewport.height must not be
    // used as the bottom coordinate or the popover falls behind the keyboard.
    const bottom = Math.max(8, window.innerHeight - rect.top + 8);
    const maxHeight = Math.max(0, rect.top - visualViewportTop - 8);
    const bodyHeight = Math.max(0, Math.min(PANEL_BODY_HEIGHT, maxHeight - PANEL_CHROME_HEIGHT));
    if (isMobile) {
      setPopoverPos({ bottom, bodyHeight, maxHeight, left: 12, right: 12 });
      return;
    }

    const panelWidth = 300;
    const spaceRight = window.innerWidth - rect.left;
    const spaceLeft = rect.right;
    if (spaceRight >= panelWidth + 8) {
      setPopoverPos({ bottom, bodyHeight, maxHeight, left: Math.max(8, rect.left) });
    } else if (spaceLeft >= panelWidth + 8) {
      setPopoverPos({ bottom, bodyHeight, maxHeight, right: Math.max(8, window.innerWidth - rect.right) });
    } else {
      setPopoverPos({ bottom, bodyHeight, maxHeight, left: Math.max(8, (window.innerWidth - panelWidth) / 2) });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.visualViewport?.addEventListener('resize', updatePopoverPosition);
    window.visualViewport?.addEventListener('scroll', updatePopoverPosition);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.visualViewport?.removeEventListener('resize', updatePopoverPosition);
      window.visualViewport?.removeEventListener('scroll', updatePopoverPosition);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) {
      didFocusPopoverRef.current = false;
      return;
    }
    if (!popoverPos || didFocusPopoverRef.current) return;
    didFocusPopoverRef.current = true;
    window.requestAnimationFrame(() => {
      document.getElementById(`${popoverId}-tab-${activeTab}`)?.focus();
    });
  }, [activeTab, open, popoverId, popoverPos]);

  const handleAutoToggle = useCallback((on: boolean) => {
    if (activeTab === 'video') {
      onVideoAutoChange?.(on);
      return;
    }
    if (activeTab === 'agent') {
      onAgentModelChange?.(on ? 'auto' : 'gpt-5.6-terra');
      return;
    }
    if (on) {
      onModelChange('auto');
    } else {
      onModelChange('gemini');
    }
  }, [activeTab, onAgentModelChange, onModelChange, onVideoAutoChange]);

  const handleImageSelect = useCallback((id: string) => {
    onModelChange(id as PreferredModel);
  }, [onModelChange]);

  const handleVideoSelect = useCallback((id: string) => {
    onVideoAutoChange?.(false);
    onVideoModelChange?.(id as VideoModel);
    onVideoResolutionChange?.(normalizeVideoResolution(id, 'auto'));
  }, [onVideoAutoChange, onVideoModelChange, onVideoResolutionChange]);

  const handleVideoResolutionSelect = useCallback((resolution: VideoResolution) => {
    onVideoResolutionChange?.(resolution);
  }, [onVideoResolutionChange]);

  const handleAgentSelect = useCallback((id: string) => {
    onAgentModelChange?.(id as AgentModelPreference);
  }, [onAgentModelChange]);

  const handleAutoTipsToggle = useCallback((on: boolean) => {
    setAutoTips(on);
    localStorage.setItem('mkr_auto_tips', on ? 'auto' : 'off');
  }, []);

  const imageModels = getImageModels();
  const videoModels = getVideoModels();
  const agentModels = getAgentModels();
  const models = activeTab === 'image'
    ? imageModels
    : activeTab === 'video'
      ? videoModels
      : agentModels;
  const selectedId = activeTab === 'image'
    ? (imageAuto ? null : preferredModel)
    : activeTab === 'video'
      ? (videoAuto ? null : videoModel)
      : (agentAuto ? null : agentModel);
  const selectedImageModel = imageModels.find(model => model.id === preferredModel);
  const selectedImageLabel = selectedImageModel
    ? t(selectedImageModel.nameKey as Parameters<typeof t>[0])
    : preferredModel;
  const selectedAgentModel = agentModels.find(model => model.id === agentModel);
  const selectedAgentLabel = selectedAgentModel
    ? t(selectedAgentModel.nameKey as Parameters<typeof t>[0])
    : agentModel;
  const selectedVideoCapability = getVideoModelCapability(videoModel);
  const selectedVideoResolution = videoResolution === 'auto'
    ? selectedVideoCapability.defaultResolution
    : normalizeVideoResolution(videoModel, videoResolution);
  const modelLabel = !imageAuto
    ? selectedImageLabel
    : !videoAuto
      ? `${selectedVideoCapability.label} ${String(selectedVideoResolution).toUpperCase()}`
      : !agentAuto
        ? `Agent: ${selectedAgentLabel}`
        : 'auto';
  const hasExplicitModel = !imageAuto || !videoAuto || !agentAuto;
  const resolutionOptions = selectedVideoCapability.supportedResolutions ?? [];

  useEffect(() => {
    const el = scrollBodyRef.current;
    if (el) el.scrollTop = 0;
    window.setTimeout(updateScrollHint, 0);
  }, [activeTab, updateScrollHint]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(updateScrollHint, 0);
  }, [open, activeTab, models.length, selectedId, autoTips, selectedVideoResolution, updateScrollHint]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Trigger icon button */}
      <button
        ref={triggerRef}
        data-testid="model-selector"
        data-current-model={preferredModel}
        data-current-video-model={videoModel}
        data-current-agent-model={agentModel}
        data-video-auto={videoAuto}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        aria-label={`Model: ${modelLabel}. Click to open selector.`}
        onClick={() => setOpen(v => !v)}
        className="mkr-liquid-icon-button w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-95"
        style={{
          background: hasExplicitModel || open
            ? 'linear-gradient(145deg, rgba(217,70,239,0.18), rgba(10,10,14,0.34))'
            : 'linear-gradient(145deg, rgba(255,255,255,0.08), rgba(10,10,14,0.34))',
          border: (hasExplicitModel || open) ? '0.5px solid rgba(232,121,249,0.24)' : '0.5px solid rgba(255,255,255,0.10)',
          color: hasExplicitModel ? 'rgba(217,70,239,0.9)' : open ? 'rgba(240,171,252,0.82)' : 'rgba(255,255,255,0.35)',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </button>

      {/* Popover */}
      {open && popoverPos && typeof document !== 'undefined' && createPortal((
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={popoverTitleId}
          className="mkr-liquid-popover"
          style={{
            position: 'fixed',
            bottom: popoverPos.bottom,
            ...(popoverPos.left != null ? { left: popoverPos.left } : {}),
            ...(popoverPos.right != null ? { right: popoverPos.right } : {}),
            ...(popoverPos.left != null && popoverPos.right != null ? {} : { width: 300 }),
            pointerEvents: 'auto' as const,
            background: 'linear-gradient(145deg, rgba(25,25,31,0.80), rgba(7,7,11,0.66))',
            border: '0.5px solid rgba(255,255,255,0.12)',
            borderRadius: 12,
            boxShadow: '0 22px 60px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.09)',
            backdropFilter: 'blur(24px) saturate(1.35)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.35)',
            zIndex: 500,
            padding: '14px 10px 10px',
            maxHeight: popoverPos.maxHeight,
            overflow: 'hidden',
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
            <span id={popoverTitleId} style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
              {t('model.title')}
            </span>
            <AutoToggle
              on={currentAuto}
              onChange={handleAutoToggle}
              label={t('model.auto')}
              testId={`model-auto-${activeTab}`}
            />
          </div>

          {/* Tabs */}
          <div role="tablist" aria-label={t('model.title')} style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 10,
            padding: 3,
            marginBottom: 10,
            marginLeft: 4,
            marginRight: 4,
          }}>
            {(['image', 'video', 'agent'] as const).map(tab => (
              <button
                key={tab}
                id={`${popoverId}-tab-${tab}`}
                role="tab"
                data-testid={`model-tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={`${popoverId}-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => {
                  const tabs = ['image', 'video', 'agent'] as const;
                  const currentIndex = tabs.indexOf(tab);
                  const nextIndex = event.key === 'ArrowRight'
                    ? (currentIndex + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (currentIndex - 1 + tabs.length) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : currentIndex;
                  if (nextIndex === currentIndex && !['Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const nextTab = tabs[nextIndex];
                  setActiveTab(nextTab);
                  document.getElementById(`${popoverId}-tab-${nextTab}`)?.focus();
                }}
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

          {(['image', 'video', 'agent'] as const).map(panelTab => (
            <div
              key={panelTab}
              id={`${popoverId}-panel-${panelTab}`}
              role="tabpanel"
              aria-labelledby={`${popoverId}-tab-${panelTab}`}
              hidden={activeTab !== panelTab}
              style={{
                position: 'relative',
                height: popoverPos.bodyHeight,
                display: activeTab === panelTab ? 'block' : 'none',
              }}
            >
              {activeTab === panelTab && (<>
            {/* Model list — fixed body height for image/video, with overflow hint. */}
            <div
              ref={scrollBodyRef}
              className="model-selector-scroll"
              onScroll={updateScrollHint}
              style={{
                height: activeTab === 'image'
                  ? Math.max(0, popoverPos.bodyHeight - AUTO_TIPS_FOOTER_HEIGHT)
                  : popoverPos.bodyHeight,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                paddingRight: 2,
                paddingBottom: canScrollDown ? 24 : 0,
              }}
            >
              {models.map(model => {
                if (activeTab === 'video') {
                  return (
                    <VideoModelRow
                      key={model.id}
                      model={model}
                      name={t(model.nameKey as Parameters<typeof t>[0])}
                      desc={t(model.descKey as Parameters<typeof t>[0])}
                      selected={model.id === selectedId}
                      onSelect={() => handleVideoSelect(model.id)}
                      resolutionLabel={t('model.resolution')}
                      resolutionOptions={resolutionOptions}
                      selectedVideoResolution={selectedVideoResolution}
                      onResolutionSelect={handleVideoResolutionSelect}
                    />
                  );
                }
                return (
                  <ModelRow
                    key={model.id}
                    model={model}
                    name={t(model.nameKey as Parameters<typeof t>[0])}
                    desc={t(model.descKey as Parameters<typeof t>[0])}
                    selected={model.id === selectedId}
                    disabled={false}
                    onSelect={() => activeTab === 'agent'
                      ? handleAgentSelect(model.id)
                      : handleImageSelect(model.id)}
                    testId={activeTab === 'agent' ? `agent-model-${model.id}` : undefined}
                  />
                );
              })}
            </div>
            {canScrollDown && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: activeTab === 'image' ? AUTO_TIPS_FOOTER_HEIGHT : 0,
                  height: 36,
                  pointerEvents: 'none',
                  borderBottomLeftRadius: 12,
                  borderBottomRightRadius: 12,
                  background: 'linear-gradient(to bottom, rgba(7,7,11,0), rgba(7,7,11,0.82))',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  paddingBottom: 4,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 10l5 5 5-5" />
                </svg>
              </div>
            )}

            {activeTab === 'image' && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: AUTO_TIPS_FOOTER_HEIGHT,
                  borderTop: '0.5px solid rgba(255,255,255,0.05)',
                  paddingTop: 6,
                  background: 'transparent',
                }}
              >
                <button
                  onClick={() => handleAutoTipsToggle(!autoTips)}
                  className={autoTips ? 'mkr-liquid-pill' : ''}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    height: ROW_HEIGHT,
                    padding: '0 12px',
                    borderRadius: 12,
                    border: 'none',
                    background: autoTips ? 'linear-gradient(145deg, rgba(232,121,249,0.12), rgba(10,10,14,0.32))' : 'transparent',
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
            )}
              </>)}
            </div>
          ))}
        </div>
      ), document.body)}
    </div>
  );
}
