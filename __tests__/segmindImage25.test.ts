import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildSegmindImage25Request, createSegmindImage25Backend, segmindImage25Cost } from '@/lib/models/segmind-image25';
import { createImage25Backend } from '@/lib/models/image25';
const model = 'gpt-image-2.5-flare';
beforeEach(() => { vi.stubEnv('SEGMIND_API_KEY', 'test'); vi.stubEnv('SEGMIND_IMAGE25_MODERATION', 'low'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const completed = { status: 'COMPLETED', images: [{ url: 'https://images.segmind.com/generations/result.png' }], metrics: { cost: 0.018 } };
describe('Segmind Image 2.5', () => {
  it('preserves ordered references, transparent output and explicit quality/moderation', () => {
    expect(buildSegmindImage25Request({ prompt: 'Edit', image: 'https://example.com/base.png', references: [{ url: 'https://example.com/ref.png', role: 'color' }], aspectRatio: '1:1', background: 'transparent' }, model)).toMatchObject({ image_urls: ['https://example.com/base.png', 'https://example.com/ref.png'], quality: 'low', moderation: 'low', background: 'transparent', size: '1024x1024' });
    vi.stubEnv('SEGMIND_IMAGE25_MODERATION', 'invalid');
    expect(() => buildSegmindImage25Request({ prompt: 'Edit' }, model)).toThrow('Invalid');
  });
  it('uploads inline inputs, polls a canonical URL and returns decoded image with actual cost', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 50, b: 100, alpha: 0.5 } } }).png().toBuffer();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ file_urls: ['https://images.segmind.com/assets/input.png'] }))
      .mockResolvedValueOnce(Response.json({ request_id: 'request-123', status_url: 'https://bad.invalid' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json(completed))
      .mockResolvedValueOnce(new Response(new Uint8Array(png)));
    vi.stubGlobal('fetch', fetcher);
    const result = await createSegmindImage25Backend(model).generate({ prompt: 'Edit', image: 'data:image/png;base64,AAAA', background: 'transparent' });
    expect(result).toMatchObject({ provider: 'segmind', usage: { modelId: model, providerCostUsd: 0.018, inputTokens: 0, outputTokens: 0 } });
    expect(result.image).toMatch(/^data:image\/png;base64,/);
    expect(fetcher.mock.calls[2][0]).toBe('https://api.segmind.com/v2/requests/request-123/status');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).image_urls).toEqual(['https://images.segmind.com/assets/input.png']);
    expect(fetcher.mock.calls[4][1]).not.toHaveProperty('headers');
  });
  it('never resubmits or changes provider following a policy rejection', async () => {
    vi.stubEnv('GPT_IMAGE25_PROVIDER', 'segmind'); vi.stubEnv('FAL_KEY', 'also-configured');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ request_id: 'request-123' }))
      .mockResolvedValueOnce(Response.json({ status: 'FAILED', error: 'content_policy_violation' }, { status: 422 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createImage25Backend(model).generate({ prompt: 'Edit' })).rejects.toThrow('content checker rejected');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not resubmit on unknown submission outcome', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('network failure'));
    vi.stubGlobal('fetch', fetcher);
    await expect(createSegmindImage25Backend(model).generate({ prompt: 'Edit' })).rejects.toThrow('submission');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects missing or invalid costs and unexpected output hosts', async () => {
    for (const value of [undefined, null, 0, -1, '0.01', NaN]) expect(() => segmindImage25Cost(value)).toThrow('cost');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ request_id: 'request-123' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ ...completed, images: [{ url: 'https://internal.invalid/result' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createSegmindImage25Backend(model).generate({ prompt: 'Edit' })).rejects.toThrow('Unexpected');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('fails closed when the configured provider has no key', () => {
    vi.stubEnv('GPT_IMAGE25_PROVIDER', 'segmind'); vi.stubEnv('SEGMIND_API_KEY', ''); vi.stubEnv('FAL_KEY', 'available');
    expect(createImage25Backend(model).canHandle({ prompt: 'Edit' })).toBe(false);
  });
});
