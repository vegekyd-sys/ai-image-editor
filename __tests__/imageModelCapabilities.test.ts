import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
import { getBackend } from '@/lib/models';
import { generateImage, resolveModelChain } from '@/lib/model-router';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS, type GenerateImageRequest } from '@/lib/models/types';
import { formatImageCapabilitiesForAgent, getImageModelCapability, ImageCapabilityError, listImageModelCapabilities, validateImageModelRequest } from '@/lib/image-model-capabilities';

const refs = (count: number) => Array.from({ length: count }, () => ({ url: 'https://example.com/reference.jpg', role: 'reference' }));
const route = (req: Partial<GenerateImageRequest>) => resolveModelChain({ prompt: 'Preserve the requested artwork.', ...req });

describe('Image Model Capability acceptance matrix', () => {
  it('R21: covers every offered canonical model and generates its Agent contract', () => {
    expect(listImageModelCapabilities().map(c => c.id).sort()).toEqual(IMAGE_MODEL_IDS.filter(id => id !== 'openai').sort());
    expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2.5-flare');
    const guide = formatImageCapabilitiesForAgent();
    for (const c of listImageModelCapabilities()) expect(guide).toContain(c.id);
    expect(guide).toContain('gpt-image-2.5-flare > gemini-2.1 > qwen-spicy');
    expect(guide).toContain('set isNsfw=true');
  });
  it.each([
    {}, { image: 'base' }, { references: refs(4) }, { image: 'base', references: refs(15) },
    ...['enhance', 'creative', 'wild', 'captions'].map(category => ({ image: 'base', category })),
  ])('R01: Auto Flare regardless of old category or input shape: %j', req => {
    expect(route(req)).toEqual(['gpt-image-2.5-flare']);
  });
  it.each(['8:1', '1:8', '4:1', '1:4'])('R02: Auto %s uses 2.1 before submission', aspectRatio => {
    expect(route({ aspectRatio, image: 'base' })).toEqual(['gemini-2.1']);
  });
  it.each(['1K', '2K', '4K'] as const)('R03: explicit %s resolution selects 2.1 in Auto', imageResolution => {
    expect(route({ imageResolution })).toEqual(['gemini-2.1']);
  });
  it.each(IMAGE_MODEL_IDS)('R04/R05: explicit %s is retained or normalized', model => {
    expect(route({ model })).toEqual([model === 'openai' ? 'gpt-image-2.5-flare' : model]);
  });
  it('R05: old Qwen is normalized; retired and unknown IDs fail before submission', () => {
    expect(route({ model: 'qwen' })).toEqual(['qwen-spicy']);
    for (const model of ['pony', 'wai', 'unknown', 'constructor']) expect(() => route({ model: model as GenerateImageRequest['model'] })).toThrow();
  });
  it.each([{}, { image: 'base' }, { image: 'base', references: refs(2) }, { model: 'gpt-image-2.5-flare' as const }])('R06: NSFW goes directly to Spicy: %j', req => {
    expect(route({ ...req, isNsfw: true })).toEqual(['qwen-spicy']);
  });
  it.each([
    { background: 'transparent' as const }, { imageResolution: '2K' as const },
    { references: refs(4) }, { image: 'base', aspectRatio: '1:1' },
  ])('R07: incompatible NSFW does not reach another model: %j', req => {
    expect(() => route({ ...req, isNsfw: true })).toThrow(ImageCapabilityError);
  });
  it.each([{}, { image: 'base' }, { image: 'base', aspectRatio: '16:9' }, { model: 'gemini' as const }])('R08: existing transparent override is preserved: %j', req => {
    expect(route({ ...req, background: 'transparent' })).toEqual(['gpt-image-2.5-flare']);
  });
  it('R08/R09: transparent Sunburst stays selected, impossible transparent panorama fails', () => {
    expect(route({ model: 'gpt-image-2.5-sunburst', background: 'transparent' })).toEqual(['gpt-image-2.5-sunburst']);
    expect(() => route({ aspectRatio: '8:1', background: 'transparent' })).toThrow('No compatible image model');
  });
  it.each([
    ['gpt-image-2.5-flare', 16], ['gemini-2.1', 14], ['wan2.7-image', 9], ['qwen-spicy', 3],
  ] as const)('R10: %s counts base plus references at %i limit', (model, count) => {
    expect(route({ model, image: 'base', references: refs(count - 1) })).toEqual([model]);
    expect(() => route({ model, image: 'base', references: refs(count) })).toThrow(`inputImages=${count + 1}`);
  });
  it.each(['1:3', '3:1', '4:5', '2.5:1'])('R11: Flare accepts supported ratio %s', aspectRatio => {
    expect(route({ model: 'gpt-image-2.5-flare', aspectRatio })).toEqual(['gpt-image-2.5-flare']);
  });
  it.each(['3.01:1', '1:3.01', '8:1', '0:1', '1:0', '-1:2', '8：1', 'invalid'])('R11: Flare rejects %s', aspectRatio => {
    expect(() => route({ model: 'gpt-image-2.5-flare', aspectRatio })).toThrow(ImageCapabilityError);
  });
  it.each(['1:8', '8:1', '2.5:1'])('R11: Wan accepts range ratio %s', aspectRatio => {
    expect(route({ model: 'wan2.7-image', aspectRatio })).toEqual(['wan2.7-image']);
  });
  it('R11: 2.1 uses a discrete ratio list; unknown resolution never passes', () => {
    expect(() => route({ model: 'gemini-2.1', aspectRatio: '5:1' })).toThrow();
    expect(() => route({ imageResolution: '8K' as '4K' })).toThrow();
    expect(() => route({ aspectRatio: '1:9' })).toThrow();
    expect(() => route({ references: refs(17) })).toThrow();
  });
  it('R12: Spicy text-to-image has bounded size control, editing has no hard ratio', () => {
    expect(route({ model: 'qwen-spicy', aspectRatio: '6:1' })).toEqual(['qwen-spicy']);
    expect(route({ aspectRatio: '5:1' })).toEqual(['qwen-spicy']);
    expect(() => route({ model: 'qwen-spicy', aspectRatio: '6.1:1' })).toThrow();
    expect(() => route({ model: 'qwen-spicy', image: 'base', aspectRatio: '8:1' })).toThrow('no hard output-ratio control');
    expect(() => route({ image: 'base', aspectRatio: '5:1' })).toThrow();
  });
  it('R13: explicit Flare panorama returns alternatives satisfying all requirements', () => {
    try { route({ model: 'gpt-image-2.5-flare', aspectRatio: '8:1', imageResolution: '4K', references: refs(14) }); }
    catch (error) {
      expect(error).toBeInstanceOf(ImageCapabilityError);
      expect((error as ImageCapabilityError).compatibleModels).toEqual(['gemini-2.1']);
      return;
    }
    throw new Error('Expected capability conflict');
  });
  it('R20: explicitly configured Tips 2.1 and Enhance Spicy retain their route', () => {
    expect(route({ model: 'gemini-2.1', category: 'captions', image: 'base' })).toEqual(['gemini-2.1']);
    expect(route({ model: 'qwen-spicy', category: 'enhance', image: 'base' })).toEqual(['qwen-spicy']);
  });
  it('provider builders can validate against the same capabilities', () => {
    expect(getImageModelCapability('openai').id).toBe('gpt-image-2.5-flare');
    expect(() => validateImageModelRequest({ prompt: 'banner', aspectRatio: '8:1' }, 'gpt-image-2.5-flare')).toThrow();
  });
});

