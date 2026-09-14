import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { convertHeicToJpeg, isHeicImage, prepareExternalImage } from '@/lib/external-image';
import { publishExternalVideoRanges } from '@/lib/external-video-range';

const heic = readFileSync('__tests__/fixtures/external-image.heic');
const sourceUrl = 'https://scenes-ai.com/v1/assets/photo/media';
const jpegUrl = 'https://cdn.makaron.app/converted.jpg';
function storage(fail = false) {
  const upload = vi.fn(async (_path: string, _buffer: Buffer, _options: unknown) => ({ error: fail ? { message: 'write failed' } : null }));
  return { upload, storage: { from: () => ({ upload, getPublicUrl: () => ({ data: { publicUrl: jpegUrl } }) }) } };
}
function fetchHeic() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => new Response(heic, {
    status: init?.headers ? 206 : 200,
    headers: { 'content-type': 'application/octet-stream' },
  }));
}

describe('external HEIC import', () => {
  it('decodes real HEIC bytes with the production JS decoder into a JPEG', async () => {
    expect(isHeicImage(heic)).toBe(true);
    const jpeg = await convertHeicToJpeg(heic);
    expect(await sharp(jpeg).metadata()).toMatchObject({ format: 'jpeg', width: 32, height: 24 });
    expect(isHeicImage(jpeg)).toBe(false);
  });
  it('does not mistake AVIF with a mif1 compatible brand for HEIC', () => {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32BE(24); bytes.write('ftypavif', 4); bytes.write('mif1avif', 16);
    expect(isHeicImage(bytes)).toBe(false);
  });
  it('normalizes extensionless HEIC even with a generic MIME and returns only the stored JPEG', async () => {
    const client = storage();
    const fetchImpl = fetchHeic();
    expect(await prepareExternalImage({ sourceUrl, userId: 'u', projectId: 'p', supabase: client as never, fetchImpl })).toBe(jpegUrl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.upload.mock.calls[0]?.[0]).toMatch(/^u\/p\/imports\/[a-f0-9]+\.jpg$/);
  });
  it('keeps alpha-capable PNG unchanged and does not upload it', async () => {
    const client = storage();
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00000000' } }).png().toBuffer();
    expect(await prepareExternalImage({ sourceUrl, userId: 'u', projectId: 'p', supabase: client as never,
      fetchImpl: async () => new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } }),
    })).toBe(sourceUrl);
    expect(client.upload).not.toHaveBeenCalled();
  });
  it('fails the import if conversion or storage fails instead of returning the unusable source', async () => {
    await expect(prepareExternalImage({ sourceUrl, userId: 'u', projectId: 'p', supabase: storage(true) as never, fetchImpl: fetchHeic() })).rejects.toThrow('Unable to store converted');
    await expect(prepareExternalImage({ sourceUrl, userId: 'u', projectId: 'p', supabase: storage() as never,
      fetchImpl: async () => new Response('corrupt', { headers: { 'content-type': 'image/heic' } }),
    })).rejects.toThrow('Unable to convert');
  });
  it('persists and returns the compatible URL, then deduplicates the original Scene URL', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const client = { ...storage(), rpc: async () => ({ data: 0 }), from: () => {
      let fields = '';
      const query = {
        select: (s: string) => { fields = s; return query; }, eq: () => query,
        order: async () => ({ data: fields === 'id' ? rows.map(r => ({ id: r.id })) : rows, error: null }),
        insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null }; },
      }; return query;
    } };
    const fetchImpl = fetchHeic();
    const options = { supabase: client as never, projectId: 'p', userId: 'u', ranges: [{ type: 'image' as const, source_url: sourceUrl, description: 'photo' }], fetchImpl };
    const [first] = await publishExternalVideoRanges(options);
    const [again] = await publishExternalVideoRanges(options);
    expect(first).toMatchObject({ url: jpegUrl, created: true });
    expect(again).toMatchObject({ url: jpegUrl, created: false, snapshotId: first.snapshotId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ image_url: jpegUrl, metadata: { externalImageSourceUrl: sourceUrl } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
