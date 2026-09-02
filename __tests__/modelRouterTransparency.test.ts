import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class ContentBlockedError extends Error {} }));

import { getBackend } from '@/lib/models';
import { generateImage, resolveModelChain } from '@/lib/model-router';

const mockedGetBackend = vi.mocked(getBackend);

describe('transparent image routing', () => {
  beforeEach(() => {
    mockedGetBackend.mockReset();
  });

  it('routes only to OpenAI and never to an opaque fallback', () => {
    expect(resolveModelChain({
      prompt: 'a sticker',
      background: 'transparent',
    })).toEqual(['openai']);

    expect(resolveModelChain({
      prompt: 'a sticker',
      model: 'gemini',
      background: 'transparent',
    })).toEqual(['openai']);
  });

  it('attempts only OpenAI when transparent generation fails', async () => {
    const generate = vi.fn().mockResolvedValue({ image: null });
    mockedGetBackend.mockReturnValue({
      id: 'openai',
      canHandle: () => true,
      generate,
    });

    const result = await generateImage({
      image: 'https://example.com/source.jpg',
      prompt: 'Cut out the subject.',
      model: 'gemini',
      background: 'transparent',
    });

    expect(mockedGetBackend).toHaveBeenCalledTimes(1);
    expect(mockedGetBackend).toHaveBeenCalledWith('openai');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      image: null,
      model: 'openai',
      fallbackUsed: false,
      failedModels: ['openai'],
    });
  });

  it('preserves the actual subscription provider for billing and provenance', async () => {
    mockedGetBackend.mockReturnValue({
      id: 'openai',
      canHandle: () => true,
      generate: vi.fn().mockResolvedValue({
        image: 'data:image/png;base64,cG5n',
        provider: 'codex-subscription',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          modelId: 'gpt-image-2',
          provider: 'codex-subscription',
        },
      }),
    });

    await expect(generateImage({
      prompt: 'A product poster.',
      model: 'openai',
      codexSubscription: { userId: 'allowed-user', projectId: 'project-1' },
    })).resolves.toMatchObject({
      image: 'data:image/png;base64,cG5n',
      model: 'openai',
      provider: 'codex-subscription',
      usage: { provider: 'codex-subscription' },
    });
  });
});
