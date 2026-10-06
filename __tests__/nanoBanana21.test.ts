// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildNanoBanana21Request, nanoBanana21Backend } from '@/lib/models/nano-banana-21';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Nano Banana 2.1 OpenRouter contract', () => {
  it('keeps all labeled references, panorama ratio and requested resolution; omits unsupported sampling', () => {
    const body = buildNanoBanana21Request({ image: 'https://example.com/base.png', references: [{ url: 'https://example.com/mask.png', role: 'red drawing marks the area to change' }], prompt: 'Change only the marked background.', aspectRatio: '8:1', imageResolution: '4K', thinkingEffort: 'high' });
    expect(body).toMatchObject({ resolution: '4K', aspect_ratio: '8:1' });
    expect(body.input_references).toHaveLength(2);
    expect(body.prompt).toContain('red drawing marks the area to change');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('seed');
    expect(body).not.toHaveProperty('reasoning');
  });

  it('validates reference count and resolution before a paid POST', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(nanoBanana21Backend.generate({ image: 'base', references: Array.from({ length: 14 }, () => ({ url: 'ref', role: 'reference' })), prompt: 'Combine' })).rejects.toThrow('at most 14');
    await expect(nanoBanana21Backend.generate({ prompt: 'Scene', aspectRatio: '7:3' })).rejects.toThrow('aspect ratio');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('decodes output, preserves PNG and uses actual cost including input and thinking', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test');
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#765432' } }).png().toBuffer();
    const image = `data:image/png;base64,${png.toString('base64')}`;
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'request-1', data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { prompt_tokens: 100, completion_tokens: 1300, cost: 0.0347 } }));
    vi.stubGlobal('fetch', fetch);
    const result = await nanoBanana21Backend.generate({ prompt: 'Scene' });
    expect(result).toEqual({ image, provider: 'openrouter', usage: { modelId: 'google/gemini-nano-banana-2.1', inputTokens: 100, outputTokens: 1300, providerCostUsd: 0.0347, provider: 'openrouter' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).resolution).toBe('1K');
  });

  it.each(['timeout', 'http', 'empty', 'corrupt', 'no-cost'])('does not repeat a paid POST after %s', async mode => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    if (mode === 'timeout') fetch.mockRejectedValue(new Error('timeout'));
    else if (mode === 'http') fetch.mockResolvedValue(Response.json({ error: {} }, { status: 503 }));
    else fetch.mockResolvedValue(Response.json({ data: mode === 'empty' ? [] : [{ b64_json: 'aW52YWxpZA==', media_type: 'image/png' }], usage: { prompt_tokens: 1, completion_tokens: 1, ...(mode === 'no-cost' ? {} : { cost: 0.04 }) } }));
    await expect(nanoBanana21Backend.generate({ prompt: 'Scene' })).rejects.toThrow('No automatic retry');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
