// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { isPublicImageAddress, readProviderImage, validateProviderImages } from '@/lib/provider-image-preflight';
import { wanImageBackend } from '@/lib/models/wan-image';
import { createFalH3MaxVideoTask } from '@/lib/fal-h3-max-video';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function image(width: number, height: number, alpha = false) {
  return `data:image/png;base64,${(await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: 'red' } }).png().toBuffer()).toString('base64')}`;
}

it.each(['wan2.7-image', 'minimax-h3-max'] as const)('rejects the production 384x215 shape before %s submission', async model => {
  const source = await image(384, 215);
  const fetchMock = vi.fn();
  const reserve = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DASHSCOPE_API_KEY', 'test');
  vi.stubEnv('DASHSCOPE_API_HOST', 'ws-test.ap-southeast-1.maas.aliyuncs.com');
  const request = model === 'wan2.7-image' ? wanImageBackend.generate({ prompt: 'Preserve identity.', image: source })
    : createFalH3MaxVideoTask({ prompt: 'Wave.', images: [source], onBeforeSubmit: reserve });
  await expect(request).rejects.toThrow(`384x215; each dimension must be at least ${model === 'wan2.7-image' ? 240 : 256}px`);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(reserve).not.toHaveBeenCalled();
});

it('accepts exact lower boundaries and preserves input bytes', async () => {
  const wan = await image(240, 240);
  const h3 = await image(256, 256);
  await expect(validateProviderImages([wan], 'wan2.7-image')).resolves.toBeUndefined();
  await expect(validateProviderImages([h3], 'minimax-h3-max')).resolves.toBeUndefined();
  expect((await readProviderImage(wan, 1_000_000)).toString('base64')).toBe(wan.split(',')[1]);
});

it('checks every reference, aspect ratio, alpha and unreadable bytes', async () => {
  await expect(validateProviderImages([await image(256, 256), await image(384, 215)], 'wan2.7-image')).rejects.toThrow('image 2');
  await expect(validateProviderImages([await image(2400, 240)], 'wan2.7-image')).rejects.toThrow('1:8');
  await expect(validateProviderImages([await image(256, 256, true)], 'wan2.7-image')).rejects.toThrow('opaque PNG');
  await expect(validateProviderImages(['data:image/png;base64,YQ=='], 'wan2.7-image')).rejects.toThrow('could not be verified');
});

it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1'])('blocks non-public socket destination %s', address => {
  expect(isPublicImageAddress(address)).toBe(false);
});
it('accepts public addresses and blocks unsafe sources without networking', async () => {
  expect(isPublicImageAddress('8.8.8.8')).toBe(true);
  expect(isPublicImageAddress('2606:4700:4700::1111')).toBe(true);
  for (const source of ['http://example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:pass@example.com/a']) await expect(readProviderImage(source, 1000)).rejects.toThrow();
});
