import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/models', () => ({ getBackend: vi.fn() }));
import { getBackend } from '@/lib/models';
import { generateImage, resolveModelChain } from '@/lib/model-router';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS, type GenerateImageRequest } from '@/lib/models/types';
import { formatImageCapabilitiesForAgent, getImageModelCapability, planImageGeneration, listImageModelCapabilities, validateImageModelRequest } from '@/lib/image-model-capabilities';

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
  it('R05: old Qwen normalizes; unknown and retired IDs use Flare-first Auto', () => {
    expect(route({ model: 'qwen' })).toEqual(['qwen-spicy']);
    for (const model of ['pony', 'wai', 'unknown', 'constructor']) expect(route({ model })).toEqual(['gpt-image-2.5-flare']);
    expect(route({ model: 'unknown', aspectRatio: '8:1' })).toEqual(['gemini-2.1']);
  });
  it.each([{}, { image: 'base' }, { image: 'base', references: refs(2) }, { model: 'gpt-image-2.5-flare' as const }])('R06: NSFW goes directly to Spicy: %j', req => {
    expect(route({ ...req, isNsfw: true })).toEqual(['qwen-spicy']);
  });
  it.each([
    { background: 'transparent' as const }, { imageResolution: '2K' as const },
    { references: refs(4) }, { image: 'base', aspectRatio: '1:1' },
  ])('R07: NSFW output conflicts still deliver through Spicy: %j', req => {
    const plan = planImageGeneration({ prompt: 'artwork', ...req, isNsfw: true });
    expect(plan.model).toBe('qwen-spicy');
    expect(plan.adjustments.length).toBeGreaterThan(0);
    expect(() => validateImageModelRequest(plan.request, plan.model)).not.toThrow();
  });
  it.each([{}, { image: 'base' }, { image: 'base', aspectRatio: '16:9' }, { model: 'gemini' as const }])('R08: existing transparent override is preserved: %j', req => {
    expect(route({ ...req, background: 'transparent' })).toEqual(['gpt-image-2.5-flare']);
  });
  it('R08/R09: transparent Sunburst stays selected; transparent panorama keeps 8:1', () => {
    expect(route({ model: 'gpt-image-2.5-sunburst', background: 'transparent' })).toEqual(['gpt-image-2.5-sunburst']);
    const plan = planImageGeneration({ prompt: 'banner', aspectRatio: '8:1', background: 'transparent' });
    expect(plan).toMatchObject({ model: 'gemini-2.1', request: { aspectRatio: '8:1', background: 'opaque' } });
    const contentFirst = planImageGeneration({ prompt: 'banner', aspectRatio: '8:1', background: 'transparent', references: refs(16) });
    expect(contentFirst).toMatchObject({ model: 'gpt-image-2.5-flare', request: { aspectRatio: undefined, background: 'transparent' } });
    expect(contentFirst.request.references).toHaveLength(16);
  });
  it.each([
    ['gpt-image-2.5-flare', 16], ['gemini-2.1', 14], ['wan2.7-image', 9], ['qwen-spicy', 3],
  ] as const)('R10: %s counts base plus references at %i limit', (model, count) => {
    expect(route({ model, image: 'base', references: refs(count - 1) })).toEqual([model]);
    const plan = planImageGeneration({ prompt: 'artwork', model, image: 'base', references: refs(count) });
    expect(() => validateImageModelRequest(plan.request, plan.model)).not.toThrow();
    expect(plan.request.image).toBe('base');
  });
  it.each(['1:3', '3:1', '4:5', '2.5:1'])('R11: Flare accepts supported ratio %s', aspectRatio => {
    expect(route({ model: 'gpt-image-2.5-flare', aspectRatio })).toEqual(['gpt-image-2.5-flare']);
  });
  it.each(['3.01:1', '1:3.01', '8:1', '0:1', '1:0', '-1:2', '8：1', 'invalid'])('R11: impossible Flare canvas gets a compatible generation plan: %s', aspectRatio => {
    const plan = planImageGeneration({ prompt: 'artwork', model: 'gpt-image-2.5-flare', aspectRatio });
    expect(() => validateImageModelRequest(plan.request, plan.model)).not.toThrow();
  });
  it.each(['1:8', '8:1', '2.5:1'])('R11: Wan accepts range ratio %s', aspectRatio => {
    expect(route({ model: 'wan2.7-image', aspectRatio })).toEqual(['wan2.7-image']);
  });
  it('R11/R12: every unsupported output preference gets a valid image plan', () => {
    for (const request of [
      { model: 'gemini-2.1', aspectRatio: '5:1' }, { imageResolution: '8K' as '4K' },
      { aspectRatio: '1:9' }, { references: refs(17) },
      { model: 'qwen-spicy', aspectRatio: '6.1:1' },
      { model: 'qwen-spicy', image: 'base', aspectRatio: '8:1' },
      { image: 'base', aspectRatio: '5:1' },
    ]) {
      const plan = planImageGeneration({ prompt: 'artwork', ...request });
      expect(() => validateImageModelRequest(plan.request, plan.model)).not.toThrow();
    }
    expect(route({ model: 'qwen-spicy', aspectRatio: '6:1' })).toEqual(['qwen-spicy']);
    expect(route({ aspectRatio: '5:1' })).toEqual(['qwen-spicy']);
    const edit = planImageGeneration({ prompt: 'artwork', isNsfw: true, image: 'base', aspectRatio: '8:1', imageResolution: '4K', background: 'transparent' });
    expect(edit).toMatchObject({ model: 'qwen-spicy', request: { aspectRatio: undefined, imageResolution: undefined, background: 'opaque' } });
  });
  it('R13: explicit Flare panorama uses Nano before submission, preserving all requirements', () => {
    expect(route({ model: 'gpt-image-2.5-flare', aspectRatio: '8:1', imageResolution: '4K', references: refs(14) })).toEqual(['gemini-2.1']);
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
  it('R13/R17: conflict relaxes before one paid submission and returns the adjustment', async () => {
    generate.mockResolvedValue({ image: 'artwork', provider: 'supplier' });
    const result = await generateImage({ prompt: 'artwork', aspectRatio: '8:1', background: 'transparent', model: 'gpt-image-2.5-flare' });
    expect(result.model).toBe('gemini-2.1');
    expect(result.adjustments?.join(' ')).toContain('opaque');
    expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ aspectRatio: '8:1', background: 'opaque', model: 'gemini-2.1' }));
  });
});
