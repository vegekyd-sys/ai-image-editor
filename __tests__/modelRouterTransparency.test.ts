import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class ContentBlockedError extends Error {} }));

import { NanoBanana21RequestError } from '@/lib/models/nano-banana-21';
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

    await expect(generateImage({
      image: 'https://example.com/source.jpg', prompt: 'Cut out the subject.',
      model: 'gemini', background: 'transparent',
    })).rejects.toThrow('No automatic retry'.toLowerCase());

    expect(mockedGetBackend).toHaveBeenCalledTimes(1);
    expect(mockedGetBackend).toHaveBeenCalledWith('gpt-image-2.5-flare');
    expect(generate).toHaveBeenCalledTimes(1);

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
  it('defaults to Flare while preserving explicit classic and Lite routing', () => {
    expect(resolveModelChain({ prompt: 'Scene', model: 'gemini-2.1' })).toEqual(['gemini-2.1']);
    expect(resolveModelChain({ prompt: 'Scene' })).toEqual(['gpt-image-2.5-flare']);
    expect(resolveModelChain({ prompt: 'Scene', model: 'gemini-lite' })).toEqual(['gemini-lite']);
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


describe('ordinary image defaults and paid fallback boundaries', () => {
  it('retains classic selection and special provider routes', () => {
    expect(resolveModelChain({ prompt: 'Scene', model: 'gemini' })).toEqual(['gemini']);
    expect(resolveModelChain({ prompt: 'Scene', image: 'photo', category: 'enhance' })).toEqual(['gpt-image-2.5-flare']);
    expect(resolveModelChain({ prompt: 'Scene', isNsfw: true })).toEqual(['qwen-spicy']);
    expect(resolveModelChain({ prompt: 'Scene', references: Array.from({length: 4}, () => ({url:'photo',role:'reference'})) })).toEqual(['gpt-image-2.5-flare']);
  });
  it.each([new Error('timeout'), new NanoBanana21RequestError('unknown'), null])('never switches auto models after an unknown outcome', async error => {
    mockedGetBackend.mockReset();
    const generate = error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({image:null});
    mockedGetBackend.mockReturnValue({ id: 'gemini-2.1', canHandle: () => true, generate });
    await expect(generateImage({ prompt: 'Scene' })).rejects.toThrow();
    expect(mockedGetBackend).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('surfaces a definite 2.1 moderation rejection without an automatic model switch', async () => {
    mockedGetBackend.mockReset();
    const nano = vi.fn().mockRejectedValue(new NanoBanana21RequestError('blocked', true));
    mockedGetBackend.mockReturnValue({id:'gemini-2.1',canHandle:()=>true,generate:nano});
    await expect(generateImage({prompt:'Scene',aspectRatio:'8:1'})).rejects.toThrow('blocked');
    expect(mockedGetBackend).toHaveBeenCalledExactlyOnceWith('gemini-2.1');
    expect(nano).toHaveBeenCalledTimes(1);
  });
});
