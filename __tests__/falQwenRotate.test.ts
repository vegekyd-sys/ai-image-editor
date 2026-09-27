import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('@/lib/gemini', () => ({ ensureJpeg: vi.fn(async (image: string) => image) }));
import { buildFalRotateBody, falRotateSize, generateWithFalQwenRotate } from '@/lib/fal-qwen-rotate';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); });
beforeEach(() => vi.stubEnv('FAL_KEY', 'test-key'));

describe('fal camera rotation', () => {
  it('maps the Makaron distance contract to fal zoom and caps output at 1 MP', () => {
    expect(buildFalRotateBody({ image: 'https://example.com/a.jpg', azimuth: 90, elevation: 30, distance: 0.6 }, falRotateSize(4000, 3000))).toMatchObject({
      horizontal_angle: 90, vertical_angle: 30, zoom: 10, enable_safety_checker: true, num_images: 1,
    });
    expect(buildFalRotateBody({ image: 'https://example.com/a.jpg', azimuth: 0, elevation: 0, distance: 1.4 }, falRotateSize(1000, 1000)).zoom).toBe(0);
    const size = falRotateSize(4000, 3000);
    expect(size.width * size.height).toBeLessThanOrEqual(1_000_000);
    expect(() => falRotateSize(8000, 1000)).toThrow('aspect ratio');
  });

  it('submits exactly once, polls the same request, and returns a decoded image', async () => {
    const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'blue' } }).png().toBuffer();
    const image = `data:image/png;base64,${png.toString('base64')}`;
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = vi.fn(async (rawUrl: string | URL | Request, init?: RequestInit) => {
      const url = String(rawUrl);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (init?.method === 'POST') return Response.json({ request_id: 'abc-123' });
      if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
      if (url.endsWith('/requests/abc-123')) return Response.json({ images: [{ url: 'https://v3.fal.media/out.png' }] });
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    const result = await generateWithFalQwenRotate({ image, azimuth: 45, elevation: 0, distance: 1 });
    expect(result.requestId).toBe('abc-123');
    expect(result.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(calls.map(call => call.url)).not.toContain(expect.stringContaining('comfyui'));
  });

  it('reports a content-checker rejection without exposing the source image or retrying', async () => {
    const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'blue' } }).png().toBuffer();
    const image = `data:image/png;base64,${png.toString('base64')}`;
    const fetchMock = vi.fn(async (rawUrl: string | URL | Request, init?: RequestInit) => {
      const url = String(rawUrl);
      if (init?.method === 'POST') return Response.json({ request_id: 'blocked-123' });
      if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
      return Response.json({ detail: [{ type: 'content_policy_violation', input: { image_urls: [image] } }] }, { status: 422 });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    let message = '';
    try {
      await generateWithFalQwenRotate({ image, azimuth: 315, elevation: 30, distance: 1.4 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('content checker rejected');
    expect(message).toContain('No automatic retry');
    expect(message).not.toContain(image);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
