import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAsset } from '@/lib/editor/download';
import type { LocaleContextValue } from '@/lib/i18n';
import {
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
});
