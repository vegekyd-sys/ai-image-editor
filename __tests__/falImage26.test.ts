import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildFalImage25Request, checkFalImage25Response, createFalImage25Backend } from '@/lib/models/fal-image25';
import { DEFAULT_IMAGE_MODEL, getImageModelCapability, planImageGeneration } from '@/lib/image-model-capabilities';
import { FAL_IMAGE26_IDS, IMAGE_MODEL_IDS, isFalGptImage, isFalImage25 } from '@/lib/models/types';

beforeEach(() => vi.stubEnv('FAL_KEY', 'test-key'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('native GIF sheet regression from real failed chat requests', () => {
  it.each([2, 6, 8, 9])('keeps %i frames within the sheet edge even when total pixels would allow larger frames', frames => {
    for (const imageResolution of [undefined, '1K']) {
      const { body } = buildFalImage25Request({ prompt: 'Animate the reference', image: 'https://example.com/ref.png', aspectRatio: '1:1', outputFormat: 'gif', frameCount: frames, imageResolution }, FAL_IMAGE26_IDS[0]);
      expect(body.image_size).toEqual({ width: 960, height: 960 });
      expect(body.frame_count).toBe(frames);
    }
  });

  it('rejects unsupported per-frame resolution before any provider call', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(createFalImage25Backend(FAL_IMAGE26_IDS[0]).generate({ prompt: 'Animate', outputFormat: 'gif', frameCount: 2, imageResolution: '2K' })).rejects.toThrow('not 2K/4K');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns the native-sheet validation reason while omitting private prompt/URL echoes', () => {
    const response = new Response(null, { status: 422 });
    expect(() => checkFalImage25Response(response, { detail: [{ type: 'value_error', loc: ['body', 'image_size'], msg: "No supported sheet fits 8 GIF frames at size '1008x1008'. The longest edge must be less than or equal to 3840." }] })).toThrow('image_size: No supported sheet fits 8 GIF frames');
    try {
      checkFalImage25Response(response, { detail: [{ type: 'value_error', loc: ['body', 'prompt'], msg: 'private prompt' }, { type: 'value_error', loc: ['body', 'image_size'], msg: 'Bad size https://private.example/file?secret=value' }] });
    } catch (error) {
      expect(String(error)).not.toContain('private prompt');
      expect(String(error)).not.toContain('secret=value');
      expect(String(error)).toContain('[redacted]');
    }
  });
});

describe('GPT Image 2.6 upgrade', () => {
  it('keeps Auto and old provider selection separate from explicit 2.6', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2.6-flare');
    expect(planImageGeneration({ prompt: 'A product photo' }).model).toBe(DEFAULT_IMAGE_MODEL);
    for (const model of FAL_IMAGE26_IDS) {
      expect(IMAGE_MODEL_IDS).toContain(model);
      expect(isFalGptImage(model)).toBe(true);
      expect(isFalImage25(model)).toBe(false);
      expect(getImageModelCapability(model).autoPriority).toBe(model.endsWith('flare') ? 1 : undefined);
      expect(planImageGeneration({ prompt: 'Sticker', model, background: 'transparent' }).model).toBe(model);
    }
  });

  it.each(FAL_IMAGE26_IDS)('maps %s to documented generation and edit contracts', model => {
    const variant = model.endsWith('flare') ? 'flare' : 'sunburst';
    const generated = buildFalImage25Request({ prompt: 'A poster', aspectRatio: '16:9', imageResolution: '4K' }, model);
    expect(generated.endpoint).toBe(`openai/gpt-image-2.6/${variant}/text-to-image`);
    expect(generated.body).toMatchObject({ output_format: 'png', num_images: 1, quality: 'low', reasoning_effort: 'high', image_size: { width: 3840, height: 2160 } });
    const edited = buildFalImage25Request({ prompt: 'Change only the mug', image: 'https://example.com/base.png', references: [{ url: 'https://example.com/color.png', role: 'color only' }] }, model);
    expect(edited.endpoint).toBe(`openai/gpt-image-2.6/${variant}/edit`);
    expect(edited.body.image_urls).toEqual(['https://example.com/base.png', 'https://example.com/color.png']);
    expect(edited.body.prompt).toContain('Image 2: color only');
    expect(edited.body).not.toHaveProperty('frame_count');
    expect(edited.body).not.toHaveProperty('markup_image_url');
  });

  it('rejects prompt and reference limits before any supplier request', () => {
    expect(() => buildFalImage25Request({ prompt: 'a'.repeat(32001) }, FAL_IMAGE26_IDS[0])).toThrow('32000');
    expect(() => buildFalImage25Request({ prompt: 'a'.repeat(31990), references: [{ url: 'https://example.com/a.png', role: 'first' }, { url: 'https://example.com/b.png', role: 'second' }] }, FAL_IMAGE26_IDS[0])).toThrow('32000');
    expect(() => buildFalImage25Request({ prompt: 'Edit', references: Array(17).fill({ url: 'https://example.com/a.png', role: 'ref' }) }, FAL_IMAGE26_IDS[0])).toThrow('at most 16');
    expect(() => buildFalImage25Request({ prompt: 'Square', imageResolution: '4K', aspectRatio: '1:1' }, FAL_IMAGE26_IDS[0])).toThrow('pixel budget');
  });

  it.each(FAL_IMAGE26_IDS)('submits %s once, polls its exact schema path and retains actual cost', async model => {
    const endpoint = buildFalImage25Request({ prompt: 'Sticker' }, model).endpoint;
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 240, g: 0, b: 200, alpha: 0.5 } } }).png().toBuffer();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ prices: [{ endpoint_id: endpoint, unit: 'units', unit_price: 1, currency: 'USD' }] }))
      .mockResolvedValueOnce(Response.json({ request_id: 'gpt26-request', status_url: 'https://untrusted.invalid' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: 'https://v3.fal.media/result.png' }] }, { headers: { 'x-fal-billable-units': '0.0073' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(png)));
    vi.stubGlobal('fetch', fetcher);
    const result = await createFalImage25Backend(model).generate({ prompt: 'Sticker', background: 'transparent' });
    expect(result.usage).toMatchObject({ modelId: model, provider: 'fal', providerCostUsd: 0.0073, inputTokens: 0, outputTokens: 0 });
    expect(fetcher.mock.calls[2][0]).toBe(`https://queue.fal.run/openai/gpt-image-2.6/requests/gpt26-request/status`);
    expect(fetcher.mock.calls[3][0]).toBe(`https://queue.fal.run/openai/gpt-image-2.6/requests/gpt26-request`);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(await sharp(Buffer.from(result.image!.split(',')[1], 'base64')).metadata()).toMatchObject({ format: 'png', hasAlpha: true });
  });

  it('does not spend against a differently denominated pricing row', async () => {
    const endpoint = buildFalImage25Request({ prompt: 'Cup' }, FAL_IMAGE26_IDS[0]).endpoint;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ prices: [{ endpoint_id: endpoint, unit: 'image', currency: 'USD', unit_price: 1 }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createFalImage25Backend(FAL_IMAGE26_IDS[0]).generate({ prompt: 'Cup' })).rejects.toThrow('No generation was submitted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-billing', 'unexpected-format'])('retains one accepted task on %s without a second POST', async failure => {
    const model = FAL_IMAGE26_IDS[0];
    const endpoint = buildFalImage25Request({ prompt: 'Cup' }, model).endpoint;
    const jpg = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).jpeg().toBuffer();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ prices: [{ endpoint_id: endpoint, unit: 'units', unit_price: 1, currency: 'USD' }] }))
      .mockResolvedValueOnce(Response.json({ request_id: 'existing-task' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: 'https://v3.fal.media/result.png' }] }, { headers: failure === 'missing-billing' ? {} : { 'x-fal-billable-units': '0.01' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(jpg)));
    vi.stubGlobal('fetch', fetcher);
    await expect(createFalImage25Backend(model).generate({ prompt: 'Cup' })).rejects.toThrow('Request: existing-task');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});

