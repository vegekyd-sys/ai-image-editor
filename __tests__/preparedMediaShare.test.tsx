import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreparedMediaShare } from '@/hooks/usePreparedMediaShare';

vi.mock('@/lib/native-media', () => ({ isNativePhotoLibrarySaveAvailable: () => false }));

const video = new Blob(['video'], { type: 'video/mp4' });
const share = vi.fn();
const userActivation = { isActive: false };

beforeEach(() => {
  share.mockReset().mockResolvedValue(undefined);
  userActivation.isActive = false;
  vi.stubGlobal('navigator', { userAgent: 'iPhone Safari', userActivation, canShare: () => true, share });
});
afterEach(() => vi.unstubAllGlobals());

describe('Safari file sharing', () => {
  it('prepares silently and calls the system share API synchronously on the first tap', async () => {
    const { result } = renderHook(() => usePreparedMediaShare('one'));
    act(() => result.current.warm(video, 'original.mp4'));
    expect(result.current.showActions).toBe(false);
    expect(share).not.toHaveBeenCalled();
    await act(async () => {
      const tapped = result.current.share();
      expect(share).toHaveBeenCalledExactlyOnceWith({ files: [expect.objectContaining({ name: 'original.mp4' })] });
      await tapped;
    });
    expect(result.current.showActions).toBe(false);
  });

  it('opens automatically when a cold preparation finishes during the original tap', async () => {
    const { result } = renderHook(() => usePreparedMediaShare('one'));
    userActivation.isActive = true;
    await act(async () => {
      expect(result.current.offer(video, 'cold.mp4')).toBe(true);
      expect(share).toHaveBeenCalledOnce();
    });
  });

  it('offers a new tap after activation expires and never shares from a stale selection', async () => {
    const { result, rerender } = renderHook(({ key }) => usePreparedMediaShare(key), { initialProps: { key: 'one' } });
    const oldOffer = result.current.offer;
    act(() => { result.current.offer(video, 'first.mp4'); });
    expect(result.current.showActions).toBe(true);
    expect(share).not.toHaveBeenCalled();
    rerender({ key: 'two' });
    userActivation.isActive = true;
    act(() => { oldOffer(video, 'stale.mp4'); });
    expect(share).not.toHaveBeenCalled();
    expect(result.current.file).toBeUndefined();
  });
});