describe('one selected paid submission', () => {
  const generate = vi.fn();
  beforeEach(() => {
    generate.mockReset();
    vi.mocked(getBackend).mockReset().mockImplementation(id => ({ id, canHandle: () => true, generate }));
  });
  it.each([
    [{}, 'gpt-image-2.5-flare'], [{ aspectRatio: '8:1' }, 'gemini-2.1'], [{ isNsfw: true }, 'qwen-spicy'],
  ] as const)('R18: executes the selected route once: %j', async (req, model) => {
    generate.mockResolvedValue({ image: 'decoded-artwork', provider: 'supplier', usage: { modelId: model, inputTokens: 4, outputTokens: 5, providerCostUsd: 0.05 } });
    await expect(generateImage({ prompt: 'artwork', ...req })).resolves.toMatchObject({ model, image: 'decoded-artwork', provider: 'supplier', fallbackUsed: false, usage: { providerCostUsd: 0.05 } });
    expect(getBackend).toHaveBeenCalledExactlyOnceWith(model);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([new Error('timeout'), new Error('moderation rejection'), null])('R19: no fallback or retry after failure: %j', async error => {
    if (error) generate.mockRejectedValue(error); else generate.mockResolvedValue({ image: null });
    await expect(generateImage({ prompt: 'artwork' })).rejects.toThrow();
    expect(getBackend).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('R13/R17: impossible capability never contacts a provider', async () => {
    await expect(generateImage({ prompt: 'artwork', aspectRatio: '8:1', model: 'gpt-image-2.5-flare' })).rejects.toThrow(ImageCapabilityError);
    expect(getBackend).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
