// @vitest-environment node
import { it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareElementImage, finishElementImage } from '@/lib/selected-element';
const data = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;
it('keeps every pixel outside an edited region and the original asset canvas, including transparency', async () => {
  const source = await sharp({ create: { width: 30, height: 40, channels: 4, background: { r: 20, g: 70, b: 130, alpha: .5 } } }).png().toBuffer();
  const prepared = await prepareElementImage(data(source), { x: 5, y: 8, width: 10, height: 12 });
  const generated = await sharp({ create: { width: 100, height: 120, channels: 4, background: '#ff0066ff' } }).png().toBuffer();
  const output = await finishElementImage(prepared, data(generated));
  const original = await sharp(source).raw().toBuffer(), result = await sharp(output).raw().toBuffer();
  expect(await sharp(output).metadata()).toMatchObject({ width: 30, height: 40, hasAlpha: true });
  for (let y = 0; y < 40; y++) for (let x = 0; x < 30; x++) {
    const i = (y * 30 + x) * 4;
    if (x < 5 || x >= 15 || y < 8 || y >= 20) expect(result.subarray(i, i + 4)).toEqual(original.subarray(i, i + 4));
    else expect([...result.subarray(i, i + 4)]).toEqual([255, 0, 102, 255]);
  }
});
it('rejects a region outside the source before a provider can be called', async () => {
  const source = await sharp({ create: { width: 30, height: 40, channels: 4, background: '#00000000' } }).png().toBuffer();
  await expect(prepareElementImage(data(source), { x: 29, y: 0, width: 3, height: 3 })).rejects.toThrow('must fit');
});
it('keeps an opaque RGBA photo opaque instead of requesting background removal', async () => {
  const source = await sharp({ create: { width: 30, height: 40, channels: 4, background: '#335577ff' } }).png().toBuffer();
  expect((await prepareElementImage(data(source))).hasAlpha).toBe(false);
});
it('fills missing transparent parts while copying every existing pixel, including alpha edges', async () => {
  const width = 30, height = 40, pixels = Buffer.alloc(width * height * 4);
  for (let y = 5; y < 15; y++) for (let x = 8; x < 20; x++) pixels.set([20, 70, 130, x === 8 ? 100 : 255], (y * width + x) * 4);
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const generated = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 12, height: 25, channels: 4, background: '#ff0066ff' } }).png().toBuffer(), left: 8, top: 5 }]).png().toBuffer();
  const prepared = await prepareElementImage(data(source));
  const output = await finishElementImage(prepared, data(generated), { completeOccluded: true });
  const result = await sharp(output).raw().toBuffer();
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) expect(result.subarray(i, i + 4)).toEqual(pixels.subarray(i, i + 4));
  expect(result[(20 * width + 12) * 4 + 3]).toBe(255);
  expect(result[3]).toBe(0);
  const opaque = await sharp({ create: { width, height, channels: 4, background: '#ffffffff' } }).png().toBuffer();
  await expect(finishElementImage(prepared, data(opaque), { completeOccluded: true })).rejects.toThrow('transparent background');
});
