import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class ContentBlockedError extends Error {} }));

import { resolveModelChain } from '@/lib/model-router';

describe('transparent image routing', () => {
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
});
