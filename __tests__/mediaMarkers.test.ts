import { describe, expect, it } from 'vitest';
import { resolveMediaMarkersInString, resolveMediaMarkersInValue } from '@/lib/media-markers';

describe('Media Index marker resolution', () => {
  const media = Array.from({ length: 10 }, (_, index) => `https://cdn.example.com/media-${index + 1}.jpg`);

  it('maps 1-based media markers to zero-based storage without shifting', () => {
    const code = 'const images = ["<<<media_1>>>", "<<<media_10>>>"];';

    expect(resolveMediaMarkersInString(code, media)).toBe(
      'const images = ["https://cdn.example.com/media-1.jpg", "https://cdn.example.com/media-10.jpg"];'
    );
  });

  it('resolves nested composition props and leaves invalid markers for validation', () => {
    expect(resolveMediaMarkersInValue({
      scenes: [{ src: '<<<media_2>>>' }, { src: '<<<media_10>>>' }],
      missing: '<<<media_11>>>',
    }, media)).toEqual({
      scenes: [{ src: media[1] }, { src: media[9] }],
      missing: '<<<media_11>>>',
    });
  });
});
