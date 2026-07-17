import { describe, expect, it } from 'vitest';
import {
  assertRequiredGPT56Models,
  isRequiredServiceDown,
  resolveAzureOpenAIModelsRequest,
} from '@/lib/azure-openai-health';

describe('Azure OpenAI health contract', () => {
  it('treats a missing API key as unconfigured and therefore core-down', () => {
    expect(resolveAzureOpenAIModelsRequest({})).toBeNull();
    expect(isRequiredServiceDown('unavailable')).toBe(true);
  });

  it('uses the Responses endpoint origin and accepts all three GPT-5.6 snapshots', () => {
    expect(resolveAzureOpenAIModelsRequest({
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_RESPONSES_URL:
        'https://responses-resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
      AZURE_OPENAI_EDITS_URL:
        'https://edits-resource.openai.azure.com/openai/images/edits?api-version=2025-04-01-preview',
    })).toEqual({
      apiKey: 'test-key',
      url: 'https://responses-resource.openai.azure.com/openai/models?api-version=2024-02-01',
    });

    expect(() => assertRequiredGPT56Models({
      data: [
        { id: 'gpt-5.6-terra-2026-07-09' },
        { id: 'gpt-5.6-sol-2026-07-09' },
        { id: 'gpt-5.6-luna-2026-07-09' },
      ],
    })).not.toThrow();
  });

  it('rejects health when any required GPT-5.6 model is missing', () => {
    expect(() => assertRequiredGPT56Models({
      data: [
        { id: 'gpt-5.6-terra-2026-07-09' },
        { id: 'gpt-5.6-sol-2026-07-09' },
      ],
    })).toThrow('gpt-5.6-luna unavailable');
  });
});
