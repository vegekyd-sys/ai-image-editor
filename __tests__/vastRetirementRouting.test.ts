import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class extends Error {} }));
import { getBackend } from '@/lib/models';
import { generateImage, resolveModelChain } from '@/lib/model-router';
import { IMAGE_MODEL_IDS, resolveImageModel } from '@/lib/models/types';
import { editImage } from '@/lib/skills/edit-image';

beforeEach(() => vi.mocked(getBackend).mockReset());

describe('Vast retirement image routing', () => {
  it('offers no Vast-only model ID and maps legacy Qwen to the billed Spicy ID', () => {
    expect(IMAGE_MODEL_IDS).not.toContain('qwen');
    expect(IMAGE_MODEL_IDS).not.toContain('pony');
    expect(IMAGE_MODEL_IDS).not.toContain('wai');
    expect(resolveImageModel('qwen')).toBe('qwen-spicy');
    expect(resolveModelChain({ prompt: 'Edit', model: 'qwen' })).toEqual(['qwen-spicy']);
    expect(() => resolveModelChain({ prompt: 'Anime', model: 'pony' })).toThrow('retired');
    expect(() => resolveModelChain({ prompt: 'Anime', model: 'wai' })).toThrow('retired');
  });

  it('routes NSFW exclusively to Spicy, including explicit legacy/Fal/Gemini selections', () => {
    for (const model of ['qwen', 'pony', 'wai', 'gemini', 'gpt-image-2.5-flare'] as const) {
      expect(resolveModelChain({ prompt: 'Sensitive edit', model, isNsfw: true })).toEqual(['qwen-spicy']);
    }
    expect(() => resolveModelChain({ prompt: 'Cutout', isNsfw: true, background: 'transparent' })).toThrow('not supported');
  });

  it('never repeats a paid NSFW submission after a null result or unknown outcome', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ image: null });
    vi.mocked(getBackend).mockReturnValue({ id: 'qwen-spicy', canHandle: () => true, generate });
    const result = await editImage({ editPrompt: 'Edit', isNsfw: true }, { currentImage: 'https://example.com/a.jpg' });
    expect(result.success).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);

    generate.mockRejectedValueOnce(new Error('Unknown paid outcome'));
    const unknown = await editImage({ editPrompt: 'Edit', isNsfw: true }, { currentImage: 'https://example.com/a.jpg' });
    expect(unknown).toMatchObject({ success: false, message: expect.stringContaining('Do not retry automatically') });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('returns the actual Spicy model for a legacy Qwen request', async () => {
    const generate = vi.fn().mockResolvedValue({ image: 'data:image/jpeg;base64,YQ==', provider: 'mulerouter' });
    vi.mocked(getBackend).mockReturnValue({ id: 'qwen-spicy', canHandle: () => true, generate });
    await expect(generateImage({ prompt: 'Edit', model: 'qwen' })).resolves.toMatchObject({ model: 'qwen-spicy', provider: 'mulerouter' });
  });

  it('does not repeat an auto-fallback paid Spicy request after an unknown outcome', async () => {
    const geminiGenerate = vi.fn().mockResolvedValue({ image: null });
    const spicyGenerate = vi.fn().mockRejectedValue(new Error('provider task completed but output download failed'));
    vi.mocked(getBackend).mockImplementation(id => id === 'gemini'
      ? { id, canHandle: () => true, generate: geminiGenerate }
      : { id: 'qwen-spicy', canHandle: () => true, generate: spicyGenerate });

    const result = await editImage({ editPrompt: 'Creative edit', skill: 'creative' }, { currentImage: 'https://example.com/a.jpg' });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('Do not retry automatically') });
    expect(geminiGenerate).toHaveBeenCalledTimes(1);
    expect(spicyGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an auto-fallback paid Spicy request after a null image', async () => {
    const geminiGenerate = vi.fn().mockResolvedValue({ image: null });
    const spicyGenerate = vi.fn().mockResolvedValue({ image: null });
    vi.mocked(getBackend).mockImplementation(id => id === 'gemini'
      ? { id, canHandle: () => true, generate: geminiGenerate }
      : { id: 'qwen-spicy', canHandle: () => true, generate: spicyGenerate });

    const result = await editImage({ editPrompt: 'Creative edit', skill: 'creative' }, { currentImage: 'https://example.com/a.jpg' });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('Do not retry automatically') });
    expect(spicyGenerate).toHaveBeenCalledTimes(1);
  });
});
