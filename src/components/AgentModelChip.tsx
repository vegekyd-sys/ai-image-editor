'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/lib/i18n';
import { getAgentModels } from '@/lib/model-registry';
import {
  getCodexSubscriptionAgentModelId,
  getCodexSubscriptionAgentModelPreference,
  isCodexSubscriptionAgentModelPreference,
  type AgentModelPreference,
  type GPT56AgentModelId,
} from '@/lib/agent-models';

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

interface SubscriptionUsageState {
  status: 'idle' | 'loading' | 'available' | 'unavailable';
  planType?: string | null;
  weekly?: {
    usedPercent: number;
    remainingPercent: number;
    windowDurationMins: number;
    resetsAt: number;
  } | null;
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
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [subscriptionUsage, setSubscriptionUsage] = useState<SubscriptionUsageState>({ status: 'idle' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const usageRequestedRef = useRef(false);
  const panelId = useId();
  const models = getAgentModels();
  const selectedModelId = isCodexSubscriptionAgentModelPreference(value)
    ? getCodexSubscriptionAgentModelId(value)
    : value;
  const selected = models.find(model => model.id === selectedModelId);
  const label = isCodexSubscriptionAgentModelPreference(value) && selected
    ? `${t(selected.nameKey as Parameters<typeof t>[0])} · ${t('model.codexSubscription.suffix')}`
    : value === 'auto'
    ? `Auto · ${t('model.gpt56Terra.name')} · ${t('model.azureApiBadge')}`
    : selected
      ? `${t(selected.nameKey as Parameters<typeof t>[0])}${selected.id.startsWith('gpt-5.6-') ? ` · ${t('model.azureApiBadge')}` : ''}`
      : value;

  useEffect(() => {
    if (!open || usageRequestedRef.current) return;
    usageRequestedRef.current = true;
    const controller = new AbortController();
    setSubscriptionUsage({ status: 'loading' });
    fetch('/api/agent/subscription-usage', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as {
          available?: boolean;
          planType?: string | null;
          weekly?: SubscriptionUsageState['weekly'];
        };
        if (!payload.available) {
          setSubscriptionUsage({ status: 'unavailable' });
          return;
        }
        setSubscriptionUsage({
          status: response.ok ? 'available' : 'unavailable',
          planType: payload.planType,
          weekly: payload.weekly,
        });
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') {
          setSubscriptionUsage({ status: 'unavailable' });
        } else {
          usageRequestedRef.current = false;
        }
      });
    return () => controller.abort();
  }, [open]);

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

  const standardOptions = models.flatMap((model) => {
    const standard = {
      id: model.id as AgentModelPreference,
      name: t(model.nameKey as Parameters<typeof t>[0]),
      desc: t(model.descKey as Parameters<typeof t>[0]),
      badge: model.id.startsWith('gpt-5.6-') ? t('model.azureApiBadge') : undefined,
    };
    if (!model.id.startsWith('gpt-5.6-')) return [standard];
    const subscriptionId = getCodexSubscriptionAgentModelPreference(
      model.id as GPT56AgentModelId,
    );
    return [
      standard,
      {
        id: subscriptionId,
        name: `${t(model.nameKey as Parameters<typeof t>[0])} · ${t('model.codexSubscription.suffix')}`,
        desc: t('model.codexSubscription.desc'),
        badge: t('model.codexSubscription.badge'),
      },
    ];
  });
  const subscriptionVisible = subscriptionUsage.status !== 'unavailable'
    || isCodexSubscriptionAgentModelPreference(value);
  const options = [
    {
      id: 'auto' as AgentModelPreference,
      name: `Auto · ${t('model.gpt56Terra.name')}`,
      desc: t('model.agentAutoDesc'),
      badge: t('model.azureApiBadge'),
    },
    ...standardOptions.filter(option => (
      subscriptionVisible || !isCodexSubscriptionAgentModelPreference(option.id)
    )),
  ];

  const formatResetTime = (seconds: number) => new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1_000));

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
        aria-label={`${t('model.agentLabel')}: ${label}`}
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
            aria-label={t('model.closeAgentSelector')}
            onClick={() => setOpen(false)}
            onTouchMove={(event) => event.preventDefault()}
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal={position.mobile}
            aria-label={t('model.chooseAgent')}
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
              <span>{t('model.agentLabel')}</span>
            </div>
            <div
              ref={scrollRef}
              className="mkr-create-model-scroll"
              role="radiogroup"
              onTouchMove={(event) => event.stopPropagation()}
            >
              {options.map(model => {
                const active = value === model.id;
                const isCodexSubscription = isCodexSubscriptionAgentModelPreference(model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choose(model.id as AgentModelPreference)}
                    className="mkr-create-model-option"
                    data-active={active}
                    data-agent-provider={isCodexSubscription ? 'codex-subscription' : model.id.startsWith('gpt-5.6-') || model.id === 'auto' ? 'azure-openai' : undefined}
                  >
                    <span className="mkr-create-model-copy">
                      <span className="mkr-create-model-name">
                        {model.name}
                        {model.badge && <span className="mkr-create-model-badge">{model.badge}</span>}
                      </span>
                      <span className="mkr-create-model-desc">{model.desc}</span>
                      {isCodexSubscription && (
                        <span className="mkr-create-model-usage" data-testid="codex-subscription-usage">
                          {subscriptionUsage.status === 'loading' || subscriptionUsage.status === 'idle'
                            ? t('model.codexSubscription.checking')
                            : subscriptionUsage.status === 'available' && subscriptionUsage.weekly
                              ? `${t('model.codexSubscription.remaining', String(Math.round(subscriptionUsage.weekly.remainingPercent)))} · ${t('model.codexSubscription.resetsAt', formatResetTime(subscriptionUsage.weekly.resetsAt))}`
                              : t('model.codexSubscription.usageUnavailable')}
                        </span>
                      )}
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
