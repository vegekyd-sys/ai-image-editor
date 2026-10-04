import { describe, expect, it } from 'vitest';
import { normalizeGenerateImageMediaIndex } from '@/lib/generate-image-input';

describe('normalizeGenerateImageMediaIndex', () => {
  it('treats GPT-5.6 zero-filled optional input as text-to-image omission', () => {
    expect(normalizeGenerateImageMediaIndex(0)).toBeUndefined();
    expect(normalizeGenerateImageMediaIndex(undefined)).toBeUndefined();
  });

  it('preserves real and invalid non-zero indices for normal validation', () => {
    expect(normalizeGenerateImageMediaIndex(1)).toBe(1);
    expect(normalizeGenerateImageMediaIndex(7)).toBe(7);
    expect(normalizeGenerateImageMediaIndex(-1)).toBe(-1);
  });
});
