import sharp from 'sharp';
import type { ImageBackground } from './types';
import { parseImageDataUrl } from './image-data-url';

/**
 * Preserve real alpha for explicit transparent-output requests. All other
 * requests retain Makaron's existing JPEG normalization behavior.
 */
export async function normalizeOpenAIImageOutput(
  dataUrl: string,
  background?: ImageBackground,
): Promise<string | null> {
  const data = parseImageDataUrl(dataUrl);
  if (!data) return null;
  const parsed = { mimeType: data.mimeType, buffer: Buffer.from(data.base64, 'base64') };

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
