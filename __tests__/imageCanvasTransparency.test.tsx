import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TransparencyBackdrop from '@/components/TransparencyBackdrop';
import {
  clearImageTransparencyCacheForTests,
  detectImageTransparency,
  getCachedImageTransparency,
  getTransparencyCrossOrigin,
  hasTransparentPixel,
} from '@/lib/image/transparency';

afterEach(() => clearImageTransparencyCacheForTests());

describe('ImageCanvas transparency presentation', () => {
  it('distinguishes real alpha from an opaque RGBA image', () => {
    expect(hasTransparentPixel(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]))).toBe(false);
    expect(hasTransparentPixel(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 0,
    ]))).toBe(true);
  });

  it('treats JPEG sources as opaque without risking a false transparency label', () => {
    const image = { naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement;
    expect(detectImageTransparency(image, 'data:image/jpeg;base64,abc')).toBe('opaque');
    expect(getCachedImageTransparency('data:image/jpeg;base64,abc')).toBe('opaque');
  });

  it('requests readable CORS pixels only for permanent Supabase images', () => {
    expect(getTransparencyCrossOrigin('https://example.supabase.co/storage/v1/object/public/images/a.png')).toBe('anonymous');
    expect(getTransparencyCrossOrigin('data:image/png;base64,abc')).toBeUndefined();
    expect(getTransparencyCrossOrigin('https://third-party.example/image.png')).toBeUndefined();
  });

  it('renders a separate checkerboard layer constrained to the decoded image rect', () => {
    const { rerender } = render(<TransparencyBackdrop rect={{ l: 12, t: 24, w: 320, h: 180 }} />);

    const backdrop = screen.getByTestId('transparency-backdrop');
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.style.left).toBe('12px');
    expect(backdrop.style.top).toBe('24px');
    expect(backdrop.style.width).toBe('320px');
    expect(backdrop.style.height).toBe('180px');
    expect(backdrop.style.backgroundImage).toContain('linear-gradient');
    expect(backdrop.style.backgroundSize).toBe('22px 22px');
    expect(backdrop.className).toContain('pointer-events-none');

    rerender(<TransparencyBackdrop compact />);
    expect(screen.getByTestId('transparency-backdrop').style.backgroundSize).toBe('16px 16px');
  });
});
