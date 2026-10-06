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
    })).toEqual(['gpt-image-2.5-flare']);

    expect(resolveModelChain({
      prompt: 'a sticker',
      model: 'gemini',
      background: 'transparent',
    })).toEqual(['gpt-image-2.5-flare']);
  });

  it('attempts only Flare when transparent generation fails', async () => {
    const generate = vi.fn().mockResolvedValue({ image: null });
    mockedGetBackend.mockReturnValue({
      id: 'gpt-image-2.5-flare',
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
    expect(mockedGetBackend).toHaveBeenCalledWith('gpt-image-2.5-flare');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      image: null,
      model: 'gpt-image-2.5-flare',
      fallbackUsed: false,
      failedModels: ['gpt-image-2.5-flare'],
    });
  });

  it('migrates legacy Image 2 calls to paid fal even with subscription context', async () => {
    mockedGetBackend.mockReturnValue({
      id: 'gpt-image-2.5-flare',
      canHandle: () => true,
      generate: vi.fn().mockResolvedValue({
        image: 'data:image/png;base64,cG5n',
        provider: 'fal',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          modelId: 'gpt-image-2.5-flare',
          provider: 'fal',
        },
      }),
    });

    await expect(generateImage({
      prompt: 'A product poster.',
      model: 'openai',
      codexSubscription: { userId: 'allowed-user', projectId: 'project-1' },
    })).resolves.toMatchObject({
      image: 'data:image/png;base64,cG5n',
      model: 'gpt-image-2.5-flare',
      provider: 'fal',
      usage: { provider: 'fal' },
    });
  });
});


describe('Nano Banana 2.1 strict routing', () => {
  it('does not replace default or Lite routing', () => {
    expect(resolveModelChain({ prompt: 'Scene', model: 'gemini-2.1' })).toEqual(['gemini-2.1']);
    expect(resolveModelChain({ prompt: 'Scene' })).toEqual(['gemini', 'qwen-spicy']);
    expect(resolveModelChain({ prompt: 'Scene', model: 'gemini-lite' })).toEqual(['gemini-lite', 'gemini', 'qwen-spicy']);
  });
  it('fails once on an uncertain paid outcome', async () => {
    mockedGetBackend.mockReset();
    const generate = vi.fn().mockRejectedValue(new Error('unknown paid outcome'));
    mockedGetBackend.mockReturnValue({ id: 'gemini-2.1', canHandle: () => true, generate });
    await expect(generateImage({ prompt: 'Scene', model: 'gemini-2.1' })).rejects.toThrow('unknown paid outcome');
    expect(mockedGetBackend).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
