import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_IDS,
  CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES,
  defaultsToCodexSubscription,
  getCodexSubscriptionAllowedUserIds,
  isCodexSubscriptionAllowedUser,
  normalizeAgentModelPreference,
  normalizeRequestedAgentModelPreference,
  resolveCodexSubscriptionFallbackProvider,
  resolveGPT56AgentProvider,
  resolveGPT56AgentProviderForUser,
  resolveAgentModelSpec,
  resolveAgentModelSpecForUser,
  shouldRequireAgentCredits,
} from '@/lib/agent-models';
import {
  createAgentModelRuntime,
  createAzureAgentPromptCacheKey,
  getAgentProviderOptions,
} from '@/lib/agent-model-runtime';

describe('agent model catalog', () => {
  it('exposes the five product model ids in selector order', () => {
    expect(AGENT_MODEL_IDS).toEqual([
      'gpt-5.6-terra',
      'gpt-5.6-sol',
      'gpt-5.6-luna',
      'grok-4.6',
      'deepseek-v4-pro',
    ]);
  });

  it('enables provider-native compaction only when a threshold is requested', () => {
    const previousKey = process.env.AZURE_OPENAI_API_KEY;
    const previousProvider = process.env.GPT56_AGENT_PROVIDER;
    process.env.AZURE_OPENAI_API_KEY = 'test-key';
    process.env.GPT56_AGENT_PROVIDER = 'azure-openai';
    try {
      const runtime = createAgentModelRuntime('gpt-5.6-sol', 'project-compact');
      expect(getAgentProviderOptions(runtime, { compactAtTokens: 650_000 }))
        .toMatchObject({
          azure: {
            contextManagement: [{ type: 'compaction', compactThreshold: 650_000 }],
          },
        });
    } finally {
      if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
      else process.env.AZURE_OPENAI_API_KEY = previousKey;
      if (previousProvider === undefined) delete process.env.GPT56_AGENT_PROVIDER;
      else process.env.GPT56_AGENT_PROVIDER = previousProvider;
    }
  });

  it('maps GPT-5.6 product ids to Azure by default', () => {
    expect(resolveAgentModelSpec('gpt-5.6-sol')).toMatchObject({
      provider: 'azure-openai',
      providerModelId: 'gpt-5.6-sol',
      billingModelId: 'gpt-5.6-sol',
    });
    expect(resolveAgentModelSpec('gpt-5.6-terra').providerModelId)
      .toBe('gpt-5.6-terra');
    expect(resolveAgentModelSpec('gpt-5.6-luna').providerModelId)
      .toBe('gpt-5.6-luna');
    expect(resolveAgentModelSpec('grok-4.6').providerModelId)
      .toBe('x-ai/grok-4.6');
    expect(resolveAgentModelSpec('deepseek-v4-pro').providerModelId)
      .toBe('deepseek-v4-pro');
  });

  it('keeps OpenRouter GPT-5.6 routes available as the explicit backup', () => {
    expect(resolveGPT56AgentProvider()).toBe('azure-openai');
    expect(resolveGPT56AgentProvider('openrouter')).toBe('openrouter');
    expect(resolveGPT56AgentProvider('azure')).toBe('azure-openai');
    expect(resolveGPT56AgentProvider('azure-openai')).toBe('azure-openai');
    expect(resolveGPT56AgentProvider('unexpected-provider')).toBe('azure-openai');

    for (const id of ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'] as const) {
      expect(resolveAgentModelSpec(id, undefined, 'openrouter')).toMatchObject({
        id,
        provider: 'openrouter',
        providerModelId: `openai/${id}`,
        billingModelId: `openai/${id}`,
        supportsImageInput: true,
      });
    }
  });

  it('keeps the same product model ids when Codex subscription is selected', () => {
    expect(resolveGPT56AgentProvider('codex')).toBe('codex-subscription');
    expect(resolveGPT56AgentProvider('chatgpt')).toBe('codex-subscription');
    expect(resolveCodexSubscriptionFallbackProvider('openrouter')).toBe('openrouter');
    expect(resolveCodexSubscriptionFallbackProvider('codex-subscription')).toBe('azure-openai');

    for (const id of ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'] as const) {
      expect(resolveAgentModelSpec(id, undefined, 'codex-subscription')).toMatchObject({
        id,
        provider: 'codex-subscription',
        providerModelId: id,
        billingModelId: id,
      });
    }
  });

  it('keeps GPT-5.6 on Azure by default and uses Codex only for explicit plan options', () => {
    const previousOwner = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = 'owner-id';
    try {
      expect(resolveAgentModelSpecForUser(
        'gpt-5.6-terra',
        undefined,
        'owner-id',
        'azure-openai',
      )).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'azure-openai',
      });
      for (const [preference, modelId] of [
        [CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES[0], 'gpt-5.6-terra'],
        [CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES[1], 'gpt-5.6-sol'],
        [CODEX_SUBSCRIPTION_AGENT_MODEL_PREFERENCES[2], 'gpt-5.6-luna'],
      ] as const) {
        expect(resolveAgentModelSpecForUser(
          preference,
          undefined,
          'owner-id',
          'azure-openai',
        )).toMatchObject({
          id: modelId,
          provider: 'codex-subscription',
        });
        expect(normalizeAgentModelPreference(preference)).toBe(preference);
      }
    } finally {
      if (previousOwner === undefined) delete process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
      else process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = previousOwner;
    }
  });

  it('defaults only the configured allowlist Auto route to the Codex subscription', () => {
    const previousOwner = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
    const previousAllowed = process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS;
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = 'owner-id';
    process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = ' test-user-id, second-test-id, test-user-id ';
    try {
      expect([...getCodexSubscriptionAllowedUserIds()].sort()).toEqual([
        'owner-id',
        'second-test-id',
        'test-user-id',
      ]);
      expect(isCodexSubscriptionAllowedUser('test-user-id')).toBe(true);
      expect(defaultsToCodexSubscription(undefined, 'owner-id')).toBe(true);
      expect(defaultsToCodexSubscription('auto', 'owner-id')).toBe(true);
      expect(defaultsToCodexSubscription('auto', 'test-user-id')).toBe(true);
      expect(defaultsToCodexSubscription('gpt-5.6-terra', 'owner-id')).toBe(false);
      expect(defaultsToCodexSubscription('auto', 'someone-else')).toBe(false);

      expect(resolveAgentModelSpecForUser(
        undefined,
        undefined,
        'owner-id',
        'azure-openai',
      )).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'codex-subscription',
      });
      expect(resolveAgentModelSpecForUser(
        'auto',
        undefined,
        'owner-id',
        'azure-openai',
      )).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'codex-subscription',
      });
      expect(resolveAgentModelSpecForUser(
        'gpt-5.6-terra',
        undefined,
        'owner-id',
        'azure-openai',
      )).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'azure-openai',
      });
      expect(resolveAgentModelSpecForUser(
        'auto',
        undefined,
        'test-user-id',
        'azure-openai',
      )).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'codex-subscription',
      });
      expect(resolveAgentModelSpecForUser(
        'auto',
        undefined,
        'someone-else',
        'azure-openai',
      )).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'azure-openai',
      });
    } finally {
      if (previousOwner === undefined) delete process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
      else process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = previousOwner;
      if (previousAllowed === undefined) delete process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS;
      else process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = previousAllowed;
    }
  });

  it('does not require Makaron Agent credits for the owner-funded Codex route', () => {
    expect(shouldRequireAgentCredits('codex-subscription')).toBe(false);
    expect(shouldRequireAgentCredits('azure-openai')).toBe(true);
    expect(shouldRequireAgentCredits('openrouter')).toBe(true);
    expect(shouldRequireAgentCredits('deepseek')).toBe(true);
  });

  it('limits the personal Codex subscription to its owner and explicit allowlist', () => {
    expect(resolveGPT56AgentProviderForUser({
      configuredProvider: 'codex-subscription',
      userId: 'owner-id',
      ownerUserId: 'owner-id',
    })).toBe('codex-subscription');
    expect(resolveGPT56AgentProviderForUser({
      configuredProvider: 'codex-subscription',
      userId: 'database-user-id',
      ownerUserId: 'owner-id',
      dynamicallyAllowed: true,
    })).toBe('codex-subscription');
    expect(resolveGPT56AgentProviderForUser({
      configuredProvider: 'codex-subscription',
      userId: 'test-user-id',
      ownerUserId: 'owner-id',
      allowedUserIds: 'test-user-id',
      dynamicallyAllowed: false,
    })).toBe('azure-openai');
    expect(resolveGPT56AgentProviderForUser({
      configuredProvider: 'codex-subscription',
      userId: 'test-user-id',
      ownerUserId: 'owner-id',
      allowedUserIds: 'test-user-id,second-test-id',
    })).toBe('codex-subscription');
    expect(resolveGPT56AgentProviderForUser({
      configuredProvider: 'codex-subscription',
      userId: 'someone-else',
      ownerUserId: 'owner-id',
      fallbackProvider: 'openrouter',
    })).toBe('openrouter');
    expect(() => resolveGPT56AgentProviderForUser({
      configuredProvider: 'codex-subscription',
      userId: 'owner-id',
      ownerUserId: '',
    })).toThrow('CODEX_SUBSCRIPTION_OWNER_USER_ID is required');
  });

  it('creates a Codex subscription Responses runtime without changing the Agent model', () => {
    const previousOwner = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
    const previousEffort = process.env.CODEX_SUBSCRIPTION_REASONING_EFFORT;
    process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = 'owner-id';
    process.env.CODEX_SUBSCRIPTION_REASONING_EFFORT = 'high';
    try {
      const runtime = createAgentModelRuntime(
        'gpt-5.6-terra',
        'private-project',
        'codex-subscription',
        'owner-id',
      );
      expect(runtime.spec).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'codex-subscription',
        providerModelId: 'gpt-5.6-terra',
      });
      expect(typeof runtime.model === 'string' ? runtime.model : runtime.model.provider)
        .toBe('codex-subscription.responses');
      expect(getAgentProviderOptions(runtime)).toEqual({
        openai: {
          parallelToolCalls: false,
          store: false,
          promptCacheKey: createAzureAgentPromptCacheKey('gpt-5.6-terra', 'private-project'),
          reasoningEffort: 'high',
        },
      });
      expect(resolveAgentModelSpecForUser(
        'gpt-5.6-terra',
        undefined,
        'someone-else',
        'codex-subscription',
      ).provider).toBe('azure-openai');
    } finally {
      if (previousOwner === undefined) delete process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
      else process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = previousOwner;
      if (previousEffort === undefined) delete process.env.CODEX_SUBSCRIPTION_REASONING_EFFORT;
      else process.env.CODEX_SUBSCRIPTION_REASONING_EFFORT = previousEffort;
    }
  });

  it('lets a durable failover override an Azure environment without changing product model', () => {
    const previousAzureKey = process.env.AZURE_OPENAI_API_KEY;
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const previousProvider = process.env.GPT56_AGENT_PROVIDER;
    process.env.AZURE_OPENAI_API_KEY = 'azure-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.GPT56_AGENT_PROVIDER = 'azure-openai';
    try {
      const runtime = createAgentModelRuntime('gpt-5.6-terra', 'project-a', 'openrouter');
      expect(runtime.spec).toMatchObject({
        id: 'gpt-5.6-terra',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-5.6-terra',
      });
    } finally {
      if (previousAzureKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
      else process.env.AZURE_OPENAI_API_KEY = previousAzureKey;
      if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      if (previousProvider === undefined) delete process.env.GPT56_AGENT_PROVIDER;
      else process.env.GPT56_AGENT_PROVIDER = previousProvider;
    }
  });

  it('defaults auto to Terra and ignores retired Claude AGENT_MODEL values', () => {
    expect(resolveAgentModelSpec('auto').id).toBe('gpt-5.6-terra');
    expect(resolveAgentModelSpec('auto', 'gpt-5.6-luna').id).toBe('gpt-5.6-luna');
    expect(resolveAgentModelSpec(undefined, 'us.anthropic.claude-sonnet-5').id)
      .toBe('gpt-5.6-terra');
  });

  it('falls invalid client preferences back to auto', () => {
    expect(normalizeAgentModelPreference('arbitrary/provider-model')).toBe('auto');
  });

  it('migrates retired Grok 4.5 preferences and configured defaults to Grok 4.6', () => {
    expect(normalizeAgentModelPreference('grok-4.5')).toBe('grok-4.6');
    expect(normalizeRequestedAgentModelPreference('grok-4.5')).toBe('grok-4.6');
    expect(normalizeRequestedAgentModelPreference('x-ai/grok-4.5')).toBe('grok-4.6');
    expect(resolveAgentModelSpec('auto', 'grok-4.5').id).toBe('grok-4.6');
    expect(resolveAgentModelSpec('auto', 'x-ai/grok-4.5').id).toBe('grok-4.6');
  });

  it('rolls retired Claude requests to Auto/Terra but still rejects unknown API ids', () => {
    expect(normalizeRequestedAgentModelPreference('sonnet-5')).toBe('auto');
    expect(normalizeRequestedAgentModelPreference('us.anthropic.claude-opus-4-6-v1')).toBe('auto');
    expect(normalizeRequestedAgentModelPreference('arbitrary/provider-model')).toBeNull();
    expect(resolveAgentModelSpec(
      normalizeRequestedAgentModelPreference('sonnet-5') ?? undefined,
    ).id).toBe('gpt-5.6-terra');
  });

  it('marks DeepSeek as text-only so image analysis uses the vision helper', () => {
    expect(resolveAgentModelSpec('deepseek-v4-pro').supportsImageInput).toBe(false);
  });

  it('fails clearly when Azure credentials are missing', () => {
    const previousKey = process.env.AZURE_OPENAI_API_KEY;
    const previousProvider = process.env.GPT56_AGENT_PROVIDER;
    delete process.env.AZURE_OPENAI_API_KEY;
    process.env.GPT56_AGENT_PROVIDER = 'azure-openai';
    try {
      expect(() => createAgentModelRuntime('gpt-5.6-terra', 'project-a'))
        .toThrow('AZURE_OPENAI_API_KEY is required');
    } finally {
      if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
      else process.env.AZURE_OPENAI_API_KEY = previousKey;
      if (previousProvider === undefined) delete process.env.GPT56_AGENT_PROVIDER;
      else process.env.GPT56_AGENT_PROVIDER = previousProvider;
    }
  });

  it('fails clearly when explicit OpenRouter backup credentials are missing', () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousProvider = process.env.GPT56_AGENT_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    process.env.GPT56_AGENT_PROVIDER = 'openrouter';
    try {
      expect(() => createAgentModelRuntime('gpt-5.6-terra', 'project-a'))
        .toThrow('OPENROUTER_API_KEY is required');
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      if (previousProvider === undefined) delete process.env.GPT56_AGENT_PROVIDER;
      else process.env.GPT56_AGENT_PROVIDER = previousProvider;
    }
  });

  it('uses the product reasoning default for Azure GPT-5.6 models', () => {
    const previousKey = process.env.AZURE_OPENAI_API_KEY;
    const previousEffort = process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT;
    const previousProvider = process.env.GPT56_AGENT_PROVIDER;
    process.env.AZURE_OPENAI_API_KEY = 'test-key';
    process.env.GPT56_AGENT_PROVIDER = 'azure-openai';
    delete process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT;
    try {
      const runtime = createAgentModelRuntime('gpt-5.6-terra', 'project-a');
      expect(getAgentProviderOptions(runtime)).toEqual({
        azure: {
          parallelToolCalls: false,
          store: false,
          promptCacheKey: createAzureAgentPromptCacheKey('gpt-5.6-terra', 'project-a'),
          promptCacheOptions: {
            mode: 'implicit',
            ttl: '30m',
          },
          reasoningEffort: 'medium',
        },
      });
    } finally {
      if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
      else process.env.AZURE_OPENAI_API_KEY = previousKey;
      if (previousEffort === undefined) delete process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT;
      else process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT = previousEffort;
      if (previousProvider === undefined) delete process.env.GPT56_AGENT_PROVIDER;
      else process.env.GPT56_AGENT_PROVIDER = previousProvider;
    }
  });

  it('preserves each GPT-5.6 reasoning default on OpenRouter', () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousProvider = process.env.GPT56_AGENT_PROVIDER;
    const previousEffort = process.env.OPENROUTER_AGENT_REASONING_EFFORT;
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.GPT56_AGENT_PROVIDER = 'openrouter';
    delete process.env.OPENROUTER_AGENT_REASONING_EFFORT;
    try {
      expect(getAgentProviderOptions(createAgentModelRuntime('gpt-5.6-terra', 'project-a')))
        .toMatchObject({ openrouter: { reasoning: { effort: 'medium' } } });
      expect(getAgentProviderOptions(createAgentModelRuntime('gpt-5.6-sol', 'project-a')))
        .toMatchObject({ openrouter: { reasoning: { effort: 'high' } } });
      expect(getAgentProviderOptions(createAgentModelRuntime('gpt-5.6-luna', 'project-a')))
        .toMatchObject({ openrouter: { reasoning: { effort: 'low' } } });
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
      if (previousProvider === undefined) delete process.env.GPT56_AGENT_PROVIDER;
      else process.env.GPT56_AGENT_PROVIDER = previousProvider;
      if (previousEffort === undefined) delete process.env.OPENROUTER_AGENT_REASONING_EFFORT;
      else process.env.OPENROUTER_AGENT_REASONING_EFFORT = previousEffort;
    }
  });

  it('uses a stable, project-scoped Azure cache key without exposing the project id', () => {
    const first = createAzureAgentPromptCacheKey('gpt-5.6-terra', 'private-project-id');
    const repeated = createAzureAgentPromptCacheKey('gpt-5.6-terra', 'private-project-id');
    const otherProject = createAzureAgentPromptCacheKey('gpt-5.6-terra', 'other-project-id');
    const otherTier = createAzureAgentPromptCacheKey('gpt-5.6-sol', 'private-project-id');

    expect(first).toBe(repeated);
    expect(first).not.toBe(otherProject);
    expect(first).not.toBe(otherTier);
    expect(first).not.toContain('private-project-id');
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it('fails clearly instead of falling back to an unrelated OpenAI key', () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      expect(() => createAgentModelRuntime('deepseek-v4-pro', 'project-a'))
        .toThrow('DEEPSEEK_API_KEY is required');
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });

  it('keeps Grok on its independent medium default instead of leaking Anthropic effort', () => {
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const previousAnthropicEffort = process.env.AGENT_REASONING_EFFORT;
    const previousOpenRouterEffort = process.env.OPENROUTER_AGENT_REASONING_EFFORT;
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AGENT_REASONING_EFFORT = 'max';
    delete process.env.OPENROUTER_AGENT_REASONING_EFFORT;
    try {
      const runtime = createAgentModelRuntime('grok-4.6', 'project-a');
      expect(getAgentProviderOptions(runtime))
        .toMatchObject({ openrouter: { reasoning: { effort: 'medium' } } });
    } finally {
      if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      if (previousAnthropicEffort === undefined) delete process.env.AGENT_REASONING_EFFORT;
      else process.env.AGENT_REASONING_EFFORT = previousAnthropicEffort;
      if (previousOpenRouterEffort === undefined) delete process.env.OPENROUTER_AGENT_REASONING_EFFORT;
      else process.env.OPENROUTER_AGENT_REASONING_EFFORT = previousOpenRouterEffort;
    }
  });
});
