import { describe, expect, it } from 'vitest';
import { parseImageDataUrl } from '@/lib/supabase/storage';

describe('parseImageDataUrl', () => {
  it('parses multi-megabyte PNG data URLs without a whole-payload regex', () => {
    const payload = 'A'.repeat(8_000_000);
    const parsed = parseImageDataUrl(`data:image/png;base64,${payload}`);
    expect(parsed?.mimeType).toBe('image/png');
    expect(parsed?.base64Data.length).toBe(payload.length);
  });

  it('rejects non-image and non-base64 data URLs', () => {
    expect(parseImageDataUrl('data:text/plain;base64,AAAA')).toBeNull();
    expect(parseImageDataUrl('data:image/png,AAAA')).toBeNull();
  });
});
