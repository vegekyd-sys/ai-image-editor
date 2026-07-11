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

interface PanelPosition {
  left: number;
  bottom: number;
  width: number;
  maxHeight: number;
  mobile: boolean;
}

function ModelGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

export default function AgentModelChip({ value, onChange, disabled = false }: AgentModelChipProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    const width = mobile ? window.innerWidth - 24 : 320;
    const bottom = Math.max(10, window.innerHeight - rect.top + 10);
    const maxHeight = mobile
      ? Math.max(260, Math.min(window.innerHeight * 0.62, rect.top - 20))
      : Math.max(260, Math.min(480, rect.top - 16));
    const left = mobile
      ? 12
      : Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPosition({ left, bottom, width, maxHeight, mobile });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const rootStyle = document.documentElement.style;
    const previous = {
      bodyOverflow: bodyStyle.overflow,
      rootOverflow: rootStyle.overflow,
      rootOverscrollBehavior: rootStyle.overscrollBehavior,
    };
    bodyStyle.overflow = 'hidden';
    rootStyle.overflow = 'hidden';
    rootStyle.overscrollBehavior = 'none';

    const closeOutside = (event: PointerEvent) => {
      const node = event.target as Node;
      if (!triggerRef.current?.contains(node) && !panelRef.current?.contains(node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const containTouch = (event: TouchEvent) => {
      const target = event.target as Node;
      if (!scrollRef.current?.contains(target)) event.preventDefault();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('touchmove', containTouch, { passive: false });
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('touchmove', containTouch);
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      bodyStyle.overflow = previous.bodyOverflow;
      rootStyle.overflow = previous.rootOverflow;
      rootStyle.overscrollBehavior = previous.rootOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [open, updatePosition]);

  const choose = (next: AgentModelPreference) => {
    onChange(next);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const options = [
    {
      id: 'auto',
      name: `Auto · ${t('model.sonnet5.name')}`,
      desc: locale === 'zh' ? '跟随后端推荐，默认 Sonnet 5' : 'Follow the recommended default, currently Sonnet 5',
    },
    ...models.map(model => ({
      id: model.id,
      name: t(model.nameKey as Parameters<typeof t>[0]),
      desc: t(model.descKey as Parameters<typeof t>[0]),
    })),
  ];

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
        title={label}
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); setOpen(current => !current); }}
        className="mkr-create-model-icon"
        data-active={open || value !== 'auto'}
      >
        <ModelGlyph />
      </button>

      {open && position && createPortal(
        <div className="mkr-create-model-layer" aria-hidden="false">
          <button
            type="button"
            className="mkr-create-model-backdrop"
            aria-label={locale === 'zh' ? '关闭模型选择' : 'Close model selector'}
            onClick={() => setOpen(false)}
            onTouchMove={(event) => event.preventDefault()}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal={position.mobile}
            aria-label={locale === 'zh' ? '选择 Agent 模型' : 'Choose agent model'}
            className="mkr-create-model-panel mkr-liquid-popover"
            data-mobile={position.mobile}
            style={{
              left: position.left,
              bottom: position.bottom,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            <div className="mkr-create-model-header">
              <span className="mkr-create-model-header-icon"><ModelGlyph size={15} /></span>
              <span>{locale === 'zh' ? 'Agent 模型' : 'Agent model'}</span>
            </div>
            <div
              ref={scrollRef}
              className="mkr-create-model-scroll"
              role="radiogroup"
              onTouchMove={(event) => event.stopPropagation()}
            >
              {options.map(model => {
                const active = value === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choose(model.id as AgentModelPreference)}
                    className="mkr-create-model-option"
                    data-active={active}
                  >
                    <span className="mkr-create-model-copy">
                      <span className="mkr-create-model-name">{model.name}</span>
                      <span className="mkr-create-model-desc">{model.desc}</span>
                    </span>
                    <span className="mkr-create-model-check" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
