import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createContactSheet, renderContactSheetLabelSvg } from '@/lib/contact-sheet';

describe('composition contact sheet', () => {
  it('combines representative frames into one labeled review image', async () => {
    const colors = ['#ef4444', '#22c55e', '#3b82f6'];
    const frames = await Promise.all(colors.map(async (background, index) => ({
      image: await sharp({
        create: { width: 640, height: 360, channels: 3, background },
      }).jpeg().toBuffer(),
      label: `#${index + 1} ${index * 3}s`,
    })));

    const sheet = await createContactSheet(frames, 640, 360);
    const metadata = await sharp(sheet).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1440);
    expect(metadata.height).toBe(304);
  });

  it('requires at least two frames for comparative review', async () => {
    const image = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000000' },
    }).jpeg().toBuffer();

    await expect(createContactSheet([{ image, label: 'only' }], 10, 10))
      .rejects.toThrow('at least two frames');
  });

  it('renders labels without relying on server fonts', () => {
    const svg = renderContactSheetLabelSvg('#1  frame 0  0.0s', 203, 34).toString();

    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('font-family');
    expect(svg).not.toContain('Arial');
    expect(svg).toContain('fill="#f3f3f5"');
  });

  it('keeps all eight evidence frames readable in chronological rows', async () => {
    const colors = [30, 55, 80, 105, 130, 155, 180, 205];
    const frames = await Promise.all(colors.map(async (value, index) => ({
      image: await sharp({ create: { width: 640, height: 360, channels: 3,
        background: { r: value, g: value, b: value } } }).png().toBuffer(),
      label: `#${index + 1} ${index}s : ${index}s`,
    })));
    const sheet = await createContactSheet(frames, 640, 360, { columns: 4 });
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1920, 608]);
    for (let index = 0; index < 8; index++) {
      const x = index % 4 * 480 + 240;
      const y = Math.floor(index / 4) * 304 + 135;
      expect(Math.abs(data[(y * info.width + x) * info.channels] - colors[index])).toBeLessThan(3);
    }
  });
});
