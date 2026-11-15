// @vitest-environment node
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { recoverLayerizeShadows } from '@/lib/layerize-shadows';

const width = 96, height = 80;
const png = (w: number, h: number, background: string) =>
  sharp({ create: { width: w, height: h, channels: 4, background } }).png().toBuffer();
it('moves only connected source darkening with the object and preserves its original pixels', async () => {
  const blank = await png(width, height, '#00000000');
  const plate = await png(width, height, '#cccccc');
  const object = await sharp(blank).composite([{ input: await png(34, 40, '#dd3311'), left: 16, top: 18 }]).png().toBuffer();
  const source = await sharp(plate).composite([
    { input: await png(15, 32, '#666666'), left: 50, top: 21 },
    { input: await png(10, 10, '#555555'), left: 81, top: 65 },
    { input: object },
  ]).png().toBuffer();
  const asset = { width, height, bounds: [0, 0, width, height] as [number, number, number, number], canCast: true };
  const stack = [{ ...asset, z: 0, bytes: plate }, { ...asset, z: 1, bytes: object }];
  const result = await recoverLayerizeShadows(source, width, height, stack);
  const bytes = await sharp(result.get(1)!).raw().toBuffer();
  const at = (x: number, y: number) => bytes.subarray((y * width + x) * 4, (y * width + x + 1) * 4);
  expect([...at(25, 32)]).toEqual([221, 51, 17, 255]);
  expect(at(56, 32)[3]).toBeCloseTo(128, -1);
  expect(at(85, 70)[3]).toBe(0);
  expect((await recoverLayerizeShadows(await sharp(plate).composite([{ input: object }]).png().toBuffer(), width, height, stack)).size).toBe(0);
  expect((await recoverLayerizeShadows(source, width, height, [stack[0], { ...stack[1], canCast: false }])).size).toBe(0);
});
