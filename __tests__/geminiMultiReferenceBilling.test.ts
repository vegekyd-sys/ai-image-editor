// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('@/lib/prompts/enhance.md', () => ({ default: '' }));
vi.mock('@/lib/prompts/creative.md', () => ({ default: '' }));
vi.mock('@/lib/prompts/wild.md', () => ({ default: '' }));
vi.mock('@/lib/prompts/captions.md', () => ({ default: '' }));
const google = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: google }; }, Type: {},
}));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });

async function setup(provider: string) {
  vi.stubEnv('AI_PROVIDER', provider);
  vi.stubEnv('IMAGE_MODEL', 'gemini-3.1-flash-image-preview');
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const request = { image, references: [{ url: image, role: 'second cup' }], prompt: 'Put both cups together.' };
  return { image, request, fetchMock };
}

describe('Gemini multi-reference usage through the real backend', () => {
  it.each(['gemini', 'gemini-lite'])('preserves tokens, routed model and exact supplier cost for %s', async id => {
    const { image, request, fetchMock } = await setup('openrouter');
    fetchMock.mockResolvedValue(Response.json({
      choices: [{ message: { images: [{ image_url: { url: image } }] } }],
      usage: { prompt_tokens: 600, completion_tokens: 1120, cost: 0.042 },
    }));
    const backend = id === 'gemini' ? (await import('@/lib/models/gemini')).geminiBackend
      : (await import('@/lib/models/gemini-lite')).geminiLiteBackend;
    const result = await backend.generate(request);
    expect(result.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.usage).toEqual({ inputTokens: 600, outputTokens: 1120, providerCostUsd: 0.042,
      modelId: id === 'gemini' ? 'google/gemini-3.1-flash-image-preview' : 'google/gemini-3.1-flash-lite-image' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves direct Google usage including charged thinking tokens', async () => {
    const { image, request } = await setup('google');
    google.mockResolvedValue({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] } }] } }],
      usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 1100, thoughtsTokenCount: 20 } });
    const result = await (await import('@/lib/models/gemini')).geminiBackend.generate(request);
    expect(result.usage).toEqual({ inputTokens: 600, outputTokens: 1120, modelId: 'gemini-3.1-flash-image-preview' });
    expect(google).toHaveBeenCalledTimes(1);
  });

  it('keeps Lite on its explicit OpenRouter model even when the default provider is Google', async () => {
    const { image, request, fetchMock } = await setup('google');
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }],
      usage: { prompt_tokens: 50, completion_tokens: 100 } }));
    const result = await (await import('@/lib/models/gemini-lite')).geminiLiteBackend.generate(request);
    expect(result.usage?.modelId).toBe('google/gemini-3.1-flash-lite-image');
    expect(google).not.toHaveBeenCalled();
  });

  it('does not invent zero usage when a provider omits usage', async () => {
    const { image, request, fetchMock } = await setup('openrouter');
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }] }));
    const result = await (await import('@/lib/models/gemini')).geminiBackend.generate(request);
    expect(result.image).toBeTruthy();
    expect(result.usage).toBeUndefined();
  });

  it('retains successful single-image fallback usage', async () => {
    const { image, request, fetchMock } = await setup('openrouter');
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'No image' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { images: [{ image_url: { url: image } }] } }],
        usage: { prompt_tokens: 30, completion_tokens: 120 } }));
    const result = await (await import('@/lib/models/gemini')).geminiBackend.generate(request);
    expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 120 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
