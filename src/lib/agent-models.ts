export const AGENT_MODEL_IDS = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'grok-4.5',
  'deepseek-v4-pro',
] as const;

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];
export type AgentModelPreference = 'auto' | AgentModelId;
export type AgentModelProvider = 'azure-openai' | 'openrouter' | 'deepseek';
export type AgentCacheStrategy = 'explicit' | 'automatic';
export type AgentReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AgentModelSpec {
  id: AgentModelId;
  provider: AgentModelProvider;
  providerModelId: string;
  billingModelId: string;
  cacheStrategy: AgentCacheStrategy;
  supportsImageInput: boolean;
  defaultReasoningEffort?: AgentReasoningEffort;
}

export const DEFAULT_AGENT_MODEL_ID: AgentModelId = 'gpt-5.6-terra';

export const AGENT_MODEL_SPECS: Record<AgentModelId, AgentModelSpec> = {
  'gpt-5.6-terra': {
    id: 'gpt-5.6-terra',
    provider: 'azure-openai',
    providerModelId: 'gpt-5.6-terra',
    billingModelId: 'gpt-5.6-terra',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
    defaultReasoningEffort: 'medium',
  },
  'gpt-5.6-sol': {
    id: 'gpt-5.6-sol',
    provider: 'azure-openai',
    providerModelId: 'gpt-5.6-sol',
    billingModelId: 'gpt-5.6-sol',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
    defaultReasoningEffort: 'high',
  },
  'gpt-5.6-luna': {
    id: 'gpt-5.6-luna',
    provider: 'azure-openai',
    providerModelId: 'gpt-5.6-luna',
    billingModelId: 'gpt-5.6-luna',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
    defaultReasoningEffort: 'low',
  },
  'grok-4.5': {
    id: 'grok-4.5',
    provider: 'openrouter',
    providerModelId: 'x-ai/grok-4.5',
    billingModelId: 'x-ai/grok-4.5',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
  },
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    providerModelId: 'deepseek-v4-pro',
    billingModelId: 'deepseek/deepseek-v4-pro',
    cacheStrategy: 'automatic',
    supportsImageInput: false,
  },
};

const AGENT_MODEL_ID_SET = new Set<string>(AGENT_MODEL_IDS);

export function isAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === 'string' && AGENT_MODEL_ID_SET.has(value);
}

export function isAgentModelPreference(value: unknown): value is AgentModelPreference {
  return value === 'auto' || isAgentModelId(value);
}

export function normalizeAgentModelPreference(value: unknown): AgentModelPreference {
  return isAgentModelPreference(value) ? value : 'auto';
}

const RETIRED_CLAUDE_PRODUCT_IDS = new Set([
  'sonnet-4.6',
  'sonnet-5',
  'opus-4.8',
]);

function isRetiredClaudeModel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return RETIRED_CLAUDE_PRODUCT_IDS.has(normalized)
    || /^(?:(?:us|eu|ap|global)\.)?anthropic\.claude-(?:sonnet|opus)-/.test(normalized);
}

/**
 * Normalize the public API boundary without keeping Claude as a model option.
 * Old app/CLI clients may still submit a retired Claude id while their cached
 * JavaScript is rolling over; those requests safely move to Auto/Terra. Truly
 * unknown values remain invalid so the server can return 400.
 */
export function normalizeRequestedAgentModelPreference(
  value: unknown,
): AgentModelPreference | undefined | null {
  if (value === undefined) return undefined;
  if (isAgentModelPreference(value)) return value;
  if (isRetiredClaudeModel(value)) return 'auto';
  return null;
}

function matchConfiguredModel(value: string | undefined): AgentModelId | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (isAgentModelId(normalized)) return normalized;

  return AGENT_MODEL_IDS.find((id) => {
    const spec = AGENT_MODEL_SPECS[id];
    return spec.providerModelId.toLowerCase() === normalized
      || spec.billingModelId.toLowerCase() === normalized;
  });
}

export function resolveAgentModelSpec(
  preference: AgentModelPreference | undefined,
  configuredDefault?: string,
): AgentModelSpec {
  const selectedId = preference && preference !== 'auto'
    ? preference
    : matchConfiguredModel(configuredDefault) ?? DEFAULT_AGENT_MODEL_ID;
  return AGENT_MODEL_SPECS[selectedId];
}