describe('native GIF sheet grid (live fal validation 2026-11-05)', () => {
  it.each([[2, 960], [8, 960], [9, 960], [10, 816], [11, 816], [12, 816], [13, 720], [16, 720]])('%i square frames use %ipx', (frames, edge) => {
    const { body } = buildFalImage25Request({ prompt: 'Sticker', aspectRatio: '1:1', outputFormat: 'gif', frameCount: frames }, FAL_IMAGE26_IDS[0]);
    expect(body.image_size).toEqual({ width: edge, height: edge });
  });

  it('keeps non-square sheets inside the provider edge and pixel budget', () => {
    for (const aspectRatio of ['9:16', '16:9', '3:4', '2:1']) {
      for (let frames = 2; frames <= 16; frames++) {
        const size = buildFalImage25Request({ prompt: 'Sticker', aspectRatio, outputFormat: 'gif', frameCount: frames }, FAL_IMAGE26_IDS[0]).body.image_size as { width: number; height: number };
        expect(size.width % 16 + size.height % 16).toBe(0);
        const cells = frames <= 8 ? 8 : frames === 9 ? 9 : frames <= 12 ? 12 : 16;
        expect(size.width * size.height * cells).toBeLessThanOrEqual(8294400);
      }
    }
  });

  it('rejects more than 16 frames before any provider call', () => {
    expect(() => buildFalImage25Request({ prompt: 'Sticker', outputFormat: 'gif', frameCount: 17 }, FAL_IMAGE26_IDS[0])).toThrow('2–16');
  });
});
