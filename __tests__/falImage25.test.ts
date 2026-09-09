import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildFalImage25Request, createFalImage25Backend, falImage25Cost, image25Size } from '@/lib/models/fal-image25';

const model = 'gpt-image-2.5-flare';
beforeEach(() => vi.stubEnv('FAL_KEY', 'test-key'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('fal Image 2.5 paid request contract', () => {
  it('explicitly sends low and every ordered reference to the correct variant edit endpoint', () => {
    const request = buildFalImage25Request({ prompt: 'Edit', image: 'https://example.com/base.png', references: [{ url: 'https://example.com/ref.png', role: 'Color reference' }], background: 'transparent', aspectRatio: '1:1' }, 'gpt-image-2.5-sunburst');
    expect(request.endpoint).toBe('openai/gpt-image-2.5/sunburst/edit');
    expect(request.body).toMatchObject({ image_urls: ['https://example.com/base.png', 'https://example.com/ref.png'], quality: 'low', background: 'transparent', image_size: { width: 1024, height: 1024 }, num_images: 1 });
    expect(request.body.prompt).toContain('Image 2: Color reference');
    expect(() => buildFalImage25Request({ prompt: 'Edit', references: Array(17).fill({ url: 'https://example.com/a', role: 'reference' }) }, model)).toThrow('at most 16');
    expect(() => image25Size('4:1')).toThrow('between');
    expect(() => image25Size('0:0')).toThrow('between');
  });
  it('uses supplier billable units, never invented token counts or a fixed image price', () => {
    expect(falImage25Cost('0.0062', 1)).toBeCloseTo(0.0062);
    expect(falImage25Cost('2', 0.03)).toBeCloseTo(0.06);
    for (const bad of [null, '', 'NaN', '-1', '0']) expect(() => falImage25Cost(bad, 1)).toThrow('billing units');
  });
  it('makes one paid POST, polls its canonical request, validates alpha and returns cost', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    const endpoint = 'openai/gpt-image-2.5/flare/text-to-image';
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ prices: [{ endpoint_id: endpoint, unit_price: 1, currency: 'USD' }] }))
      .mockResolvedValueOnce(Response.json({ request_id: 'request-123', status_url: 'https://untrusted.invalid' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: 'https://v3.fal.media/output.png' }] }, { headers: { 'x-fal-billable-units': '0.0062' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(png)));
    vi.stubGlobal('fetch', fetcher);
    const result = await createFalImage25Backend(model).generate({ prompt: 'Sticker', background: 'transparent', codexSubscription: { userId: 'owner', projectId: 'project' } });
    expect(result.image).toMatch(/^data:image\/png;base64,/);
    expect(result).toMatchObject({ provider: 'fal', usage: { modelId: model, providerCostUsd: 0.0062, inputTokens: 0, outputTokens: 0 } });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls[2][0]).toBe('https://queue.fal.run/openai/gpt-image-2.5/requests/request-123/status');
  });
  it('never resubmits after an accepted request fails', async () => {
    const endpoint = 'openai/gpt-image-2.5/flare/text-to-image';
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ prices: [{ endpoint_id: endpoint, unit_price: 1, currency: 'USD' }] }))
      .mockResolvedValueOnce(Response.json({ request_id: 'request-123' }))
      .mockRejectedValueOnce(new Error('secret signed URL'));
    vi.stubGlobal('fetch', fetcher);
    await expect(createFalImage25Backend(model).generate({ prompt: 'Cup' })).rejects.toThrow('No automatic retry');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('fails before spending when pricing cannot be obtained', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createFalImage25Backend(model).generate({ prompt: 'Cup' })).rejects.toThrow('No generation was submitted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
