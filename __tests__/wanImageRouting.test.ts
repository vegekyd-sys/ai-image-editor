import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class extends Error {} }));
import { getBackend } from '@/lib/models';
import { generateImage, resolveModelChain } from '@/lib/model-router';
import { editImage } from '@/lib/skills/edit-image';

const generate = vi.fn();
beforeEach(() => {
  generate.mockReset();
  vi.mocked(getBackend).mockReset().mockReturnValue({ id: 'wan2.7-image', canHandle: () => true, generate });
});

describe('explicit Wan routing', () => {
  it('preserves Auto and transparent contracts but never switches an explicit Wan call', () => {
    expect(resolveModelChain({ prompt: 'A mug.' })).toEqual(['gemini', 'qwen']);
    expect(resolveModelChain({ prompt: 'Enhance.', image: 'https://example.com/a.jpg', category: 'enhance' })).toEqual(['qwen', 'gemini']);
    expect(resolveModelChain({ prompt: 'Edit.', model: 'wan2.7-image', isNsfw: true })).toEqual(['wan2.7-image']);
    expect(resolveModelChain({ prompt: 'Cutout.', model: 'wan2.7-image', background: 'transparent' })).toEqual(['openai']);
  });

  it('routes the actual model/provider through the shared skill', async () => {
    generate.mockResolvedValue({ image: 'data:image/jpeg;base64,YQ==', provider: 'dashscope' });
    const result = await editImage({ editPrompt: 'Edit.', preferredModel: 'wan2.7-image' }, { currentImage: 'https://example.com/a.jpg' });
    expect(result).toMatchObject({ success: true, usedModel: 'wan2.7-image', provider: 'dashscope' });
    expect(result.usage).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a null output in the outer edit retry loop', async () => {
    generate.mockResolvedValue({ image: null });
    expect((await editImage({ editPrompt: 'Edit.', preferredModel: 'wan2.7-image' }, {})).success).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('surfaces an unknown paid outcome instead of retrying or falling back', async () => {
    generate.mockRejectedValue(new Error('Unknown paid outcome. No retry.'));
    await expect(editImage({ editPrompt: 'Edit.', preferredModel: 'wan2.7-image' }, {})).rejects.toThrow('No retry');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(getBackend).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when not configured, without another provider', async () => {
    vi.mocked(getBackend).mockReturnValue({ id: 'wan2.7-image', canHandle: () => false, generate });
    await expect(generateImage({ prompt: 'Edit.', model: 'wan2.7-image' })).rejects.toThrow('not configured');
    expect(generate).not.toHaveBeenCalled();
  });
});
