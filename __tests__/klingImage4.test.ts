import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const state = vi.hoisted(() => ({ read: vi.fn(), getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/provider-image-preflight', () => ({ readProviderImage: state.read }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: state.getSupabaseAdmin }));
vi.mock('@/lib/billing/token-rates', () => ({ providerCostToCredits: (cost: number, markup: number) => Math.ceil(cost * markup / 0.01) }));
import { buildKlingImage4Request, estimateKlingImage4Credits, klingImage4Backend, queryKlingImage4Task } from '@/lib/models/kling-image4';
import { createKlingImage4Journal } from '@/lib/models/kling-image4-journal';
import { DEFAULT_IMAGE_MODEL, getImageModelCapability, planImageGeneration } from '@/lib/image-model-capabilities';

const id = 'existing-task-4';
const pricing = () => Response.json({ prices: [{ endpoint_id: 'kling/v4/text-to-image', unit_price: .063, unit: 'units', currency: 'USD' }] });
const accepted = () => Response.json({ request_id: id, response_url: 'https://evil.invalid/steal', status: 'IN_QUEUE' });
const completed = () => Response.json({ request_id: id, status: 'COMPLETED' });
const output = (units: string | null = '1.4921') => Response.json({ images: [{ url: 'https://v3.fal.media/test.png' }] }, { headers: units === null ? {} : { 'x-fal-billable-units': units } });
beforeEach(async () => {
  vi.stubEnv('FAL_KEY', 'test');
  state.read.mockReset().mockResolvedValue(await sharp({ create: { width: 4096, height: 4096, channels: 3, background: 'red' } }).png().toBuffer());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Kling Image 4.0 exact candidate contract', () => {
  it('leaves defaults unchanged and sends the exact brief and ordered inputs without invented controls', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2.6-flare');
    expect(getImageModelCapability('kling-image-4.0').autoPriority).toBeUndefined();
    const request = buildKlingImage4Request({ prompt: '只改帽子', image: 'https://example.com/base.png', references: [{ url: 'https://example.com/ref.png', role: 'reference' }] });
    expect(request).toEqual({ endpoint: 'kling/v4/image-to-image', body: { prompt: '只改帽子', image_urls: ['https://example.com/base.png', 'https://example.com/ref.png'], resolution: '2K', aspect_ratio: 'auto', result_type: 'single', num_images: 1, sync_mode: false } });
  });
  it.each([
    { background: 'transparent' }, { background: 'transparent', outputFormat: 'png' },
    { outputFormat: 'svg' }, { outputFormat: 'jpeg' }, { imageQuality: 'low' },
    { imageResolution: '1K' }, { aspectRatio: '8:1' }, { isNsfw: true },
    { references: Array(11).fill({ url: 'https://example.com/ref.png', role: 'reference' }) },
  ] as const)('rejects unsupported requests without selecting a fallback: %j', options => {
    expect(() => planImageGeneration({ model: 'kling-image-4.0', prompt: 'image', ...options })).toThrow();
  });
  it('requires uploaded HTTPS inputs and retains reference order', () => {
    expect(() => buildKlingImage4Request({ prompt: 'image', image: 'data:image/png;base64,AAAA' })).toThrow('HTTPS');
    expect(() => buildKlingImage4Request({ prompt: ' '.repeat(10) })).toThrow('Prompt');
  });
  it('quotes native tiers plus all references, rejects unknown prices and invalid markup', () => {
    expect(['2K', '4K', '8K'].map(imageResolution => estimateKlingImage4Credits({ imageResolution }, 2))).toEqual([13, 19, 32]);
    expect(estimateKlingImage4Credits({ imageResolution: '8K', imageInputCount: 10 }, 2)).toBe(38);
    expect(() => estimateKlingImage4Credits({ imageResolution: '1K' }, 2)).toThrow();
    expect(() => estimateKlingImage4Credits({}, NaN)).toThrow();
  });
  it('saves accepted and final receipts, polls a fixed host, and bills header units instead of native Units', async () => {
    const events: string[] = [];
    const fetcher = vi.fn().mockResolvedValueOnce(pricing()).mockImplementationOnce(async () => { events.push('POST'); return accepted(); }).mockImplementationOnce(async url => { events.push('GET'); expect(url).toBe(`https://queue.fal.run/kling/v4/requests/${id}/status`); return completed(); }).mockResolvedValueOnce(output());
    vi.stubGlobal('fetch', fetcher);
    const result = await klingImage4Backend.generate({ prompt: 'scene', imageResolution: '4K', beforeKlingImage4Submit: async () => { events.push('claim'); }, onKlingImage4Receipt: async receipt => { events.push(receipt.status); } });
    expect(events).toEqual(['claim', 'POST', 'IN_QUEUE', 'GET', 'COMPLETED']);
    expect(result).toMatchObject({ taskId: id, provider: 'fal', usage: { modelId: 'kling-image-4.0', providerCostUsd: 0.0940023 } });
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('rejects changed supplier pricing before any paid submission', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ prices: [{ endpoint_id: 'kling/v4/text-to-image', unit_price: .1, unit: 'units', currency: 'USD' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(klingImage4Backend.generate({ prompt: 'scene' })).rejects.toThrow('tariff changed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry an ambiguous paid POST', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(pricing()).mockRejectedValueOnce(new Error('socket reset'));
    vi.stubGlobal('fetch', fetcher);
    await expect(klingImage4Backend.generate({ prompt: 'scene' })).rejects.toThrow('No automatic resubmission');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('stops polling when the accepted receipt cannot be saved', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(pricing()).mockResolvedValueOnce(accepted());
    vi.stubGlobal('fetch', fetcher);
    await expect(klingImage4Backend.generate({ prompt: 'scene', onKlingImage4Receipt: async () => { throw Error('storage failed'); } })).rejects.toThrow(id);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('preserves a supplier refusal without an image, debit or second POST', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(pricing()).mockResolvedValueOnce(accepted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(Response.json({ detail: [{ type: 'content_policy_violation', msg: 'Rejected by content policy' }] }, { status: 422 }));
    vi.stubGlobal('fetch', fetcher);
    const receipts: string[] = [];
    await expect(klingImage4Backend.generate({ prompt: 'scene', onKlingImage4Receipt: async r => { receipts.push(r.status); } })).rejects.toThrow('content_policy_violation');
    expect(receipts).toEqual(['IN_QUEUE', 'FAILED']);
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('does not invent a charge if the completed result omits billable units', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(completed()).mockResolvedValueOnce(output(null)));
    await expect(queryKlingImage4Task(id)).rejects.toThrow('billable-units');
  });
  it('validates input dimensions before price query or POST', async () => {
    state.read.mockResolvedValue(await sharp({ create: { width: 299, height: 400, channels: 3, background: 'red' } }).png().toBuffer());
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(klingImage4Backend.generate({ prompt: 'scene', image: 'https://example.com/input.png' })).rejects.toThrow('≥300px');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Kling durable request gate', () => {
  it('admits only one concurrent caller and preserves receipt recovery on replay', async () => {
    const objects = new Map<string, string>();
    const bucket = {
      upload: vi.fn(async (key: string, body: string, options: { upsert: boolean }) => {
        if (!options.upsert && objects.has(key)) return { error: { statusCode: '409' } };
        objects.set(key, body); return { error: null };
      }),
      download: vi.fn(async (key: string) => ({ data: objects.has(key) ? new Blob([objects.get(key)!]) : null })),
    };
    state.getSupabaseAdmin.mockReturnValue({ storage: { from: () => bucket } });
    const request = buildKlingImage4Request({ prompt: 'private prompt must not be stored' });
    const a = createKlingImage4Journal('owner', 'same-call');
    const b = createKlingImage4Journal('owner', 'same-call');
    const results = await Promise.allSettled([a.beforeKlingImage4Submit!(request), b.beforeKlingImage4Submit!(request)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await a.onKlingImage4Receipt!({ taskId: id, provider: 'fal', providerModel: request.endpoint, status: 'IN_QUEUE' });
    await a.onKlingImage4Receipt!({ taskId: id, provider: 'fal', providerModel: request.endpoint, status: 'COMPLETED', billableUnits: 1, providerCostUsd: .063 });
    await expect(b.beforeKlingImage4Submit!(request)).rejects.toThrow(/COMPLETED receipt/);
    expect([...objects.values()].join(' ')).not.toContain('private prompt');
    await expect(createKlingImage4Journal('other-owner', 'same-call').beforeKlingImage4Submit!(request)).resolves.toBeUndefined();
  });
});
