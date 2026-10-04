import { describe, expect, it } from 'vitest';
import { mayContainAlpha, uploadCanvasMimeType } from '@/lib/image/compress';

describe('image alpha lifecycle', () => {
  it('keeps alpha-capable uploads out of the JPEG path', () => {
    for (const file of [
      { type: 'image/png', name: 'sticker.png' },
      { type: 'image/webp', name: 'sticker.webp' },
      { type: 'image/avif', name: 'sticker.avif' },
      { type: '', name: 'legacy.PNG' },
    ]) {
      expect(mayContainAlpha(file)).toBe(true);
      expect(uploadCanvasMimeType(file)).toBe('image/png');
    }
  });

  it('keeps JPEG and converted HEIC uploads on the compact opaque path', () => {
    expect(uploadCanvasMimeType({ type: 'image/jpeg', name: 'photo.jpg' })).toBe('image/jpeg');
    expect(uploadCanvasMimeType({ type: 'image/jpeg', name: 'photo.heic.jpg' })).toBe('image/jpeg');
  });
});
