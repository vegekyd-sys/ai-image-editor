import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAsset } from '@/lib/editor/download';
import {
  saveBlobToNativePhotoLibrary,
  saveUrlToNativePhotoLibrary,
} from '@/lib/native-media';

vi.mock('@/lib/native-media', () => ({
  isNativePhotoLibrarySaveAvailable: vi.fn(() => true),
  saveBlobToNativePhotoLibrary: vi.fn(() => Promise.resolve()),
  saveUrlToNativePhotoLibrary: vi.fn(() => Promise.resolve()),
}));

function makeParams(overrides: Partial<Parameters<typeof downloadAsset>[0]> = {}): Parameters<typeof downloadAsset>[0] {
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
    t: vi.fn((key: string) => key),
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
});
