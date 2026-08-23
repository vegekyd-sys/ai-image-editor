import sharp from 'sharp';
import type { ImageBackground } from './types';

function parseImageDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
}

/**
 * Preserve real alpha for explicit transparent-output requests. All other
 * requests retain Makaron's existing JPEG normalization behavior.
 */
export async function normalizeOpenAIImageOutput(
  dataUrl: string,
  background?: ImageBackground,
): Promise<string | null> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;

  if (background === 'transparent' || background === 'auto') {
    const metadata = await sharp(parsed.buffer, { failOn: 'error' }).metadata();
    const supportsAlpha = (metadata.format === 'png' || metadata.format === 'webp') && metadata.hasAlpha;
    if (supportsAlpha) {
      const stats = await sharp(parsed.buffer, { failOn: 'error' }).stats();
      const alpha = stats.channels[3];
      if (alpha && alpha.min < 255) {
        const mimeType = metadata.format === 'webp' ? 'image/webp' : 'image/png';
        return `data:${mimeType};base64,${parsed.buffer.toString('base64')}`;
      }
    }

    if (background === 'transparent') return null;
  }

  if (parsed.mimeType === 'image/jpeg') return dataUrl;
  const jpegBuffer = await sharp(parsed.buffer).jpeg({ quality: 95 }).toBuffer();
  return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
}
