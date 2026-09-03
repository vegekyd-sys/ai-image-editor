// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeVideoMetadata, probeVideoMetadataFromUrl } from '@/lib/video-metadata';
import { mp4Fixture } from './helpers/mp4Fixture';
afterEach(() => vi.unstubAllGlobals());

describe('measured video metadata', () => {
  it.each([false, true])('reads fractional duration from mvhd v1=%s', v1 => {
    expect(probeVideoMetadata(mp4Fixture(5.184, v1)).duration).toBe(5.184);
  });
  it('does not invent duration for malformed media', () => {
    expect(probeVideoMetadata(new Uint8Array([1, 2, 3])).duration).toBeUndefined();
  });
  it('downloads a source once and returns its measured duration', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(mp4Fixture())); vi.stubGlobal('fetch', fetch);
    expect(await probeVideoMetadataFromUrl('https://example.com/source.mp4')).toMatchObject({ duration: 5.184 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('bounds downloads with content-length=%s', header => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(11), { headers: header ? { 'content-length': '11' } : {} })));
    return expect(probeVideoMetadataFromUrl('https://example.com/source.mp4', 10)).resolves.toBeNull();
  });
  it('rejects unsupported URLs without a fetch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await probeVideoMetadataFromUrl('file:///private/video.mp4')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
