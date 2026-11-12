// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/provider-image-preflight', async original => ({ ...await original<typeof import('@/lib/provider-image-preflight')>(), readProviderImage: state.read }));
import { buildSeedream55Request, estimateSeedream55Credits, querySeedream55Task, seedream55Backend, seedream55CostUsd } from '@/lib/models/seedream55';
import { DEFAULT_IMAGE_MODEL, planImageGeneration } from '@/lib/image-model-capabilities';
import { editImage } from '@/lib/skills/edit-image';

const model = 'doubao-seedream-5.5';
const task = (status = 'completed', endpoint = model) => ({ id: 'receipt-55', model: endpoint, status, results: ['https://files.evolink.ai/result.png'] });
beforeEach(async () => {
  vi.stubEnv('EVOLINK_API_KEY', 'test-secret');
  state.read.mockReset().mockResolvedValue(await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 120, g: 30, b: 220, alpha: 0.5 } } }).png().toBuffer());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Seedream 5.5 explicit candidate', () => {
  it('retains native alpha selection but never enters Auto', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2.6-flare');
    expect(planImageGeneration({ prompt: 'cutout', background: 'transparent' }).model).toBe(DEFAULT_IMAGE_MODEL);
    expect(planImageGeneration({ prompt: 'cutout', model: 'seedream-5.5', outputFormat: 'png', background: 'transparent', imageResolution: '1.5K' }).model).toBe('seedream-5.5');
  });
  it('preserves the original prompt and base/reference order; edit ratio omission stays omitted', () => {
    const request = buildSeedream55Request({ prompt: 'Only change the hat. 其余保持。', image: 'https://example.com/base.png', references: [{ url: 'https://example.com/reference.png', role: 'identity' }] });
    expect(request.model).toBe(model);
    expect(request.body).toEqual({ model, prompt: 'Only change the hat. 其余保持。', image_urls: ['https://example.com/base.png', 'https://example.com/reference.png'], size: 'auto', quality: '1K', prompt_priority: 'standard', output_format: 'png', background: 'auto', watermark: false });
    expect(request.costUsd).toBe(0.0288);
    expect(buildSeedream55Request({ prompt: 'new scene' }).body.size).toBe('1:1');
  });
  it.each([
    { outputFormat: 'gif' }, { outputFormat: 'webp' }, { outputFormat: 'svg' },
    { imageQuality: 'low' }, { imageReasoningEffort: 'high' }, { imageResolution: '4K' },
    { aspectRatio: '8:1' }, { background: 'transparent', outputFormat: 'jpeg' },
    { references: Array(11).fill({ url: 'ref', role: 'reference' }) }, { isNsfw: true },
  ] as const)('rejects unsupported controls before submission: %j', options => {
    expect(() => planImageGeneration({ prompt: 'asset', model: 'seedream-5.5', ...options })).toThrow();
  });
  it('prices every native tier plus every input; credit rounding matches final tariff', () => {
    expect(['1K', '1.5K', '2K'].map(tier => seedream55CostUsd(tier))).toEqual([0.016, 0.016, 0.028]);
    expect(seedream55CostUsd('2K', 10)).toBe(0.092);
    expect(() => seedream55CostUsd('3K')).toThrow();
    expect(estimateSeedream55Credits({ imageResolution: '2K', imageInputCount: 2 }, 2)).toBe(9);
    expect(() => seedream55CostUsd('4K')).toThrow();
    expect(() => estimateSeedream55Credits({}, 0)).toThrow();
    expect(estimateSeedream55Credits({ imageInputCount: 0 }, 2)).toBe(4);
    expect(estimateSeedream55Credits({ imageInputCount: 1 }, 2)).toBe(5);
    expect(estimateSeedream55Credits({ imageInputCount: 10 }, 2)).toBe(16);
    expect(estimateSeedream55Credits({ imageInputCount: 10, imageResolution: '2K' }, 2)).toBe(19);
  });
  it('rejects undocumented ratio presets before a provider request', () => {
    expect(() => buildSeedream55Request({ prompt: 'scene', aspectRatio: '1:2' })).toThrow('aspectRatio');
  });
  it('rejects a too-small source before the paid POST', async () => {
    state.read.mockResolvedValue(await sharp({ create: { width: 14, height: 32, channels: 3, background: 'red' } }).png().toBuffer());
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(seedream55Backend.generate({ prompt: 'edit', image: 'https://example.com/tiny.png' })).rejects.toThrow('dimensions >14px');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not submit a request already cancelled by the caller', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(seedream55Backend.generate({ prompt: 'scene', signal: AbortSignal.abort() })).rejects.toThrow('nothing was submitted');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists a terminal provider failure and keeps its original task ID without a second POST', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(task('processing'))).mockResolvedValueOnce(Response.json({ ...task('failed'), results: [], error: { code: 'content_policy_violation' } }));
    vi.stubGlobal('fetch', fetcher);
    const receipts: string[] = [];
    await expect(seedream55Backend.generate({ prompt: 'scene', onSeedream55Receipt: async receipt => { receipts.push(receipt.status); } })).rejects.toThrow('receipt-55');
    expect(receipts).toEqual(['processing', 'failed']);
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('preserves requested JPEG bytes instead of returning mislabeled PNG', async () => {
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).jpeg().toBuffer();
    state.read.mockResolvedValue(bytes); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(task())));
    const result = await seedream55Backend.generate({ prompt: 'scene', outputFormat: 'jpeg', background: 'opaque' });
    expect(result.image).toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`);
  });
  it('submits exactly once and returns native PNG bytes, actual endpoint identity and tariff', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(task())); vi.stubGlobal('fetch', fetcher);
    const result = await seedream55Backend.generate({ prompt: 'asset', background: 'transparent' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.evolink.ai/v1/images/generations');
    expect(result.image).toBe(`data:image/png;base64,${(await state.read.mock.results[0].value).toString('base64')}`);
    expect(result).toMatchObject({ taskId: 'receipt-55', provider: 'evolink', usage: { modelId: 'seedream-5.5', providerCostUsd: 0.016 } });
  });
  it('saves the accepted receipt BEFORE any polling and never follows provider-supplied query URLs', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const fetcher = vi.fn().mockImplementationOnce(async () => { events.push('POST'); return Response.json(task('processing')); }).mockImplementationOnce(async url => { events.push('GET'); expect(url).toBe('https://api.evolink.ai/v1/tasks/receipt-55'); return Response.json(task()); });
    vi.stubGlobal('fetch', fetcher);
    const generating = seedream55Backend.generate({ prompt: 'asset', onSeedream55Receipt: async () => { events.push('saved'); } });
    await vi.runAllTimersAsync(); await generating;
    expect(events).toEqual(['POST', 'saved', 'GET', 'saved']);
  });
  it('surfaces the accepted task if persistence fails, without polling or submitting again', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(task('processing'))); vi.stubGlobal('fetch', fetcher);
    await expect(seedream55Backend.generate({ prompt: 'asset', onSeedream55Receipt: async () => { throw new Error('private detail'); } })).rejects.toThrow('Task: receipt-55');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never retries unknown paid POST outcomes or leaks raw provider errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('private source URL and test-secret')); vi.stubGlobal('fetch', fetcher);
    await expect(seedream55Backend.generate({ prompt: 'asset' })).rejects.toThrow('Check provider History');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset().mockResolvedValue(Response.json({ message: 'test-secret private URL' }, { status: 503 }));
    try { await seedream55Backend.generate({ prompt: 'asset' }); } catch (e) { expect(String(e)).not.toContain('test-secret'); expect(String(e)).toContain('HTTP 503'); }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovery is GET-only, checks task identity, and rejects path injection', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(task())); vi.stubGlobal('fetch', fetcher);
    expect((await querySeedream55Task('receipt-55')).status).toBe('completed');
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('method', 'POST');
    await expect(querySeedream55Task('../other')).rejects.toThrow('Invalid task ID');
    fetcher.mockResolvedValue(Response.json({ ...task(), id: 'someone-else' }));
    await expect(querySeedream55Task('receipt-55')).rejects.toThrow('mismatched');
  });
  it('refuses a painted opaque PNG for transparent output, and keeps its recoverable ID', async () => {
    state.read.mockResolvedValue(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } }).png().toBuffer());
    const fetcher = vi.fn().mockResolvedValue(Response.json(task())); vi.stubGlobal('fetch', fetcher);
    await expect(seedream55Backend.generate({ prompt: 'asset', background: 'transparent' })).rejects.toThrow('format/alpha');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects corrupt input before a paid submission', async () => {
    state.read.mockResolvedValue(Buffer.from('not an image')); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(seedream55Backend.generate({ prompt: 'edit', image: 'https://example.com/source.png' })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not submit when credentials are absent', async () => {
    vi.stubEnv('EVOLINK_API_KEY', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(seedream55Backend.canHandle({ prompt: 'asset' })).toBe(false);
    await expect(editImage({ editPrompt: 'asset', preferredModel: 'seedream-5.5' }, {})).resolves.toMatchObject({ success: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
