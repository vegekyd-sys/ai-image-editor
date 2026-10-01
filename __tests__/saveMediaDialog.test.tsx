import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaveMediaDialog from '@/components/SaveMediaDialog';

const mocks = vi.hoisted(() => ({ access: vi.fn(), save: vi.fn(), image: vi.fn(), video: vi.fn(), preload: vi.fn(), native: vi.fn(), nativeVideo: vi.fn() }));
const translate = (key: string) => ({ 'project.save': 'Save', 'editor.removeWatermark': 'Remove watermark' }[key] || key);
vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: translate }) }));
vi.mock('@/lib/editor/download', () => ({ checkMediaDownload: mocks.access, savePreparedDownload: mocks.save }));
vi.mock('@/lib/native-media', () => ({ isNativePhotoLibrarySaveAvailable: mocks.native, saveWatermarkedVideoToNativePhotoLibrary: mocks.nativeVideo }));
vi.mock('@/lib/editor/web-watermark', () => ({
  watermarkImage: mocks.image, watermarkVideo: mocks.video, preloadWatermarkVideo: mocks.preload, watermarkDataUrl: () => 'data:image/png;base64,mark',
  watermarkGeometry: () => ({ width: .28, height: .07, left: .695, top: .905 }),
}));

describe('SaveMediaDialog choices and checkout return', () => {
  const original = new Blob(['original'], { type: 'image/png' });
  const marked = new Blob(['watermarked'], { type: 'image/png' });
  const prepare = vi.fn(async () => ({ blob: original, filename: 'work.png', kind: 'image' as const }));
  const props = { prepare, onClose: vi.fn(), onUpgrade: vi.fn(), onSaved: vi.fn(), suspended: false };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(false);mocks.image.mockResolvedValue(marked);mocks.save.mockResolvedValue(undefined);
    mocks.native.mockReturnValue(false);mocks.nativeVideo.mockResolvedValue(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:clean-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => {cleanup();vi.restoreAllMocks();});

  it('makes Save the primary choice and downloads the marked image without opening checkout', async () => {
    render(<SaveMediaDialog {...props} />);
    await waitFor(() => expect(screen.getByTestId('save-free').hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('save-free').textContent).toBe('Save');
    expect(screen.getByTestId('save-free').className).toContain('mkr-liquid-pill');
    expect(screen.getByTestId('save-upgrade').textContent).toBe('Remove watermark');
    expect(mocks.image).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('save-free'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ blob: marked })));
    expect(props.onUpgrade).not.toHaveBeenCalled();
  });

  it('only the separate Remove watermark command opens checkout', async () => {
    render(<SaveMediaDialog {...props} />);
    await waitFor(() => expect(screen.getByTestId('save-upgrade').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('save-upgrade'));
    expect(props.onUpgrade).toHaveBeenCalledOnce();expect(mocks.save).not.toHaveBeenCalled();
  });

  it('fades only the mark after verified checkout access, keeping the same media URL', async () => {
    mocks.access.mockResolvedValue(true);
    render(<SaveMediaDialog {...props} returningFromCheckout />);
    await waitFor(() => expect(screen.getByTestId('save-clean').hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('save-watermark').getAttribute('data-visible')).toBe('true');
    await waitFor(() => expect(screen.getByTestId('save-watermark').getAttribute('data-visible')).toBe('false'));
    expect(screen.getByTestId('save-media-preview').querySelector('img')?.getAttribute('src')).toBe('blob:clean-preview');
    expect(prepare).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('save-clean'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ blob: original })));
  });

  it('does not unlock canceled/unverified returns, but rechecks on browser focus', async () => {
    render(<SaveMediaDialog {...props} returningFromCheckout />);
    await waitFor(() => expect(screen.getByTestId('save-free').hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('save-watermark').getAttribute('data-visible')).toBe('true');
    mocks.access.mockResolvedValue(true);fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.getByTestId('save-watermark').getAttribute('data-visible')).toBe('false'));
    expect(screen.queryByTestId('save-upgrade')).toBeNull();
  });

  it('rechecks paid access before downloading and restores the mark when access is revoked', async () => {
    mocks.access.mockResolvedValue(true);
    render(<SaveMediaDialog {...props} />);
    await waitFor(() => expect(screen.getByTestId('save-clean').hasAttribute('disabled')).toBe(false));
    mocks.access.mockResolvedValue(false);fireEvent.click(screen.getByTestId('save-clean'));
    await screen.findByRole('alert');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-watermark').getAttribute('data-visible')).toBe('true');
  });

  it.each([false, true])('shows the original video immediately without waiting for the full download (paid=%s)', async paid => {
    let complete!: (asset: { blob: Blob; filename: string; kind: 'video' }) => void;
    const pending = new Promise<{ blob: Blob; filename: string; kind: 'video' }>(resolve => {complete = resolve;});
    const prepareVideo = vi.fn(() => pending);
    mocks.access.mockResolvedValue(paid);mocks.video.mockResolvedValue(marked);
    render(<SaveMediaDialog {...props} prepare={prepareVideo} preview={{ source: 'https://cdn.makaron.app/work.mp4', kind: 'video', width: 768, height: 768 }} />);
    expect(screen.getByTestId('save-media-preview').querySelector('video')?.getAttribute('src')).toBe('https://cdn.makaron.app/work.mp4');
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(screen.getByTestId(paid ? 'save-clean' : 'save-free').hasAttribute('disabled')).toBe(false));
    expect(screen.getByTestId('save-watermark').getAttribute('data-visible')).toBe(String(!paid));
    expect(mocks.video).not.toHaveBeenCalled();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId(paid ? 'save-clean' : 'save-free'));
    expect(pause).toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
    complete({ blob: original, filename: 'work.mp4', kind: 'video' });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ blob: paid ? original : marked })));
    expect(mocks.video).toHaveBeenCalledTimes(paid ? 0 : 1);
    expect(mocks.preload).toHaveBeenCalledTimes(paid ? 0 : 2);
    expect(screen.getByTestId('save-media-preview').querySelector('video')?.getAttribute('src')).toBe('https://cdn.makaron.app/work.mp4');
  });

  it.each([{ width: 480, height: 854 }, { width: 854, height: 480 }])('keeps the initial video frame geometry when metadata arrives: %j', size => {
    const prepareVideo = () => new Promise<never>(() => {});
    render(<SaveMediaDialog {...props} prepare={prepareVideo} preview={{ source: 'https://cdn.makaron.app/work.mp4', kind: 'video', ...size }} />);
    const frame = screen.getByTestId('save-media-preview');
    const initialStyle = frame.getAttribute('style');
    expect(frame.style.aspectRatio).toBe(`${size.width} / ${size.height}`);
    const video = frame.querySelector('video')!;
    Object.defineProperties(video, { videoWidth: { value: size.width }, videoHeight: { value: size.height }, duration: { value: 5 } });
    fireEvent.loadedMetadata(video);
    expect(frame.getAttribute('style')).toBe(initialStyle);
  });

  it('reserves the caption space while purchase access is loading', async () => {
    let finishAccess!: (paid: boolean) => void;
    mocks.access.mockImplementation(() => new Promise<boolean>(resolve => {finishAccess = resolve;}));
    render(<SaveMediaDialog {...props} preview={{ source: 'https://cdn.makaron.app/work.mp4', kind: 'video', width: 480, height: 854 }} />);
    const caption = screen.getByText('editor.saveWatermarkedCaption');
    expect(caption.style.visibility).toBe('hidden');
    finishAccess(false);
    await waitFor(() => expect(caption.style.visibility).toBe('visible'));
    expect(screen.getByText('editor.saveWatermarkedCaption')).toBe(caption);
  });

  it('rechecks paid access after a slow original download completes', async () => {
    let complete!: (asset: { blob: Blob; filename: string; kind: 'video' }) => void;
    const pending = new Promise<{ blob: Blob; filename: string; kind: 'video' }>(resolve => {complete = resolve;});
    mocks.access.mockResolvedValue(true);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(<SaveMediaDialog {...props} prepare={() => pending} preview={{ source: 'https://cdn.makaron.app/work.mp4', kind: 'video' }} />);
    await waitFor(() => expect(screen.getByTestId('save-clean').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('save-clean'));
    mocks.access.mockResolvedValue(false);
    complete({ blob: original, filename: 'work.mp4', kind: 'video' });
    await screen.findByRole('alert');
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.video).not.toHaveBeenCalled();
  });

  it('uses native composition for free iOS video, without loading the WebCodecs encoder', async () => {
    mocks.native.mockReturnValue(true);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(<SaveMediaDialog {...props} prepare={async () => ({ blob: original, filename: 'work.mp4', kind: 'video' })} />);
    await waitFor(() => expect(screen.getByTestId('save-free').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('save-free'));
    await waitFor(() => expect(mocks.nativeVideo).toHaveBeenCalledWith(original, 'work.mp4', 'data:image/png;base64,mark', expect.any(Function), expect.any(AbortSignal)));
    expect(mocks.preload).not.toHaveBeenCalled();expect(mocks.video).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();expect(props.onSaved).toHaveBeenCalledOnce();
  });

  it('reports native export failure without saving a clean fallback', async () => {
    mocks.native.mockReturnValue(true);mocks.nativeVideo.mockRejectedValue(new Error('Unsupported native action'));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(<SaveMediaDialog {...props} prepare={async () => ({ blob: original, filename: 'work.mp4', kind: 'video' })} />);
    await waitFor(() => expect(screen.getByTestId('save-free').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('save-free'));
    await screen.findByRole('alert');
    expect(mocks.save).not.toHaveBeenCalled();expect(props.onSaved).not.toHaveBeenCalled();
  });
});
