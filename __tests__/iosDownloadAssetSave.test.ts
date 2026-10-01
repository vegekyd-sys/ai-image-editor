import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMediaDownload, downloadAsset, getDownloadAssetPreview, prepareDownloadAsset, PreparedDownloadCache, savePreparedDownload, trySavePaidDownload } from '@/lib/editor/download';
import type { LocaleContextValue } from '@/lib/i18n';
import {
  isNativePhotoLibrarySaveAvailable,
  saveBlobToNativePhotoLibrary,
  saveUrlToNativePhotoLibrary,
} from '@/lib/native-media';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

vi.mock('@/lib/native-media', () => ({
  isNativePhotoLibrarySaveAvailable: vi.fn(() => true),
  saveBlobToNativePhotoLibrary: vi.fn(() => Promise.resolve()),
  saveUrlToNativePhotoLibrary: vi.fn(() => Promise.resolve()),
}));

function makeParams(overrides: Partial<Parameters<typeof downloadAsset>[0]> = {}): Parameters<typeof downloadAsset>[0] {
  const t = ((key: string) => key) as LocaleContextValue['t'];
  return {
    timeline: ['https://cdn.makaron.app/image.jpg'],
    viewIndex: 0,
    isViewingVideo: false,
    currentVideoUrl: null,
    draftParentIndex: null,
    snapshotsRef: { current: [] },
    pendingVideoRef: { current: null },
    setIsSaving: vi.fn(),
    setAgentStatus: vi.fn(),
    showSaveToast: vi.fn(),
    t,
    projectTitle: 'My Project',
    ...overrides,
  };
}

