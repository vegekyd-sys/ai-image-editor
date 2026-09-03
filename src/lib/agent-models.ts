export const AGENT_MODEL_IDS = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'grok-4.6',
  'deepseek-v4-pro',
] as const;

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];
export const CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCE = 'gpt-5.6-terra-codex-subscription' as const;
export const CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES = [
  CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCE,
  'gpt-5.6-sol-codex-subscription',
  'gpt-5.6-luna-codex-subscription',
] as const;
export type CodexSubscriptionAgentModelPreference = (typeof CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES)[number];
export const GROK_SUBSCRIPTION_AGENT_MODEL_PREFERENCE = 'grok-4.6-grok-subscription' as const;
export type GrokSubscriptionAgentModelPreference = typeof GROK_SUBSCRIPTION_AGENT_MODEL_PREFERENCE;
export type AgentModelPreference = 'auto' | AgentModelId | CodexSubscriptionAgentModelPreference | GrokSubscriptionAgentModelPreference;
export type AgentModelProvider = 'azure-openai' | 'codex-subscription' | 'grok-subscription' | 'openrouter' | 'deepseek';
export type GPT56ApiProvider = Extract<AgentModelProvider, 'azure-openai' | 'openrouter'>;
export type GPT56AgentProvider = GPT56ApiProvider | 'codex-subscription';
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
export const DEFAULT_GPT56_AGENT_PROVIDER: GPT56AgentProvider = 'azure-openai';

const GPT56_AGENT_MODEL_IDS = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
] as const satisfies readonly AgentModelId[];

export type GPT56AgentModelId = (typeof GPT56_AGENT_MODEL_IDS)[number];

export const GPT56_PROVIDER_MODEL_IDS: Record<
  GPT56AgentModelId,
  Record<GPT56AgentProvider, string>
> = {
  'gpt-5.6-terra': {
    openrouter: 'openai/gpt-5.6-terra',
    'azure-openai': 'gpt-5.6-terra',
    'codex-subscription': 'gpt-5.6-terra',
  },
  'gpt-5.6-sol': {
    openrouter: 'openai/gpt-5.6-sol',
    'azure-openai': 'gpt-5.6-sol',
    'codex-subscription': 'gpt-5.6-sol',
  },
  'gpt-5.6-luna': {
    openrouter: 'openai/gpt-5.6-luna',
    'azure-openai': 'gpt-5.6-luna',
    'codex-subscription': 'gpt-5.6-luna',
  },
};

const GPT56_AGENT_MODEL_ID_SET = new Set<string>(GPT56_AGENT_MODEL_IDS);
const CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCE_SET = new Set<string>(
  CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES,
);

function isGPT56AgentModelId(id: AgentModelId): id is GPT56AgentModelId {
  return GPT56_AGENT_MODEL_ID_SET.has(id);
}

export function isCodexSubscriptionAgentModelPreference(
  value: unknown,
): value is CodexSubscriptionAgentModelPreference {
  return typeof value === 'string'
    && CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCE_SET.has(value);
}

export function isGrokSubscriptionAgentModelPreference(
  value: unknown,
): value is GrokSubscriptionAgentModelPreference {
  return value === GROK_SUBSCRIPTION_AGENT_MODEL_PREFERENCE;
}

export function getCodexSubscriptionAgentModelId(
  preference: CodexSubscriptionAgentModelPreference,
): GPT56AgentModelId {
  return preference.replace(/-codex-subscription$/, '') as GPT56AgentModelId;
}

export function getCodexSubscriptionAgentModelPreference(
  modelId: GPT56AgentModelId,
): CodexSubscriptionAgentModelPreference {
  return `${modelId}-codex-subscription` as CodexSubscriptionAgentModelPreference;
}

export function resolveGPT56AgentProvider(value?: string): GPT56AgentProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'codex' || normalized === 'codex-subscription' || normalized === 'chatgpt') {
    return 'codex-subscription';
  }
  if (normalized === 'openrouter') return 'openrouter';
  if (normalized === 'azure' || normalized === 'azure-openai') return 'azure-openai';
  return DEFAULT_GPT56_AGENT_PROVIDER;
}

export function resolveCodexSubscriptionFallbackProvider(
  value: string | undefined = process.env.CODEX_SUBSCRIPTION_FALLBACK_PROVIDER,
): GPT56ApiProvider {
  return resolveGPT56AgentProvider(value) === 'openrouter'
    ? 'openrouter'
    : 'azure-openai';
}

export function isCodexSubscriptionOwner(
  userId: string | undefined,
  ownerUserId: string | undefined = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID,
): boolean {
  const normalizedOwnerUserId = ownerUserId?.trim();
  return Boolean(normalizedOwnerUserId && userId === normalizedOwnerUserId);
}

