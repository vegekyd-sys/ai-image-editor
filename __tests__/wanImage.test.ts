// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildWanImageRequest, wanImageBackend, wanImageEndpoint, wanImageSize } from '@/lib/models/wan-image';

const HOST = 'ws-example.ap-southeast-1.maas.aliyuncs.com';
const OUTPUT = 'https://dashscope-result.oss-ap-southeast-1.aliyuncs.com/image.png';
const KEY = 'test-private-credential';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('DASHSCOPE_API_KEY', KEY);
  vi.stubEnv('DASHSCOPE_API_HOST', HOST);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Wan 2.7 native adapter', () => {
  it('restricts workspace keys to the priced Singapore native API', () => {
    expect(wanImageEndpoint(HOST)).toBe(`https://${HOST}/api/v1/services/aigc/multimodal-generation/generation`);
    for (const host of ['http://' + HOST, HOST + '/compatible-mode/v1', HOST + '.evil.test', 'user:pass@' + HOST, HOST + ':9999', 'ws-example.cn-beijing.maas.aliyuncs.com']) {
      expect(() => wanImageEndpoint(host)).toThrow();
    }
  });

  it('uses a fixed fast tier without changing existing image-model defaults', () => {
    expect(wanImageSize()).toBe('1K');
    expect(wanImageSize('16:9')).toBe('1280*720');
    expect(wanImageSize('9:16')).toBe('720*1280');
    for (const ratio of ['1:1', '4:3', '3:4', '1:8', '8:1']) {
      const [w, h] = wanImageSize(ratio).split('*').map(Number);
      expect(w * h).toBeGreaterThanOrEqual(768 ** 2);
      expect(w * h).toBeLessThanOrEqual(2048 ** 2);
      expect(w / h).toBeGreaterThanOrEqual(1 / 8);
      expect(w / h).toBeLessThanOrEqual(8);
    }
    for (const ratio of ['0:0', 'NaN', '16:0', '9:1']) expect(() => wanImageSize(ratio)).toThrow();
  });

  it('requests one output and preserves the short prompt and full reference image', () => {
    const body = buildWanImageRequest({ prompt: 'Keep this woman unchanged.', image: 'data:image/jpeg;base64,YQ==', aspectRatio: '16:9' });
    expect(body.model).toBe('wan2.7-image');
    expect(body.input.messages[0].content).toEqual([{ image: 'data:image/jpeg;base64,YQ==' }, { text: 'Keep this woman unchanged.' }]);
    expect(body.parameters).toEqual({ size: '1280*720', n: 1, watermark: false, enable_sequential: false, thinking_mode: false });
    expect(body.parameters).not.toHaveProperty('prompt_extend');
  });

  it('supports T2I and ordered multiple image references without dropping the base', () => {
    expect(buildWanImageRequest({ prompt: 'A red mug.' }).input.messages[0].content).toEqual([{ text: 'A red mug.' }]);
    const body = buildWanImageRequest({ image: 'https://example.com/base.jpg', prompt: 'Combine.', references: [{ url: 'https://example.com/ref.jpg', role: 'clothing reference' }] });
    expect(body.input.messages[0].content.slice(0, 2)).toEqual([{ image: 'https://example.com/base.jpg' }, { image: 'https://example.com/ref.jpg' }]);
    expect(body.input.messages[0].content[2]).toEqual({ text: expect.stringContaining('clothing reference') });
    expect(() => buildWanImageRequest({ prompt: 'Combine.', references: Array.from({ length: 10 }, () => ({ url: 'https://example.com/ref.jpg', role: 'ref' })) })).toThrow('at most 9');
  });

  it('rejects unsupported prompts, URLs and transparent output before submission', async () => {
    for (const req of [{ prompt: '' }, { prompt: 'a'.repeat(5001) }, { prompt: 'a', background: 'transparent' as const }, { prompt: 'a', image: '/private/photo.jpg' }, { prompt: 'a', image: 'http://localhost/a.jpg' }]) {
      await expect(wanImageBackend.generate(req)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a decoded JPEG with actual provider and no billable token usage', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
    fetchMock.mockResolvedValueOnce(Response.json({ request_id: 'test-1', output: { finished: true, choices: [{ message: { content: [{ image: OUTPUT }] } }] }, usage: { image_count: 1, input_tokens: 1000, output_tokens: 2000 } }));
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(png)));
    const result = await wanImageBackend.generate({ prompt: 'A red mug.' });
    expect(result.provider).toBe('dashscope');
    expect(result).not.toHaveProperty('usage');
    expect(result.image).toMatch(/^data:image\/jpeg;base64,/);
    const metadata = await sharp(Buffer.from(result.image!.split(',')[1], 'base64')).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('headers');
  });

  it('redacts provider errors and does not resubmit', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'InvalidApiKey', message: `echo ${KEY}`, request_id: 'test-2' }, { status: 403 }));
    const error = await wanImageBackend.generate({ prompt: 'A mug.' }).catch(e => e);
    expect(error.message).toContain('HTTP 403');
    expect(error.message).toContain('test-2');
    expect(error.message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit an unknown network outcome', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`timeout ${KEY}`));
    await expect(wanImageBackend.generate({ prompt: 'A mug.' })).rejects.toThrow('provider status may be unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { usage: { image_count: 2 }, output: { choices: [{ message: { content: [{ image: OUTPUT }] } }] } },
    { output: { finished: false, choices: [{ message: { content: [{ image: OUTPUT }] } }] } },
    { output: { choices: [{ message: { content: [{ image: 'https://localhost/private' }] } }] } },
    { output: { choices: [] } },
  ])('rejects incomplete, extra or unsafe output without download/retry', async (data) => {
    fetchMock.mockResolvedValueOnce(Response.json(data));
    await expect(wanImageBackend.generate({ prompt: 'A mug.' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
