import { describe, expect, it } from 'vitest';
import { imageExportDimensions, exportImageDownload } from '@/lib/editor/image-export';

describe('browser image save dimensions and original contract', () => {
  it('preserves the native 4K canvas, proportions for smaller copies, and never upscales', () => {
    const info = { width: 3840, height: 2160, mimeType: 'image/png' };
    expect(imageExportDimensions(info, 'original')).toEqual({ width: 3840, height: 2160 });
    expect(imageExportDimensions(info, '2k')).toEqual({ width: 2048, height: 1152 });
    expect(imageExportDimensions(info, 'share')).toEqual({ width: 1280, height: 720 });
    expect(imageExportDimensions({ ...info, width: 512, height: 384 }, '2k')).toEqual({ width: 512, height: 384 });
  });
  it('returns the exact original bytes when size and format are unchanged', async () => {
    const asset = { blob: new Blob(['original supplier bytes'], { type: 'image/png' }), filename: '4k.png', kind: 'image' as const };
    expect(await exportImageDownload(asset, { width: 4096, height: 4096, mimeType: 'image/png' }, 'original', 'original')).toBe(asset);
  });
});
