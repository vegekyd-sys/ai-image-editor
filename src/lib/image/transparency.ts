import { isPermanentUrl } from '@/lib/supabase/storage';

export type ImageTransparency = 'opaque' | 'transparent' | 'unavailable';

const transparencyCache = new Map<string, ImageTransparency>();
const SAMPLE_EDGE = 160;

/**
 * Public Supabase images opt into anonymous CORS so their decoded pixels can be
 * inspected. Unknown third-party URLs deliberately keep the browser's default
 * image behavior: adding crossOrigin to a CDN without CORS can stop it rendering.
 */
export function getTransparencyCrossOrigin(source: string): 'anonymous' | undefined {
  return isPermanentUrl(source) ? 'anonymous' : undefined;
}

export function getCachedImageTransparency(source: string): ImageTransparency | undefined {
  return transparencyCache.get(source);
}

export function hasTransparentPixel(data: ArrayLike<number>): boolean {
  for (let alphaIndex = 3; alphaIndex < data.length; alphaIndex += 4) {
    if (data[alphaIndex] < 255) return true;
  }
  return false;
}

function isDefinitelyOpaqueSource(source: string): boolean {
  if (/^data:image\/jpe?g;/i.test(source)) return true;

  try {
    const { pathname } = new URL(source, 'https://makaron.local');
    return /\.jpe?g$/i.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Inspect a small decoded copy of the rendered image. This never mutates the
 * source image: the canvas exists only for alpha detection and is discarded.
 */
export function detectImageTransparency(
  image: HTMLImageElement,
  source: string,
): ImageTransparency {
  const cached = transparencyCache.get(source);
  if (cached) return cached;

  if (isDefinitelyOpaqueSource(source)) {
    transparencyCache.set(source, 'opaque');
    return 'opaque';
  }

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return 'unavailable';

  try {
    const ratio = Math.min(1, SAMPLE_EDGE / Math.max(width, height));
    const sampleWidth = Math.max(1, Math.round(width * ratio));
    const sampleHeight = Math.max(1, Math.round(height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 'unavailable';

    context.clearRect(0, 0, sampleWidth, sampleHeight);
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const result: ImageTransparency = hasTransparentPixel(pixels) ? 'transparent' : 'opaque';
    transparencyCache.set(source, result);
    return result;
  } catch {
    // A third-party image without readable CORS pixels can still be displayed.
    // Fail closed so an ordinary image is never mislabeled as transparent.
    transparencyCache.set(source, 'unavailable');
    return 'unavailable';
  }
}

export function clearImageTransparencyCacheForTests(): void {
  transparencyCache.clear();
}
