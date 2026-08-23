import { describe, expect, it } from 'vitest';
import { normalizeImageFilename } from '@/lib/supabase/storage';

describe('image storage filenames', () => {
  it('keeps the storage extension aligned with the actual image MIME type', () => {
    expect(normalizeImageFilename('snapshot-1.jpg', 'image/png')).toBe('snapshot-1.png');
    expect(normalizeImageFilename('snapshot-1.jpg', 'image/webp')).toBe('snapshot-1.webp');
    expect(normalizeImageFilename('snapshot-1.png', 'image/jpeg')).toBe('snapshot-1.jpg');
    expect(normalizeImageFilename('snapshot-1', 'image/png')).toBe('snapshot-1.png');
  });
});
