// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
import { getBackend } from '@/lib/models';
import { generateImage } from '@/lib/model-router';
import { ImageProviderRefusalError } from '@/lib/models/image-provider-refusal';
import type { GenerateImageRequest } from '@/lib/models/types';
import sharp from 'sharp';

const primary = vi.fn();
const alternate = vi.fn();
const refusal = () => new ImageProviderRefusalError('openai', 'moderation_blocked', 'private-receipt');
beforeEach(() => {
  primary.mockReset().mockRejectedValue(refusal());
  alternate.mockReset().mockResolvedValue({ image: 'data:image/png;base64,ready', provider: 'openrouter', usage: { modelId: 'google/gemini-nano-banana-2.1', inputTokens: 10, outputTokens: 20, providerCostUsd: 0.036 } });
  vi.mocked(getBackend).mockReset().mockImplementation(id => ({ id, canHandle: () => true, generate: id === 'gemini-2.1' ? alternate : primary }));
});
afterEach(() => vi.restoreAllMocks());
const request = (extra: Partial<GenerateImageRequest> = {}): GenerateImageRequest => ({ prompt: 'Pikachu eating an apple', benignCharacterContent: true, ...extra });

describe('bounded character recovery after an independently assessed harmless request', () => {
  it('delivers only the alternate image/usage after one refusal, preserving every input', async () => {
    const before = vi.fn().mockResolvedValue(true);
    const refs = [{ url: 'https://example.com/ref.png', role: 'preserve this character' }];
    const req = Object.freeze(request({ image: 'https://example.com/base.png', references: refs, aspectRatio: '16:9', imageResolution: '2K', isNsfw: false, beforeImageRecovery: before }));
    const result = await generateImage(req);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(alternate).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledOnce();
    expect(alternate).toHaveBeenCalledWith(expect.objectContaining({ prompt: req.prompt, image: req.image, references: refs, aspectRatio: '16:9', imageResolution: '2K', isNsfw: false }));
    expect(result).toMatchObject({ model: 'gemini-2.1', fallbackUsed: true, usage: { providerCostUsd: 0.036 }, recovery: { providerCode: 'moderation_blocked', rejectedRequestId: 'private-receipt' } });
    expect(result.contentBlocked).toBeUndefined();
    expect(req.isNsfw).toBe(false);
  });

  it.each([undefined, false])('never recovers without the independent benign assessment (%j)', async benignCharacterContent => {
    await expect(generateImage(request({ benignCharacterContent }))).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(alternate).not.toHaveBeenCalled();
  });
  it.each([new Error('timeout'), new Error('content policy message'), null])('never guesses from unknown, generic, or empty results (%j)', async error => {
    if (error) primary.mockRejectedValue(error); else primary.mockResolvedValue({ image: null });
    await expect(generateImage(request())).rejects.toThrow();
    expect(primary).toHaveBeenCalledOnce(); expect(alternate).not.toHaveBeenCalled();
  });
  it.each([
    { background: 'transparent' }, { outputFormat: 'gif', frameCount: 9 }, { outputFormat: 'svg' }, { outputFormat: 'jpeg' },
    { aspectRatio: '5:3' },
    { references: Array.from({ length: 15 }, () => ({ url: 'https://example.com/ref.png', role: 'keep' })) },
  ] as Partial<GenerateImageRequest>[])('never weakens an incompatible contract: %j', async options => {
    await expect(generateImage(request(options))).rejects.toThrow();
    expect(alternate).not.toHaveBeenCalled();
  });
  it.each([undefined, 'auto', 'gpt-image-2.6-flare'])('recovers an allowed model preference with GPT tuning (%j), keeping the original poster brief', async model => {
    const req = request({ model, prompt: 'Mario versus Pikachu poster', imageQuality: 'high', imageReasoningEffort: 'high', aspectRatio: '2:3' });
    const result = await generateImage(req);
    expect(primary).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ imageQuality: 'high', imageReasoningEffort: 'high' }));
    expect(alternate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: req.prompt, aspectRatio: '2:3', imageQuality: undefined, imageReasoningEffort: undefined }));
    expect(result).toMatchObject({ model: 'gemini-2.1', fallbackUsed: true });
    expect(result.adjustments).toContain('Recovery used Nano Banana 2.1 native rendering settings in place of GPT Image quality/reasoning tuning.');
    expect(req.imageQuality).toBe('high');
    expect(req.isNsfw).toBeUndefined();
  });
  it('honours an independently assessed selected-model-only requirement with quality tuning', async () => {
    await expect(generateImage(request({ model: 'gpt-image-2.6-flare', imageQuality: 'high', benignCharacterContent: false }))).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(primary).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: 'gpt-image-2.6-flare', imageQuality: 'high' }));
    expect(alternate).not.toHaveBeenCalled();
  });
  it('still blocks incompatible Auto output contracts even with quality tuning', async () => {
    await expect(generateImage(request({ imageQuality: 'high', background: 'transparent' }))).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(alternate).not.toHaveBeenCalled();
  });
  it('allows an explicit native PNG without changing its output contract', async () => {
    expect((await generateImage(request({ outputFormat: 'png' }))).model).toBe('gemini-2.1');
    expect(alternate).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: undefined }));
  });
  it('losslessly encodes the decoded JPEG pixels as PNG when the provider chooses JPEG', async () => {
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).jpeg().toBuffer();
    alternate.mockResolvedValue({ image: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
    const result = await generateImage(request({ outputFormat: 'png' }));
    expect(result.image).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(result.image!.split(',')[1], 'base64');
    expect(await sharp(png).raw().toBuffer()).toEqual(await sharp(jpeg).raw().toBuffer());
    expect(primary).toHaveBeenCalledOnce(); expect(alternate).toHaveBeenCalledOnce();
  });
  it('does not retry if an alternate image cannot be decoded for PNG conversion', async () => {
    alternate.mockResolvedValue({ image: 'data:image/jpeg;base64,cmVhZHk=' });
    await expect(generateImage(request({ outputFormat: 'png' }))).rejects.toThrow();
    expect(primary).toHaveBeenCalledOnce(); expect(alternate).toHaveBeenCalledOnce();
  });
  it('checks the alternate price/balance and stops without another submission on denial', async () => {
    const before = vi.fn().mockResolvedValue(false);
    await expect(generateImage(request({ beforeImageRecovery: before }))).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(before).toHaveBeenCalledOnce(); expect(alternate).not.toHaveBeenCalled();
  });
  it('never tries a third supplier or repeats a failed alternate', async () => {
    alternate.mockRejectedValue(refusal());
    await expect(generateImage(request())).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(primary).toHaveBeenCalledOnce(); expect(alternate).toHaveBeenCalledOnce();
  });
  it('skips an unavailable alternate', async () => {
    vi.mocked(getBackend).mockImplementation(id => ({ id, canHandle: () => id !== 'gemini-2.1', generate: primary }));
    await expect(generateImage(request())).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(primary).toHaveBeenCalledOnce();
  });
  it.each([true, false, undefined])('never changes an existing NSFW assessment (%j)', async isNsfw => {
    const req = Object.freeze(request({ isNsfw }));
    if (isNsfw) {
      await expect(generateImage(req)).rejects.toThrow();
      expect(getBackend).toHaveBeenCalledExactlyOnceWith('qwen-spicy');
      expect(alternate).not.toHaveBeenCalled();
    } else expect((await generateImage(req)).contentBlocked).toBeUndefined();
    expect(req.isNsfw).toBe(isNsfw);
  });
  it('honours cancellation before either submission and again after asynchronous preflight', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateImage(request({ signal: controller.signal }))).rejects.toThrow();
    expect(primary).not.toHaveBeenCalled();
    const next = new AbortController();
    await expect(generateImage(request({ signal: next.signal, beforeImageRecovery: async () => { next.abort(); return true; } }))).rejects.toThrow();
    expect(primary).toHaveBeenCalledOnce(); expect(alternate).not.toHaveBeenCalled();
  });
  it('does not start recovery when the shared deadline has insufficient time', async () => {
    await expect(generateImage(request({ deadlineMs: Date.now() + 1000 }))).rejects.toBeInstanceOf(ImageProviderRefusalError);
    expect(alternate).not.toHaveBeenCalled();
  });
});
