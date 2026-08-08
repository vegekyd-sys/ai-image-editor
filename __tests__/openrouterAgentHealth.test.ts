import { describe, expect, it } from 'vitest';
import {
  assertOpenRouterGPT56ModelEndpoint,
  resolveOpenRouterAgentHealthRequest,
} from '@/lib/openrouter-agent-health';

describe('OpenRouter GPT-5.6 health contract', () => {
  it('uses the existing OpenRouter key shared with image generation', () => {
    expect(resolveOpenRouterAgentHealthRequest({ OPENROUTER_API_KEY: ' shared-key ' }))
      .toEqual({
        apiKey: 'shared-key',
        authUrl: 'https://openrouter.ai/api/v1/auth/key',
        modelUrls: [
          'https://openrouter.ai/api/v1/models/openai/gpt-5.6-terra/endpoints',
          'https://openrouter.ai/api/v1/models/openai/gpt-5.6-sol/endpoints',
          'https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints',
        ],
      });
    expect(resolveOpenRouterAgentHealthRequest({})).toBeNull();
  });

  it('accepts an exact model endpoint with at least one available provider', () => {
    expect(() => assertOpenRouterGPT56ModelEndpoint({
      data: {
        id: 'openai/gpt-5.6-terra',
        endpoints: [{ provider_name: 'OpenAI' }],
      },
    }, 'openai/gpt-5.6-terra')).not.toThrow();
  });

  it('rejects a missing model or a model with no available endpoint', () => {
    expect(() => assertOpenRouterGPT56ModelEndpoint({
      data: { id: 'openai/gpt-5.6-sol', endpoints: [] },
    }, 'openai/gpt-5.6-sol')).toThrow('openai/gpt-5.6-sol unavailable');
    expect(() => assertOpenRouterGPT56ModelEndpoint({
      data: { id: 'openai/gpt-5.6-terra', endpoints: [{}] },
    }, 'openai/gpt-5.6-luna')).toThrow('openai/gpt-5.6-luna unavailable');
  });
});
