// @vitest-environment node
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { materializeRetakeKeyframe } from '@/lib/video-retake-keyframe';

it('awaits persistence of a same-turn PNG and supplies a real JPEG URL to the provider', async () => {
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff8800' } }).png().toBuffer();
  let metadata: sharp.Metadata | undefined;
  const persist = vi.fn(async (bytes: Buffer) => {
    metadata = await sharp(bytes).metadata();
    return 'https://example.com/retake-middle.jpg';
  });
  expect(await materializeRetakeKeyframe(`data:image/png;base64,${png.toString('base64')}`, persist)).toBe('https://example.com/retake-middle.jpg');
  expect(metadata).toMatchObject({ format: 'jpeg', width: 300, height: 300 });
  expect(persist).toHaveBeenCalledOnce();
});

it('does not let a failed image upload proceed as a provider input', async () => {
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ff8800' } }).png().toBuffer();
  await expect(materializeRetakeKeyframe(`data:image/png;base64,${png.toString('base64')}`, async () => '')).rejects.toThrow('No video submitted');
});