export function getCodexSubscriptionAllowedUserIds(
  ownerUserId: string | undefined = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID,
  configuredAllowedUserIds: string | undefined = process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS,
): Set<string> {
  const allowedUserIds = new Set(
    (configuredAllowedUserIds ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const normalizedOwnerUserId = ownerUserId?.trim();
  if (normalizedOwnerUserId) allowedUserIds.add(normalizedOwnerUserId);
  return allowedUserIds;
}

export function isCodexSubscriptionAllowedUser(
  userId: string | undefined,
  ownerUserId: string | undefined = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID,
  configuredAllowedUserIds: string | undefined = process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS,
): boolean {
  return Boolean(userId && getCodexSubscriptionAllowedUserIds(
    ownerUserId,
    configuredAllowedUserIds,
  ).has(userId));
}

export function defaultsToCodexSubscription(
  preference: AgentModelPreference | undefined,
  userId: string | undefined,
  ownerUserId: string | undefined = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID,
  configuredAllowedUserIds: string | undefined = process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS,
  dynamicallyAllowed?: boolean,
): boolean {
  return (preference === undefined || preference === 'auto')
    && (dynamicallyAllowed
      ?? isCodexSubscriptionAllowedUser(userId, ownerUserId, configuredAllowedUserIds));
}

export function shouldRequireAgentCredits(provider: AgentModelProvider): boolean {
  return provider !== 'codex-subscription' && provider !== 'grok-subscription';
}

function isGrokSubscriptionAgentAllowedUser(userId: string | undefined, dynamicallyAllowed?: boolean): boolean {
  if (!userId
    || !process.env.GROK_SUBSCRIPTION_RELAY_URL?.trim()
    || !process.env.GROK_SUBSCRIPTION_RELAY_SECRET?.trim()) {
    return false;
  }
  // Server entry points supply the shared live DB decision. An explicit false
  // must never be overridden by an obsolete environment allowlist.
  if (dynamicallyAllowed !== undefined) return dynamicallyAllowed;
  const allowed = new Set(
    (process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
  const owner = process.env.GROK_SUBSCRIPTION_OWNER_USER_ID?.trim()
    || process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
  if (owner) allowed.add(owner);
  return allowed.has(userId);
}

export function resolveGPT56AgentProviderForUser(options: {
  configuredProvider?: string;
  userId?: string;
  ownerUserId?: string;
  allowedUserIds?: string;
  dynamicallyAllowed?: boolean;
  fallbackProvider?: string;
}): GPT56AgentProvider {
  const provider = resolveGPT56AgentProvider(options.configuredProvider);
  if (provider !== 'codex-subscription') return provider;

  const ownerUserId = (options.ownerUserId ?? process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID)?.trim();
  if (!ownerUserId) {
    throw new Error(
      'CODEX_SUBSCRIPTION_OWNER_USER_ID is required when GPT56_AGENT_PROVIDER=codex-subscription',
    );
  }

  return (options.dynamicallyAllowed
    ?? isCodexSubscriptionAllowedUser(options.userId, ownerUserId, options.allowedUserIds))
    ? 'codex-subscription'
    : resolveCodexSubscriptionFallbackProvider(options.fallbackProvider);
}

export const AGENT_MODEL_SPECS: Record<AgentModelId, AgentModelSpec> = {
  'gpt-5.6-terra': {
    id: 'gpt-5.6-terra',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-5.6-terra',
    billingModelId: 'openai/gpt-5.6-terra',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
    defaultReasoningEffort: 'medium',
  },
  'gpt-5.6-sol': {
    id: 'gpt-5.6-sol',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-5.6-sol',
    billingModelId: 'openai/gpt-5.6-sol',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
    defaultReasoningEffort: 'high',
  },
  'gpt-5.6-luna': {
    id: 'gpt-5.6-luna',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-5.6-luna',
    billingModelId: 'openai/gpt-5.6-luna',
    cacheStrategy: 'automatic',
    supportsImageInput: true,
    defaultReasoningEffort: 'low',
  },
  'grok-4.6': {
    id: 'grok-4.6',
    provider: 'openrouter',
    providerModelId: 'x-ai/grok-4.6',
    billingModelId: 'x-ai/grok-4.6',
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
  return value === 'auto'
    || isCodexSubscriptionAgentModelPreference(value)
    || isGrokSubscriptionAgentModelPreference(value)
    || isAgentModelId(value);
}

const RETIRED_AGENT_MODEL_REPLACEMENTS = new Map<string, AgentModelId>([
  ['grok-4.5', 'grok-4.6'],
  ['x-ai/grok-4.5', 'grok-4.6'],
]);

const RETIRED_AGENT_MODEL_PREFERENCE_REPLACEMENTS = new Map<string, AgentModelPreference>([
  ['grok-4.5-grok-subscription', GROK_SUBSCRIPTION_AGENT_MODEL_PREFERENCE],
]);

function getRetiredAgentModelReplacement(value: unknown): AgentModelId | undefined {
  return typeof value === 'string'
    ? RETIRED_AGENT_MODEL_REPLACEMENTS.get(value.trim().toLowerCase())
    : undefined;
}

export function normalizeAgentModelPreference(value: unknown): AgentModelPreference {
  return isAgentModelPreference(value)
    ? value
    : typeof value === 'string'
      ? RETIRED_AGENT_MODEL_PREFERENCE_REPLACEMENTS.get(value.trim().toLowerCase())
        ?? getRetiredAgentModelReplacement(value)
        ?? 'auto'
      : 'auto';
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
  if (typeof value === 'string') {
    const preferenceReplacement = RETIRED_AGENT_MODEL_PREFERENCE_REPLACEMENTS.get(value.trim().toLowerCase());
    if (preferenceReplacement) return preferenceReplacement;
  }
  const replacement = getRetiredAgentModelReplacement(value);
  if (replacement) return replacement;
  if (isRetiredClaudeModel(value)) return 'auto';
  return null;
}

function matchConfiguredModel(value: string | undefined): AgentModelId | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (isAgentModelId(normalized)) return normalized;
  const replacement = getRetiredAgentModelReplacement(normalized);
  if (replacement) return replacement;

  return AGENT_MODEL_IDS.find((id) => {
    const spec = AGENT_MODEL_SPECS[id];
    return spec.providerModelId.toLowerCase() === normalized
      || spec.billingModelId.toLowerCase() === normalized
      || (isGPT56AgentModelId(id)
        && Object.values(GPT56_PROVIDER_MODEL_IDS[id])
          .some(providerModelId => providerModelId.toLowerCase() === normalized));
  });
}

export function resolveAgentModelSpec(
  preference: AgentModelPreference | undefined,
  configuredDefault?: string,
  configuredGPT56Provider: string | undefined = process.env.GPT56_AGENT_PROVIDER,
): AgentModelSpec {
  const explicitlyUsesCodexSubscription = isCodexSubscriptionAgentModelPreference(preference);
  const explicitlyUsesGrokSubscription = isGrokSubscriptionAgentModelPreference(preference);
  const selectedId = explicitlyUsesCodexSubscription
    ? getCodexSubscriptionAgentModelId(preference)
    : explicitlyUsesGrokSubscription
    ? 'grok-4.6'
    : preference && preference !== 'auto'
    ? preference
    : matchConfiguredModel(configuredDefault) ?? DEFAULT_AGENT_MODEL_ID;
  const baseSpec = AGENT_MODEL_SPECS[selectedId];
  if (explicitlyUsesGrokSubscription) {
    return {
      ...baseSpec,
      provider: 'grok-subscription',
      providerModelId: 'grok-4.6',
      billingModelId: 'grok-4.6',
    };
  }
  if (!isGPT56AgentModelId(selectedId)) return baseSpec;

  const provider = explicitlyUsesCodexSubscription
    ? 'codex-subscription'
    : resolveGPT56AgentProvider(configuredGPT56Provider);
  const providerModelId = GPT56_PROVIDER_MODEL_IDS[selectedId][provider];
  return {
    ...baseSpec,
    provider,
    providerModelId,
    billingModelId: providerModelId,
  };
}

export function resolveAgentModelSpecForUser(
  preference: AgentModelPreference | undefined,
  configuredDefault: string | undefined,
  userId: string | undefined,
  configuredGPT56Provider: string | undefined = process.env.GPT56_AGENT_PROVIDER,
  codexSubscriptionAllowed?: boolean,
): AgentModelSpec {
  const explicitlyUsesGrokSubscription = isGrokSubscriptionAgentModelPreference(preference);
  if (explicitlyUsesGrokSubscription) {
    const selected = resolveAgentModelSpec(preference, configuredDefault, configuredGPT56Provider);
    // Keep the public model preference valid for all clients, but only route
    // allowlisted users through the owner's SuperGrok credential.
    return isGrokSubscriptionAgentAllowedUser(userId, codexSubscriptionAllowed)
      ? selected
      : AGENT_MODEL_SPECS['grok-4.6'];
  }
  const explicitlyUsesCodexSubscription = isCodexSubscriptionAgentModelPreference(preference);
  const ownerUsesCodexByDefault = defaultsToCodexSubscription(
    preference,
    userId,
    undefined,
    undefined,
    codexSubscriptionAllowed,
  );
  const selected = resolveAgentModelSpec(
    preference,
    configuredDefault,
    configuredGPT56Provider,
  );
  if (!isGPT56AgentModelId(selected.id)) return selected;

  const provider = resolveGPT56AgentProviderForUser({
    configuredProvider: explicitlyUsesCodexSubscription || ownerUsesCodexByDefault
      ? 'codex-subscription'
      : configuredGPT56Provider,
    userId,
    dynamicallyAllowed: codexSubscriptionAllowed,
  });
  return resolveAgentModelSpec(selected.id, undefined, provider);
}
