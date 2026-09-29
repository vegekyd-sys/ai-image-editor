import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Inspect the actual ISO BMFF brands: Scene URLs need not have an extension. */
export function isHeicImage(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brands = [buffer.toString('ascii', 8, 12)];
  const end = Math.min(buffer.readUInt32BE(0), buffer.length);
  for (let i = 16; i + 4 <= end; i += 4) brands.push(buffer.toString('ascii', i, i + 4));
  // AVIF also advertises mif1, but is already supported by Chromium.
  return !brands.some(b => b === 'avif' || b === 'avis') && brands.some(b => HEIC_BRANDS.has(b));
}

export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer> {
  const mod = await import('heic-convert');
  const convert = mod.default;
  const converted = await convert({ buffer, format: 'JPEG', quality: 0.92 });
  return sharp(converted instanceof ArrayBuffer ? Buffer.from(new Uint8Array(converted)) : Buffer.from(converted)).rotate()
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 }).toBuffer();
}

async function readBounded(response: Response, limit: number, prefixOnly = false): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - size;
      if (value.length > remaining && !prefixOnly) throw new Error('External image exceeds 30 MB.');
      const chunk = Buffer.from(value.subarray(0, remaining));
      chunks.push(chunk);
      size += chunk.length;
      if (prefixOnly && size >= limit) break;
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

/** Keep compatible source URLs; materialize HEIC as a durable browser-safe JPEG. */
export async function prepareExternalImage(options: {
  sourceUrl: string;
  userId: string;
  projectId: string;
  supabase: SupabaseClient;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(options.sourceUrl, {
    headers: { Range: 'bytes=0-4095' }, redirect: 'follow', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Unable to inspect external image: HTTP ${response.status}.`);
  const bytes = await readBounded(response, 4096, true);
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!isHeicImage(bytes) && !['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].includes(mime || '')) {
    return options.sourceUrl;
  }
  const full = await fetchImpl(options.sourceUrl, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!full.ok || full.status === 206) throw new Error(`Unable to download complete HEIC image: HTTP ${full.status}.`);
  const buffer = await readBounded(full, MAX_IMAGE_BYTES);
  let jpeg: Buffer;
  try {
    jpeg = await convertHeicToJpeg(buffer);
  } catch {
    throw new Error('Unable to convert external HEIC image to JPEG. Import a JPEG or PNG version.');
  }
  const hash = createHash('sha256').update(jpeg).digest('hex');
  const path = `${options.userId}/${options.projectId}/imports/${hash}.jpg`;
  const { error } = await options.supabase.storage.from('images').upload(path, jpeg, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`Unable to store converted HEIC image: ${error.message}`);
  return options.supabase.storage.from('images').getPublicUrl(path).data.publicUrl;
}
