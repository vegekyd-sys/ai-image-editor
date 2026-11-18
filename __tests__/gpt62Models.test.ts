import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentModelRuntime, getAgentProviderOptions } from '@/lib/agent-model-runtime';
import { getCodexSubscriptionAgentModelPreference, normalizeRequestedAgentModelPreference,
  resolveAgentModelSpecForUser, shouldRequireAgentCredits } from '@/lib/agent-models';

const models = ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra'] as const;
afterEach(() => vi.unstubAllEnvs());

describe('new GPT provider contracts', () => {
  for (const model of models) {
    it(`${model} preserves model identity across direct budget, pinned Azure and subscription authorization`, () => {
      vi.stubEnv('GPT56_AGENT_PROVIDER', 'azure-openai');
      vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'owner');
      const subscription = getCodexSubscriptionAgentModelPreference(model);
      expect(normalizeRequestedAgentModelPreference(model)).toBe(model);
      expect(normalizeRequestedAgentModelPreference(subscription)).toBe(subscription);
      expect(resolveAgentModelSpecForUser(model, undefined, 'user', undefined, false, true))
        .toMatchObject({ id: model, provider: 'openai', providerModelId: model, billingModelId: model });
      expect(resolveAgentModelSpecForUser(model, undefined, 'user', undefined, false, false).provider).toBe('azure-openai');
      expect(resolveAgentModelSpecForUser(model, undefined, 'user', 'azure-openai', false).provider).toBe('azure-openai');
      const plan = resolveAgentModelSpecForUser(subscription, undefined, 'owner', undefined, true, true);
      expect(plan).toMatchObject({ id: model, provider: 'codex-subscription', providerModelId: model });
      expect(shouldRequireAgentCredits(plan.provider)).toBe(false);
      expect(resolveAgentModelSpecForUser(subscription, undefined, 'user', undefined, false, true).provider).toBe('openai');
    });

    for (const provider of ['openai', 'azure-openai', 'codex-subscription', 'openrouter'] as const) {
      it(`${model} / ${provider} rejects minimal and preserves valid reasoning`, () => {
        vi.stubEnv('OPENAI_API_KEY', 'test');
        vi.stubEnv('AZURE_OPENAI_API_KEY', 'test');
        vi.stubEnv('OPENROUTER_API_KEY', 'test');
        vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'owner');
        const effortEnv = { openai: 'OPENAI_AGENT_REASONING_EFFORT', 'azure-openai': 'AZURE_OPENAI_AGENT_REASONING_EFFORT',
          'codex-subscription': 'CODEX_SUBSCRIPTION_REASONING_EFFORT', openrouter: 'OPENROUTER_AGENT_REASONING_EFFORT' }[provider];
        const namespace = provider === 'azure-openai' ? 'azure' : provider === 'openrouter' ? 'openrouter' : 'openai';
        const runtime = createAgentModelRuntime(model, 'model-test', provider, 'owner', true);
        if (typeof runtime.model === 'string') throw new Error('Expected a provider model');
        expect(runtime.model.modelId).toBe(provider === 'openrouter' ? `openai/${model}` : model);
        expect(runtime.model.provider).toContain('responses');
        vi.stubEnv(effortEnv, 'minimal');
        expect(getAgentProviderOptions(runtime)[namespace]).toMatchObject({ forceReasoning: true,
          parallelToolCalls: false, reasoningEffort: model === 'gpt-6.1-terra' ? 'medium' : 'high' });
        vi.stubEnv(effortEnv, 'none');
        expect(getAgentProviderOptions(runtime)[namespace].reasoningEffort).toBe(model === 'gpt-6.1-terra' ? 'none' : 'high');
        vi.stubEnv(effortEnv, 'max');
        expect(getAgentProviderOptions(runtime)[namespace].reasoningEffort).toBe('max');
      });
    }
  }
});
