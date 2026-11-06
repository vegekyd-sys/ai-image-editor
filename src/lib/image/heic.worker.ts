/// <reference lib="webworker" />
// Decodes HEIC/HEIF off the main thread with libheif 1.19 (handles modern
// iPhone profiles that heic2any's bundled libheif rejects) and re-encodes a
// resized JPEG. No network round-trip, no main-thread freeze.
// @ts-expect-error -- libheif-js ships no types for the bundled ESM build
import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

type LibheifImage = {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (out: { data: Uint8ClampedArray } | null) => void): void;
  free(): void;
};
type Libheif = { HeifDecoder: new () => { decode(buffer: Uint8Array): LibheifImage[]; decoder: { delete(): void } } };

let libheifPromise: Promise<Libheif> | null = null;
function getLibheif(): Promise<Libheif> {
  if (!libheifPromise) {
    libheifPromise = Promise.resolve(createLibheif()).then(async (lib: Libheif & { ready?: Promise<unknown> }) => {
      await lib.ready;
      return lib;
    });
  }
  return libheifPromise;
}

interface Request { id: number; buffer: ArrayBuffer; maxSize: number; quality: number }

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, buffer, maxSize, quality } = event.data;
  try {
    const libheif = await getLibheif();
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buffer));
    try {
      if (!images.length) throw new Error('HEIF image not found');
      const image = images[0];
      const width = image.get_width();
      const height = image.get_height();
      const pixels = await new Promise<Uint8ClampedArray>((resolve, reject) => {
        image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, out => {
          if (!out) reject(new Error('HEIF processing error'));
          else resolve(out.data);
        });
      });
      const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height));
      const scale = Math.min(1, maxSize / Math.max(width, height));
      const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      (self as unknown as Worker).postMessage({ id, blob });
    } finally {
      for (const image of images) image.free();
      decoder.decoder.delete();
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
