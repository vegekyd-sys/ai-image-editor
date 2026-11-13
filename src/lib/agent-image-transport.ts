import type { NativeVisionImageInput } from './agent-image-analysis';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_IMAGES = 8;

/** Only inline our storage objects; arbitrary provider URLs keep their existing transport. */
function isOwnedImage(source: string): boolean {
  try {
    const url = new URL(source);
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origins = new Set(['https://cdn.makaron.app', 'https://www.makaron.app', 'https://makaron.app', 'https://sdyrtztrjgmmpnirswxt.supabase.co']);
    if (configured) origins.add(new URL(configured).origin);
    return url.protocol === 'https:' && !url.username && !url.password
      && origins.has(url.origin) && url.pathname.startsWith('/storage/v1/object/');
  } catch { return false; }
}

/**
 * Supply original bytes instead of making DeepSeek fetch the CDN on its critical
 * path. No resize/re-encode/detail change. Scoped to one Agent request, bounded,
 * and best effort: oversized, slow or unavailable objects retain their URL.
 */
export async function prepareAgentImageTransport(
  images: NativeVisionImageInput[],
  abortSignal?: AbortSignal,
): Promise<NativeVisionImageInput[]> {
  const pending = new Map<string, Promise<string>>();
  let batchBytes = 0;
  return Promise.all(images.map(async (image) => {
    if (!isOwnedImage(image.source)) return image;
    let prepared = pending.get(image.source);
    if (!prepared && pending.size < MAX_IMAGES) {
      prepared = (async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const timeout = AbortSignal.timeout(2_000);
          const response = await fetch(image.source, {
            signal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout,
            redirect: 'error',
          });
          const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          if (!response.ok || !mime || !/^image\/(jpeg|png|webp|gif)$/.test(mime)
            || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES || !response.body) {
            await response.body?.cancel();
            return image.source;
          }
          reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES || batchBytes + value.byteLength > MAX_BATCH_BYTES) return image.source;
            batchBytes += value.byteLength;
            chunks.push(value);
          }
          if (!size) return image.source;
          return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
        } catch {
          return image.source;
        } finally {
          await reader?.cancel().catch(() => {});
        }
      })();
      pending.set(image.source, prepared);
    }
    const source = await prepared;
    return source && source !== image.source ? { ...image, source } : image;
  }));
}
