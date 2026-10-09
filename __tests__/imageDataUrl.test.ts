import { describe, expect, it } from 'vitest';
import { isImageBase64, parseImageDataUrl } from '@/lib/models/image-data-url';

describe('large provider image payloads', () => {
  it('validates multi-megabyte base64 and rejects invalid suffixes without a regex stack overflow', () => {
    const base64 = Buffer.alloc(14 * 1024 * 1024, 37).toString('base64');
    expect(isImageBase64(base64)).toBe(true);
    expect(isImageBase64(`${base64}!`)).toBe(false);
    expect(parseImageDataUrl(`data:image/png;base64,${base64}`)?.base64.length).toBe(base64.length);
    expect(parseImageDataUrl(`data:image/png;base64,${base64}!`)).toBeNull();
    expect(parseImageDataUrl('data:text/html;base64,AAAA')).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
  });
});
