export const AGENT_MODEL_IDS = [
  'sonnet-4.6',
  'sonnet-5',
  'opus-4.8',
  'grok-4.5',
  'deepseek-v4-pro',
] as const;

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];
export type AgentModelPreference = 'auto' | AgentModelId;
export type AgentModelProvider = 'bedrock-anthropic' | 'openrouter' | 'deepseek';
export type AgentCacheStrategy = 'explicit' | 'automatic';

export interface AgentModelSpec {
  id: AgentModelId;
  provider: AgentModelProvider;
  providerModelId: string;
  billingModelId: string;
  cacheStrategy: AgentCacheStrategy;
  supportsImageInput: boolean;
}

export const DEFAULT_AGENT_MODEL_ID: AgentModelId = 'sonnet-5';

export const AGENT_MODEL_SPECS: Record<AgentModelId, AgentModelSpec> = {
  'sonnet-4.6': {
    id: 'sonnet-4.6',
    provider: 'bedrock-anthropic',
    providerModelId: 'us.anthropic.claude-sonnet-4-6',
    billingModelId: 'anthropic.claude-sonnet-4-6',
    cacheStrategy: 'explicit',
    supportsImageInput: true,
  },
  'sonnet-5': {
    id: 'sonnet-5',
    provider: 'bedrock-anthropic',
    providerModelId: 'us.anthropic.claude-sonnet-5',
    billingModelId: 'anthropic.claude-sonnet-5',
    cacheStrategy: 'explicit',
    supportsImageInput: true,
  },
  'opus-4.8': {
    id: 'opus-4.8',
    provider: 'bedrock-anthropic',
    providerModelId: 'us.anthropic.claude-opus-4-8',
    billingModelId: 'anthropic.claude-opus-4-8',
    cacheStrategy: 'explicit',
    supportsImageInput: true,
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
