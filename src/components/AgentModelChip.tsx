'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/lib/i18n';
import { getAgentModels } from '@/lib/model-registry';
import type { AgentModelPreference } from '@/lib/agent-models';

interface AgentModelChipProps {
  value: AgentModelPreference;
  onChange: (value: AgentModelPreference) => void;
  disabled?: boolean;
}

export default function AgentModelChip({ value, onChange, disabled = false }: AgentModelChipProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const models = getAgentModels();
  const selected = models.find(model => model.id === value);
  const label = value === 'auto'
    ? `Auto · ${t('model.sonnet5.name')}`
    : selected ? t(selected.nameKey as Parameters<typeof t>[0]) : value;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const mobile = window.innerWidth < 640;
    const width = mobile ? Math.min(360, window.innerWidth - 24) : 320;
    const left = mobile
      ? Math.max(12, (window.innerWidth - width) / 2)
      : Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPosition({ left, bottom: Math.max(8, window.innerHeight - rect.top + 8), width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const closeOutside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!triggerRef.current?.contains(node) && !panelRef.current?.contains(node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  const choose = (next: AgentModelPreference) => {
    onChange(next);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="create-agent-model-selector"
        data-current-agent-model={value}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${locale === 'zh' ? 'Agent 模型' : 'Agent model'}: ${label}`}
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); setOpen(current => !current); }}
        style={{
          height: 28,
          maxWidth: 164,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          padding: '0 10px',
          borderRadius: 999,
          border: open || value !== 'auto' ? '0.5px solid rgba(232,121,249,0.30)' : '0.5px solid rgba(255,255,255,0.10)',
          background: open || value !== 'auto' ? 'rgba(217,70,239,0.12)' : 'rgba(255,255,255,0.055)',
          color: open || value !== 'auto' ? 'rgba(240,171,252,0.92)' : 'rgba(255,255,255,0.50)',
          fontSize: 11,
          fontWeight: 650,
          fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ opacity: 0.65 }}><path d="m5 7.5 5 5 5-5H5Z"/></svg>
      </button>

      {open && position && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={locale === 'zh' ? '选择 Agent 模型' : 'Choose agent model'}
          style={{
            position: 'fixed',
            left: position.left,
            bottom: position.bottom,
            width: position.width,
            zIndex: 10000,
            padding: 8,
            borderRadius: 18,
            border: '0.5px solid rgba(255,255,255,0.14)',
            background: 'linear-gradient(145deg, rgba(28,28,34,0.97), rgba(9,9,13,0.98))',
            boxShadow: '0 22px 64px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
            backdropFilter: 'blur(24px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
          }}
        >
          <div style={{ padding: '7px 10px 9px' }}>
            <div style={{ color: 'rgba(255,255,255,0.84)', fontSize: 13, fontWeight: 700 }}>{locale === 'zh' ? 'Agent 模型' : 'Agent model'}</div>
            <div style={{ color: 'rgba(255,255,255,0.34)', fontSize: 11, marginTop: 2 }}>{locale === 'zh' ? '用于新项目的思考与工具调用' : 'Reasoning and tool use for the new project'}</div>
          </div>
          {[{ id: 'auto', name: `Auto · ${t('model.sonnet5.name')}`, desc: locale === 'zh' ? '跟随后端推荐，默认 Sonnet 5' : 'Follow the recommended default, currently Sonnet 5' }, ...models.map(model => ({ id: model.id, name: t(model.nameKey as Parameters<typeof t>[0]), desc: t(model.descKey as Parameters<typeof t>[0]) }))].map(model => {
            const active = value === model.id;
            return (
              <button
                key={model.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(model.id as AgentModelPreference)}
                style={{
                  width: '100%',
                  minHeight: 52,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: 12,
                  background: active ? 'rgba(217,70,239,0.12)' : 'transparent',
                  color: 'inherit',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: active ? 'rgba(240,171,252,0.98)' : 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: 650 }}>{model.name}</span>
                  <span style={{ display: 'block', color: 'rgba(255,255,255,0.36)', fontSize: 10.5, lineHeight: 1.35, marginTop: 2 }}>{model.desc}</span>
                </span>
                <span style={{ width: 15, height: 15, borderRadius: 999, border: active ? '4px solid #d946ef' : '1px solid rgba(255,255,255,0.20)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
