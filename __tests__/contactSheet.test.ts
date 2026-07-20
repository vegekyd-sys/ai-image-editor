import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createContactSheet } from '@/lib/contact-sheet';

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
});
