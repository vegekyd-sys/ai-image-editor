import { getTransparencyCrossOrigin } from './transparency';

export interface DecodedImageSize { width: number; height: number }
const pending = new Map<string, Promise<DecodedImageSize>>();
const ready = new Map<string, DecodedImageSize>();
const MAX_IMAGES = 32;

export function getDecodedImageSize(source: string): DecodedImageSize | undefined { return ready.get(source); }

/** Share fetch/decode work across nearby preloads, canvas and CUI; retain metadata, not bitmaps. */
export function preloadDecodedImage(source: string): Promise<DecodedImageSize> {
  const cached = ready.get(source); if (cached) return Promise.resolve(cached);
  const active = pending.get(source); if (active) return active;
  const request = (async () => {
    const image = new Image();
    const crossOrigin = getTransparencyCrossOrigin(source); if (crossOrigin) image.crossOrigin = crossOrigin;
    image.decoding = 'async'; image.src = source;
    await image.decode();
    if (!image.naturalWidth) throw new Error('Image did not decode');
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    ready.set(source, size);
    if (ready.size > MAX_IMAGES) ready.delete(ready.keys().next().value!);
    return size;
  })();
  pending.set(source, request);
  void request.then(() => pending.delete(source), () => pending.delete(source));
  return request;
}
