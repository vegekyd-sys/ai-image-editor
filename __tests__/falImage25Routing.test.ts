import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class extends Error {} }));
import { getBackend } from '@/lib/models';
import { generateImage, resolveModelChain } from '@/lib/model-router';
import { editImage } from '@/lib/skills/edit-image';

const generate = vi.fn();
beforeEach(() => {
  generate.mockReset();
  vi.mocked(getBackend).mockReset().mockReturnValue({ id: 'gpt-image-2.5-flare', canHandle: () => true, generate });
});

describe('explicit Image 2.5 routing', () => {
  it('preserves Auto and transparent contracts but never switches an explicit Wan call', () => {
    expect(resolveModelChain({ prompt: 'A mug.' })).toEqual(['gemini', 'qwen']);
    expect(resolveModelChain({ prompt: 'Enhance.', image: 'https://example.com/a.jpg', category: 'enhance' })).toEqual(['qwen', 'gemini']);
    expect(resolveModelChain({ prompt: 'Edit.', model: 'gpt-image-2.5-flare', isNsfw: true })).toEqual(['gpt-image-2.5-flare']);
    expect(resolveModelChain({ prompt: 'Cutout.', model: 'gpt-image-2.5-flare', background: 'transparent' })).toEqual(['gpt-image-2.5-flare']);
  });

  it('routes the actual model/provider through the shared skill', async () => {
    generate.mockResolvedValue({ image: 'data:image/jpeg;base64,YQ==', provider: 'fal' });
    const result = await editImage({ editPrompt: 'Edit.', preferredModel: 'gpt-image-2.5-flare' }, { currentImage: 'https://example.com/a.jpg' });
    expect(result).toMatchObject({ success: true, usedModel: 'gpt-image-2.5-flare', provider: 'fal' });
    expect(result.usage).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a null output in the outer edit retry loop', async () => {
    generate.mockResolvedValue({ image: null });
    expect((await editImage({ editPrompt: 'Edit.', preferredModel: 'gpt-image-2.5-flare' }, {})).success).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('surfaces an unknown paid outcome instead of retrying or falling back', async () => {
    generate.mockRejectedValue(new Error('Unknown paid outcome. No retry.'));
    await expect(editImage({ editPrompt: 'Edit.', preferredModel: 'gpt-image-2.5-flare' }, {})).resolves.toMatchObject({ success: false, message: expect.stringContaining('Do not retry automatically') });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(getBackend).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when not configured, without another provider', async () => {
    vi.mocked(getBackend).mockReturnValue({ id: 'gpt-image-2.5-flare', canHandle: () => false, generate });
    await expect(generateImage({ prompt: 'Edit.', model: 'gpt-image-2.5-flare' })).rejects.toThrow('not configured');
    expect(generate).not.toHaveBeenCalled();
  });
});
