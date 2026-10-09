import sharp from 'sharp';
import { readProviderImage } from './provider-image-preflight';

/** Persist same-turn image output before passing it to a URL-only video provider. */
export async function materializeRetakeKeyframe(
  source: string,
  persist: (jpeg: Buffer) => Promise<string>,
): Promise<string> {
  if (!source.startsWith('data:')) return source;
  const bytes = await readProviderImage(source, 30 * 1024 * 1024);
  const jpeg = await sharp(bytes, { failOn: 'error', limitInputPixels: 64_000_000 }).jpeg({ quality: 95 }).toBuffer();
  const url = await persist(jpeg);
  if (!url.startsWith('https://')) throw new Error('Could not persist the checked Retake keyframe. No video submitted.');
  return url;
}
