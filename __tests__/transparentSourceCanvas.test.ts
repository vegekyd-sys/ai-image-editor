import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fitTransparentResultToSourceCanvas } from '@/lib/models/transparent-source-canvas';

function dataUrl(bytes: Buffer, mime = 'image/png') {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

describe('fitTransparentResultToSourceCanvas', () => {
  it('restores source dimensions with transparent padding and no crop or stretch', async () => {
    const source = await sharp({
      create: { width: 120, height: 160, channels: 3, background: '#446688' },
    }).png().toBuffer();
    const generated = await sharp({
      create: { width: 100, height: 150, channels: 4, background: '#ff00ffff' },
    }).png().toBuffer();

    const result = await fitTransparentResultToSourceCanvas(dataUrl(source), dataUrl(generated));
    const bytes = Buffer.from(result.replace(/^data:image\/png;base64,/, ''), 'base64');
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(120);
    expect(info.height).toBe(160);
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(0, 80)).toBe(0);
    expect(alphaAt(59, 0)).toBe(255);
    expect(alphaAt(59, 159)).toBe(255);
    expect(alphaAt(119, 80)).toBe(0);
  });
});
