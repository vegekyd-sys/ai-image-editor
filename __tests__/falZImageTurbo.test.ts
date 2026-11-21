import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planImageGeneration } from '@/lib/image-model-capabilities';
import { generateImage } from '@/lib/model-router';
import { estimateZImageTurboCredits } from '@/lib/models/fal-z-image-turbo';

const request = { model: 'z-image-turbo', prompt: 'A bold screen-print poster with a yellow lightning motif' };

beforeEach(() => vi.stubEnv('FAL_KEY', 'test-key'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fal Z-Image Turbo', () => {
  it('keeps Auto on Flare and rejects incompatible options on an explicit selection', () => {
    expect(planImageGeneration({ prompt: request.prompt }).model).toBe('gpt-image-2.6-flare');
    expect(planImageGeneration(request).request.outputFormat).toBe('webp');
    expect(planImageGeneration({ ...request, outputFormat: 'jpeg' }).request.outputFormat).toBe('jpeg');
    for (const input of [
      { image: 'https://example.com/image.jpg', references: [{ url: 'https://example.com/ref.jpg', role: 'reference' }] },
      { background: 'transparent' as const }, { outputFormat: 'svg' as const }, { outputFormat: 'gif' as const },
      { imageReasoningEffort: 'low' as const }, { imageResolution: '2K' }, { isNsfw: true }, { aspectRatio: '8:1' },
    ]) {
      expect(() => planImageGeneration({ ...request, ...input })).toThrow(/No generation was submitted/);
    }
  });

  it('uses one synchronous fal call, returns the validated original, and prices by billed units', async () => {
    const png = await sharp({ create: { width: 1024, height: 576, channels: 3, background: '#eecc44' } }).png().toBuffer();
    const image = `data:image/png;base64,${png.toString('base64')}`;
    const fetch = vi.fn(async () => Response.json({ images: [{ url: image }], has_nsfw_concepts: [false] }, {
      headers: { 'x-fal-billable-units': '1', 'x-fal-request-id': 'test-request-id' },
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(generateImage({ ...request, aspectRatio: '16:9', outputFormat: 'png' })).resolves.toMatchObject({
      model: request.model, taskId: 'test-request-id', provider: 'fal', image, fallbackUsed: false,
      usage: { modelId: request.model, providerCostUsd: 0.005, inputTokens: 0, outputTokens: 0 },
    });
    expect(estimateZImageTurboCredits({}, 2)).toBe(1);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://fal.run/fal-ai/z-image/turbo', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        prompt: request.prompt, image_size: { width: 1024, height: 576 }, num_inference_steps: 8, num_images: 1,
        enable_safety_checker: true, enable_prompt_expansion: false, sync_mode: true, output_format: 'png',
      }),
    }));
  });

  it('uses the single-image endpoint with WebP and the source aspect by default', async () => {
    const source = await sharp({ create: { width: 800, height: 450, channels: 3, background: '#334455' } }).png().toBuffer();
    const webp = await sharp({ create: { width: 1024, height: 576, channels: 3, background: '#eecc44' } }).webp().toBuffer();
    const fetch = vi.fn((_url: string, _options: RequestInit) => Promise.resolve(Response.json({
      images: [{ url: `data:image/webp;base64,${webp.toString('base64')}` }],
    }, { headers: { 'x-fal-billable-units': '1' } })));
    vi.stubGlobal('fetch', fetch);
    await expect(generateImage({ ...request, image: `data:image/png;base64,${source.toString('base64')}` }))
      .resolves.toMatchObject({ provider: 'fal', usage: { providerCostUsd: 0.005 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/z-image/turbo/image-to-image');
    expect(JSON.parse(options.body as string)).toMatchObject({
      image_size: { width: 1024, height: 576 }, output_format: 'webp', strength: 0.6, image_url: expect.stringMatching(/^data:image\/webp;base64,/),
    });
  });

  it('rejects corrupt source bytes before contacting fal', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(generateImage({ ...request, image: 'data:image/png;base64,aGVsbG8=' })).rejects.toThrow(/No generation was submitted/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retry, deliver, or switch models after transport errors, refusals, and invalid receipts', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    fetch.mockRejectedValueOnce(new Error('Connection reset'));
    await expect(generateImage(request)).rejects.toThrow(/outcome may be unknown/);
    fetch.mockResolvedValueOnce(new Response('{"images":['));
    await expect(generateImage(request)).rejects.toThrow(/could not read the provider response body.*outcome may be unknown/);
    fetch.mockResolvedValueOnce(Response.json({ detail: [{ type: 'content_policy_violation' }] }, { status: 422 }));
    await expect(generateImage({ ...request, benignCharacterContent: true })).rejects.toMatchObject({ providerCode: 'content_policy_violation' });
    fetch.mockResolvedValueOnce(Response.json({ images: [{ url: 'https://invalid.example.com/generated.jpg' }] }));
    await expect(generateImage(request)).rejects.toThrow(/missing billing receipt/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('stops before submission on a cancelled request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(generateImage({ ...request, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
