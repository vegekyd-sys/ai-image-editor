// @vitest-environment node
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { inferLayerizeStack } from '@/lib/layerize-reconstruction';
import { prepareLayerizeSource } from '@/lib/layerize-source';
import { buildLayerizeDesign } from '@/lib/layerize-design';

const png = (width: number, height: number, color: string) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
describe('Layerize source reconstruction', () => {
  it('normalizes EXIF pixel orientation before provider submission, preserving the original buffer', async () => {
    const input = await sharp(await png(90, 60, '#ff0000')).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const prepared = await prepareLayerizeSource(input);
    expect(prepared).toMatchObject({ normalized: true, width: 60, height: 90 });
    expect(await sharp(prepared.bytes).metadata()).toMatchObject({ width: 60, height: 90 });
    expect((await sharp(prepared.bytes).metadata()).orientation).toBeUndefined();
    expect((await sharp(input).metadata()).orientation).toBe(6);
  });

  it('uses visible source overlap to restore an occluded object, and preserves already-correct order', async () => {
    const bg = await png(100, 100, '#ffffff'), hat = await png(60, 30, '#ff0000'), head = await png(60, 70, '#0000ff');
    const source = await sharp(bg).composite([{ input: head, left: 20, top: 25 }, { input: hat, left: 20, top: 10 }]).png().toBuffer();
    const layers = [{ z: 0, bounds: [0, 0, 100, 100] as [number, number, number, number], bytes: bg },
      { z: 1, bounds: [20, 10, 80, 40] as [number, number, number, number], bytes: hat },
      { z: 2, bounds: [20, 25, 80, 95] as [number, number, number, number], bytes: head }];
    const result = await inferLayerizeStack(source, 100, 100, layers);
    expect(result).toMatchObject({ changed: true, order: [0, 2, 1], scoreAfter: 0 });
    expect(result.scoreBefore).toBeGreaterThan(0);
    const ordered = await inferLayerizeStack(source, 100, 100, [layers[0], { ...layers[2], z: 1 }, { ...layers[1], z: 2 }]);
    expect(ordered).toMatchObject({ changed: false, order: [0, 1, 2], scoreBefore: 0 });
    const design = buildLayerizeDesign({ version: 1, taskId: 'task', sourceSha256: 'sha', supplierCostUsd: .1,
      width: 100, height: 100, stackOrder: result.order,
      layers: layers.map(({ z, bounds }) => ({ z, bounds, width: 100, height: 100, url: `https://example.com/${z}.png`, name: String(z) })) });
    expect(design.props?._layerState).toEqual({ order: ['layer_0', 'layer_2', 'layer_1'], deleted: [] });
    expect(design.code.indexOf('props.layer_2')).toBeLessThan(design.code.indexOf('props.layer_1'));
  });
});