describe('iOS editor image save flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativePhotoLibrarySaveAvailable).mockReturnValue(true);
    vi.mocked(saveBlobToNativePhotoLibrary).mockResolvedValue(undefined);
    vi.mocked(saveUrlToNativePhotoLibrary).mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    vi.unstubAllGlobals();
  });

  it.each([true, false])('returns server-confirmed paid download access: %s', async (paid) => {
    const result = { paid };
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal('fetch', request);

    expect(await checkMediaDownload()).toBe(paid);
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/media/unlock', { cache: 'no-store' });
  });

  it('does not treat a malformed access response as an unlocked original', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://example.test/original' }) }));
    await expect(checkMediaDownload()).rejects.toThrow('Invalid media download');
  });

  it.each([false, true])('directly saves a paid original with native=%s and reuses the cache', async (native) => {
    vi.mocked(isNativePhotoLibrarySaveAvailable).mockReturnValue(native);
    const blob = new Blob(['original'], { type: 'image/png' });
    const request = vi.fn(async (url: string) => url === '/api/media/unlock'
      ? { ok: true, json: async () => ({ paid: true }) }
      : { ok: true, blob: async () => blob });
    vi.stubGlobal('fetch', request);
    const createUrl = vi.fn(() => 'blob:original');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const params = makeParams();
      const cache = new PreparedDownloadCache();
      expect(await trySavePaidDownload(params, cache)).toBe(true);
      expect(await trySavePaidDownload(params, cache)).toBe(true);
      expect(request.mock.calls.filter(([url]) => url !== '/api/media/unlock')).toHaveLength(1);
      if (native) {
        expect(saveBlobToNativePhotoLibrary).toHaveBeenCalledWith(blob, expect.stringMatching(/\.png$/), 'image');
        expect(saveBlobToNativePhotoLibrary).toHaveBeenCalledTimes(2);
        expect(click).not.toHaveBeenCalled();
      } else {
        expect(createUrl).toHaveBeenCalledWith(blob);
        expect(click).toHaveBeenCalledTimes(2);
      }
      expect(params.showSaveToast).toHaveBeenCalledTimes(2);
      expect(params.setIsSaving).toHaveBeenLastCalledWith(false);
    } finally { click.mockRestore(); }
  });

  it.each(['image', 'video'] as const)('saves prepared %s bytes to native Photos without a web download', async (kind) => {
    const blob = new Blob(['prepared watermarked content'], { type: kind === 'image' ? 'image/png' : 'video/mp4' });
    const filename = kind === 'image' ? 'marked.png' : 'marked.mp4';
    await savePreparedDownload({ blob, kind, filename });
    expect(saveBlobToNativePhotoLibrary).toHaveBeenCalledExactlyOnceWith(blob, filename, kind);
    expect(saveUrlToNativePhotoLibrary).not.toHaveBeenCalled();
  });

  it('propagates a failed native save instead of silently downloading an unmarked source', async () => {
    vi.mocked(saveBlobToNativePhotoLibrary).mockRejectedValueOnce(new Error('Photos denied'));
    await expect(savePreparedDownload({ blob: new Blob(['marked']), filename: 'marked.mp4', kind: 'video' }))
      .rejects.toThrow('Photos denied');
    expect(saveUrlToNativePhotoLibrary).not.toHaveBeenCalled();
  });

  it('leaves unpaid users on the preview path without downloading', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ paid: false }) });
    vi.stubGlobal('fetch', request);
    const params = makeParams();
    expect(await trySavePaidDownload(params)).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(params.showSaveToast).not.toHaveBeenCalled();
    expect(params.setIsSaving).toHaveBeenLastCalledWith(false);
  });

  it('does not save directly when access changes during preparation', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ paid: true }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['original']) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ paid: false }) }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      const params = makeParams();
      expect(await trySavePaidDownload(params)).toBe(false);
      expect(click).not.toHaveBeenCalled();
      expect(params.showSaveToast).not.toHaveBeenCalled();
    } finally { click.mockRestore(); }
  });

  it('fails closed and resets the saving state when access cannot be verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const params = makeParams();
    await expect(trySavePaidDownload(params)).rejects.toThrow('offline');
    expect(params.setIsSaving).toHaveBeenLastCalledWith(false);
    expect(params.showSaveToast).not.toHaveBeenCalled();
  });

  it('saves remote images through native Photos URL save before fetching blobs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const params = makeParams();

    await downloadAsset(params);

    expect(saveUrlToNativePhotoLibrary).toHaveBeenCalledWith(
      'https://cdn.makaron.app/image.jpg',
      'makaron-my-project-1.jpg',
      'image',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveBlobToNativePhotoLibrary).not.toHaveBeenCalled();
    expect(params.setAgentStatus).toHaveBeenCalledWith('Saving to Photos...');
    expect(params.setAgentStatus).toHaveBeenCalledWith('editor.done');
    expect(params.showSaveToast).toHaveBeenCalledTimes(1);
  });

  it('falls back to native blob save when native URL save fails', async () => {
    vi.mocked(saveUrlToNativePhotoLibrary).mockRejectedValueOnce(new Error('url save failed'));
    const imageBlob = new Blob(['jpeg'], { type: 'image/jpeg' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      blob: async () => imageBlob,
    })));
    const params = makeParams();

    await downloadAsset(params);

    expect(saveUrlToNativePhotoLibrary).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://cdn.makaron.app/image.jpg');
    expect(saveBlobToNativePhotoLibrary).toHaveBeenCalledWith(
      imageBlob,
      'makaron-my-project-1.jpg',
      'image',
    );
    expect(params.setAgentStatus).toHaveBeenCalledWith('Native save failed, trying fallback...');
    expect(params.setAgentStatus).toHaveBeenCalledWith('editor.done');
    expect(params.showSaveToast).toHaveBeenCalledTimes(1);
  });

  it('saves the original transparent PNG instead of the transformed timeline preview', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const params = makeParams({
      timeline: ['https://example.supabase.co/storage/v1/render/image/public/images/u/p/sticker.png?width=2000'],
      snapshotsRef: {
        current: [{
          id: 'snap-alpha',
          image: '',
          imageUrl: 'https://example.supabase.co/storage/v1/object/public/images/u/p/sticker.png',
          tips: [],
          messageId: '',
          metadata: { imageMimeType: 'image/png', hasAlpha: true, generationBackground: 'transparent' },
        }],
      },
    });

    await downloadAsset(params);

    expect(saveUrlToNativePhotoLibrary).toHaveBeenCalledWith(
      'https://example.supabase.co/storage/v1/object/public/images/u/p/sticker.png',
      'makaron-my-project-1.png',
      'image',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saves remote videos through native Photos URL save before proxying downloads', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const params = makeParams({
      isViewingVideo: true,
      currentVideoUrl: 'https://cdn.makaron.app/video.mp4',
    });

    await downloadAsset(params);

    expect(saveUrlToNativePhotoLibrary).toHaveBeenCalledWith(
      'https://cdn.makaron.app/video.mp4',
      expect.stringMatching(/^makaron-video-\d+\.mp4$/),
      'video',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveBlobToNativePhotoLibrary).not.toHaveBeenCalled();
    expect(params.setAgentStatus).toHaveBeenCalledWith('Saving to Photos...');
    expect(params.setAgentStatus).toHaveBeenCalledWith('editor.done');
    expect(params.showSaveToast).toHaveBeenCalledTimes(1);
  });

  it('falls back to the video proxy when native video URL save fails', async () => {
    vi.mocked(saveUrlToNativePhotoLibrary).mockRejectedValueOnce(new Error('video url save failed'));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['mp4'], { type: 'video/mp4' }),
    })));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const params = makeParams({
      isViewingVideo: true,
      currentVideoUrl: 'https://cdn.makaron.app/video.mp4',
    });

    await downloadAsset(params);

    expect(saveUrlToNativePhotoLibrary).toHaveBeenCalledWith(
      'https://cdn.makaron.app/video.mp4',
      expect.stringMatching(/^makaron-video-\d+\.mp4$/),
      'video',
    );
    expect(fetch).toHaveBeenCalledWith('/api/proxy-video?url=https%3A%2F%2Fcdn.makaron.app%2Fvideo.mp4&download=1');
    expect(params.setAgentStatus).toHaveBeenCalledWith('Native save failed, trying fallback...');
    expect(params.showSaveToast).toHaveBeenCalledTimes(1);
  });

  it('reuses the same video Blob across Save openings but invalidates a changed source', async () => {
    const request = vi.fn(async () => Response.json({ video: true }));
    vi.stubGlobal('fetch', request);
    const cache = new PreparedDownloadCache();
    const params = makeParams({ isViewingVideo: true, currentVideoUrl: 'https://cdn.makaron.app/one.mp4' });
    const first = await prepareDownloadAsset(params, cache);
    const again = await prepareDownloadAsset(params, cache);
    expect(again.blob).toBe(first.blob);expect(request).toHaveBeenCalledTimes(1);
    await prepareDownloadAsset({ ...params, currentVideoUrl: 'https://cdn.makaron.app/two.mp4' }, cache);
    expect(request).toHaveBeenCalledTimes(2);
    cache.clear();await prepareDownloadAsset(params, cache);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('deduplicates in-flight preparations and retries failed requests', async () => {
    const cache = new PreparedDownloadCache();
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ blob: new Blob(['video']), filename: 'video.mp4', kind: 'video' });
    const first = cache.get('video', load);
    expect(cache.get('video', load)).toBe(first);
    await expect(first).rejects.toThrow('offline');
    await expect(cache.get('video', load)).resolves.toHaveProperty('filename', 'video.mp4');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('bounds cache entries and bytes using least-recently-used eviction', async () => {
    const cache = new PreparedDownloadCache(6, 2);
    const load = vi.fn(async () => ({ blob: new Blob(['123']), filename: 'image.png', kind: 'image' as const }));
    await cache.get('a', load);await cache.get('b', load);await cache.get('a', load);await cache.get('c', load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get('a', load);expect(load).toHaveBeenCalledTimes(3);
    await cache.get('b', load);expect(load).toHaveBeenCalledTimes(4);
    const huge = vi.fn(async () => ({ blob: new Blob(['1234567']), filename: 'large.png', kind: 'image' as const }));
    await cache.get('huge', huge);await cache.get('huge', huge);
    expect(huge).toHaveBeenCalledTimes(2);
  });

  it('uses authenticated streaming for private video previews without downloading the file', () => {
    const source = 'https://generativelanguage.googleapis.com/v1beta/files/test:download';
    expect(getDownloadAssetPreview(makeParams({ isViewingVideo: true, currentVideoUrl: source }))).toMatchObject({
      source: '/api/proxy-video?url=' + encodeURIComponent(source), kind: 'video',
    });
  });

  it.each([{ width: 480, height: 854 }, { width: 854, height: 480 }])('uses the visible player dimensions for the initial save preview: %j', size => {
    const params = makeParams({ isViewingVideo: true, currentVideoUrl: 'https://cdn.makaron.app/work.mp4', currentVideoSize: size,
      snapshotsRef: { current: [{ id: 'video-size', messageId: '', image: '', imageUrl: '', tips: [], videoMeta: { width: 768, height: 768,
        taskId: null, videoUrl: 'https://cdn.makaron.app/work.mp4', prompt: '', sourceSnapshotIds: [], sourceUrls: [], status: 'completed', duration: 5, model: 'fal-h3-max' } }] } });
    expect(getDownloadAssetPreview(params)).toMatchObject(size);
  });

  it.each([undefined, { width: 0, height: 0 }])('falls back to snapshot dimensions when playback metadata is unavailable: %j', currentVideoSize => {
    const params = makeParams({ isViewingVideo: true, currentVideoUrl: 'https://cdn.makaron.app/work.mp4', currentVideoSize,
      snapshotsRef: { current: [{ id: 'video-size', messageId: '', image: '', imageUrl: '', tips: [], videoMeta: { width: 480, height: 854,
        taskId: null, videoUrl: 'https://cdn.makaron.app/work.mp4', prompt: '', sourceSnapshotIds: [], sourceUrls: [], status: 'completed', duration: 5, model: 'fal-h3-max' } }] } });
    expect(getDownloadAssetPreview(params)).toMatchObject({ width: 480, height: 854 });
  });
});
