import { describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_IDS,
  normalizeAgentModelPreference,
  resolveAgentModelSpec,
} from '@/lib/agent-models';
import { createAgentModelRuntime, getAgentProviderOptions } from '@/lib/agent-model-runtime';

describe('agent model catalog', () => {
  it('exposes the five product model ids in selector order', () => {
    expect(AGENT_MODEL_IDS).toEqual([
      'sonnet-4.6',
      'sonnet-5',
      'opus-4.8',
      'grok-4.5',
      'deepseek-v4-pro',
    ]);
  });

  it('maps explicit product ids to allowlisted provider ids', () => {
    expect(resolveAgentModelSpec('opus-4.8').providerModelId)
      .toBe('us.anthropic.claude-opus-4-8');
    expect(resolveAgentModelSpec('grok-4.5').providerModelId)
      .toBe('x-ai/grok-4.5');
    expect(resolveAgentModelSpec('deepseek-v4-pro').providerModelId)
      .toBe('deepseek-v4-pro');
  });

  it('keeps auto compatible with existing AGENT_MODEL provider ids', () => {
    expect(resolveAgentModelSpec('auto', 'us.anthropic.claude-sonnet-4-6').id)
      .toBe('sonnet-4.6');
    expect(resolveAgentModelSpec(undefined, 'us.anthropic.claude-sonnet-5').id)
      .toBe('sonnet-5');
  });

  it('falls invalid client preferences back to auto', () => {
    expect(normalizeAgentModelPreference('arbitrary/provider-model')).toBe('auto');
  });

  it('marks DeepSeek as text-only so image analysis uses the vision helper', () => {
    expect(resolveAgentModelSpec('deepseek-v4-pro').supportsImageInput).toBe(false);
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

  it('does not leak Anthropic reasoning effort into Grok', () => {
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const previousAnthropicEffort = process.env.AGENT_REASONING_EFFORT;
    const previousOpenRouterEffort = process.env.OPENROUTER_AGENT_REASONING_EFFORT;
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AGENT_REASONING_EFFORT = 'max';
    delete process.env.OPENROUTER_AGENT_REASONING_EFFORT;
    try {
      const runtime = createAgentModelRuntime('grok-4.5', 'project-a');
      expect(getAgentProviderOptions(runtime, { reasoningEffort: 'max' }))
        .toMatchObject({ openrouter: { reasoning: { effort: 'low' } } });
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
