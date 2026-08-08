import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_IMAGE_API_URL,
  OPENROUTER_GPT_IMAGE_2_MODEL,
  buildOpenRouterImageRequest,
  readOpenRouterProviderCost,
  resolveOpenAIImageProvider,
} from '@/lib/models/openai-image-provider';

describe('GPT Image 2 provider routing', () => {
  it('defaults to OpenRouter even when legacy Azure and PiAPI keys are present', () => {
    expect(resolveOpenAIImageProvider({
      AZURE_OPENAI_API_KEY: 'azure-key',
      PIAPI_API_KEY: 'piapi-key',
    })).toBe('openrouter');
    expect(OPENROUTER_GPT_IMAGE_2_MODEL).toBe('openai/gpt-image-2');
    expect(OPENROUTER_IMAGE_API_URL).toBe('https://openrouter.ai/api/v1/images');
  });

  it('uses the dedicated Image API request contract for image editing', () => {
    expect(buildOpenRouterImageRequest({
      prompt: 'add a tiny star',
      image: 'data:image/png;base64,abc',
      references: [{ url: 'https://example.com/reference.jpg', role: 'style' }],
      aspectRatio: '16:9',
    })).toEqual({
      model: 'openai/gpt-image-2',
      prompt: 'add a tiny star',
      n: 1,
      quality: 'low',
      aspect_ratio: '16:9',
      input_references: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        { type: 'image_url', image_url: { url: 'https://example.com/reference.jpg' } },
      ],
    });
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
