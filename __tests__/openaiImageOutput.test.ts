import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeOpenAIImageOutput } from '@/lib/models/openai-image-output';

async function dataUrl(
  format: 'png' | 'webp' | 'jpeg',
  alpha: number,
): Promise<string> {
  const base = sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 217, g: 70, b: 239, alpha: alpha / 255 },
    },
  });
  const buffer = format === 'png'
    ? await base.png().toBuffer()
    : format === 'webp'
      ? await base.webp().toBuffer()
      : await base.jpeg().toBuffer();
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

describe('GPT Image 2 output normalization', () => {
  it('preserves a PNG with real transparency', async () => {
    const input = await dataUrl('png', 0);
    const output = await normalizeOpenAIImageOutput(input, 'transparent');
    expect(output).toBe(input);
  });

  it('preserves a WebP with real transparency', async () => {
    const input = await dataUrl('webp', 80);
    const output = await normalizeOpenAIImageOutput(input, 'transparent');
    expect(output).toBe(input);
  });

  it('preserves real transparency when GPT Image 2 auto-selects it', async () => {
    const input = await dataUrl('png', 0);
    expect(await normalizeOpenAIImageOutput(input, 'auto')).toBe(input);
  });

  it('rejects opaque or JPEG responses for transparent requests', async () => {
    expect(await normalizeOpenAIImageOutput(await dataUrl('png', 255), 'transparent')).toBeNull();
    expect(await normalizeOpenAIImageOutput(await dataUrl('jpeg', 0), 'transparent')).toBeNull();
  });

  it('keeps the existing JPEG normalization for normal requests', async () => {
    const output = await normalizeOpenAIImageOutput(await dataUrl('png', 0));
    expect(output).toMatch(/^data:image\/jpeg;base64,/);
  });
});
