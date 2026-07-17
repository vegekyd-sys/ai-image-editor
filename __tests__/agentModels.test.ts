import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_IDS,
  normalizeAgentModelPreference,
  normalizeRequestedAgentModelPreference,
  resolveAgentModelSpec,
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
      'grok-4.5',
      'deepseek-v4-pro',
    ]);
  });

  it('maps explicit product ids to allowlisted provider ids', () => {
    expect(resolveAgentModelSpec('gpt-5.6-sol')).toMatchObject({
      provider: 'azure-openai',
      providerModelId: 'gpt-5.6-sol',
      billingModelId: 'gpt-5.6-sol',
    });
    expect(resolveAgentModelSpec('grok-4.5').providerModelId)
      .toBe('x-ai/grok-4.5');
    expect(resolveAgentModelSpec('deepseek-v4-pro').providerModelId)
      .toBe('deepseek-v4-pro');
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
    delete process.env.AZURE_OPENAI_API_KEY;
    try {
      expect(() => createAgentModelRuntime('gpt-5.6-terra', 'project-a'))
        .toThrow('AZURE_OPENAI_API_KEY is required');
    } finally {
      if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
      else process.env.AZURE_OPENAI_API_KEY = previousKey;
    }
  });

  it('uses the product reasoning default for Azure GPT-5.6 models', () => {
    const previousKey = process.env.AZURE_OPENAI_API_KEY;
    const previousEffort = process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT;
    process.env.AZURE_OPENAI_API_KEY = 'test-key';
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
      const runtime = createAgentModelRuntime('grok-4.5', 'project-a');
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
