import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_GPT_IMAGE_2_MODEL,
  readOpenRouterProviderCost,
  resolveOpenAIImageProvider,
} from '@/lib/models/openai-image-provider';

describe('GPT Image 2 provider routing', () => {
  it('defaults to OpenRouter even when legacy Azure and PiAPI keys are present', () => {
    expect(resolveOpenAIImageProvider({
      AZURE_OPENAI_API_KEY: 'azure-key',
      PIAPI_API_KEY: 'piapi-key',
    })).toBe('openrouter');
    expect(OPENROUTER_GPT_IMAGE_2_MODEL).toBe('openai/gpt-5.4-image-2');
  });

  it('keeps Azure and PiAPI available as explicit provider choices', () => {
    expect(resolveOpenAIImageProvider({ OPENAI_IMAGE_PROVIDER: 'azure' })).toBe('azure');
    expect(resolveOpenAIImageProvider({ OPENAI_IMAGE_PROVIDER: 'piapi' })).toBe('piapi');
    expect(resolveOpenAIImageProvider({ OPENAI_IMAGE_PROVIDER: 'openrouter' })).toBe('openrouter');
    expect(resolveOpenAIImageProvider({ OPENAI_IMAGE_PROVIDER: 'typo' })).toBe('openrouter');
  });

  it('accepts only finite non-negative OpenRouter provider cost telemetry', () => {
    expect(readOpenRouterProviderCost({ cost: 0.123 })).toBe(0.123);
    expect(readOpenRouterProviderCost({ cost: 0 })).toBe(0);
    expect(readOpenRouterProviderCost({ cost: -1 })).toBeUndefined();
    expect(readOpenRouterProviderCost({ cost: '0.123' })).toBeUndefined();
  });
});
