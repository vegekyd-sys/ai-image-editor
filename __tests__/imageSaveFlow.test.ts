import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trySaveSmallImage } from '@/lib/editor/image-save';
import type { DownloadAssetParams, PreparedDownloadCache } from '@/lib/editor/download';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), save: vi.fn(), access: vi.fn(), inspect: vi.fn(), watermark: vi.fn(), export: vi.fn() }));
vi.mock('@/lib/editor/download', () => ({ prepareDownloadAsset: mocks.prepare, savePreparedDownload: mocks.save, checkMediaDownload: mocks.access }));
vi.mock('@/lib/editor/image-export', () => ({ inspectImageExport: mocks.inspect, exportImageDownload: mocks.export }));
vi.mock('@/lib/editor/web-watermark', () => ({ watermarkImage: mocks.watermark }));
const original = { blob: new Blob(['original'], { type: 'image/png' }), filename: 'image.png', kind: 'image' };
const marked = new Blob(['marked'], { type: 'image/png' });
const cache = {} as PreparedDownloadCache;
function params() { return { setIsSaving: vi.fn(), setAgentStatus: vi.fn(), showSaveToast: vi.fn(), t: (key: string) => key } as unknown as DownloadAssetParams; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue(original);mocks.save.mockResolvedValue(undefined);
  mocks.inspect.mockResolvedValue({ width: 1024, height: 768, mimeType: 'image/png' });
  mocks.access.mockResolvedValue(true);mocks.watermark.mockResolvedValue(marked);
  mocks.export.mockImplementation(async asset => asset);
});
describe('GUI image save entry', () => {
  it.each([[1024, 768], [1280, 720], [720, 1280], [1024, 1024], [1536, 1024], [1024, 1536], [2928, 352], [352, 2928], [1920, 1080], [2048, 1024], [1024, 2048]])('saves ordinary %sx%s originals directly without entitlement calls', async (width, height) => {
    mocks.inspect.mockResolvedValue({ width, height, mimeType: 'image/png' });
    const request = params();
    expect(await trySaveSmallImage(request, cache, false)).toBe(true);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(original);
    expect(mocks.access).not.toHaveBeenCalled();expect(mocks.watermark).not.toHaveBeenCalled();
    expect(request.showSaveToast).toHaveBeenCalledOnce();expect(request.setIsSaving).toHaveBeenLastCalledWith(false);
  });
  it.each([[2049, 1024], [1024, 2049], [2048, 1152], [2048, 2048], [4096, 4096], [1856, 2304], [3712, 4608], [5856, 704], [704, 5856]])('opens size choices for large %sx%s without saving yet', async (width, height) => {
    mocks.inspect.mockResolvedValue({ width, height, mimeType: 'image/png' });
    const request = params();
    expect(await trySaveSmallImage(request, cache, true)).toBe(false);
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(request, cache);
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.access).not.toHaveBeenCalled();
    expect(request.setIsSaving).toHaveBeenLastCalledWith(false);
  });
  it('still saves an uninspectable original directly', async () => {
    mocks.inspect.mockRejectedValue(new Error('Decoder unavailable'));
    expect(await trySaveSmallImage(params(), cache, false)).toBe(true);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(original);
  });
  it('preserves free native image watermarking during direct saves', async () => {
    mocks.access.mockResolvedValue(false);
    expect(await trySaveSmallImage(params(), cache, true)).toBe(true);
    expect(mocks.watermark).toHaveBeenCalledExactlyOnceWith(original.blob);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ blob: marked }));
  });
  it('saves a paid native original without watermarking', async () => {
    expect(await trySaveSmallImage(params(), cache, true)).toBe(true);
    expect(mocks.access).toHaveBeenCalledOnce();expect(mocks.watermark).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(original);
  });
  it('resets busy state after a failed download, without a success toast', async () => {
    mocks.save.mockRejectedValue(new Error('Download failed'));
    const request = params();
    await expect(trySaveSmallImage(request, cache, false)).rejects.toThrow('Download failed');
    expect(request.setIsSaving).toHaveBeenLastCalledWith(false);expect(request.showSaveToast).not.toHaveBeenCalled();
  });
});
