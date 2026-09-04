import sharp from 'sharp';
import { get } from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

export class ProviderImageInputError extends Error {
  readonly code = 'INVALID_INPUT_IMAGE';
}

const privateNetworks = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) privateNetworks.addSubnet(network, prefix);
const privateV6Networks = new BlockList();
for (const [network, prefix] of [['::', 96], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) privateV6Networks.addSubnet(network, prefix, 'ipv6');

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !privateNetworks.check(address, 'ipv4') : family === 6 && !privateV6Networks.check(address, 'ipv6');
}

/** DNS is validated on the actual socket lookup, preventing DNS rebinding. No redirects or credentials. */
export async function readProviderImage(source: string, limit: number): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const match = /^data:image\/(?:jpeg|jpg|png|webp|bmp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(source);
    if (!match || Buffer.byteLength(match[1], 'base64') > limit) throw new Error('Invalid image data');
    return Buffer.from(match[1], 'base64');
  }
  const url = new URL(source);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Our fixed CDN is also routed through fake-IP VPNs during local development.
  // It is server-owned, not a caller-selected hostname; TLS still verifies it.
  const managedStorageHost = host === 'cdn.makaron.app';
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || (isIP(host) && !isPublicImageAddress(host))) throw new Error('Not a public HTTPS image');
  return new Promise((resolve, reject) => {
    const request = get(url, {
      signal: AbortSignal.timeout(15_000),
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) return callback(error, '', 4);
          if (!addresses.length || (!managedStorageHost && addresses.some(a => !isPublicImageAddress(a.address)))) return callback(new Error('Non-public image host'), '', 4);
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, response => {
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > limit) {
        response.destroy(); reject(new Error('Image unavailable or too large')); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limit) { response.destroy(new Error('Image too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
  });
}

export async function validateProviderImages(images: string[], model: 'wan2.7-image' | 'minimax-h3-max'): Promise<void> {
  const wan = model === 'wan2.7-image';
  const label = wan ? 'Wan 2.7' : 'MiniMax H3 Max Turbo';
  const min = wan ? 240 : 256;
  const maxBytes = (wan ? 20 : 30) * 1024 * 1024;
  for (const [index, source] of images.entries()) {
    let meta: sharp.Metadata;
    try {
      meta = await sharp(await readProviderImage(source, maxBytes), { limitInputPixels: 64_000_000 }).metadata();
    } catch {
      throw new ProviderImageInputError(`${label} input image ${index + 1} could not be verified. Use an accessible original JPEG/PNG/WebP image (at most ${maxBytes / 1024 / 1024} MB). No generation was submitted; do not retry the same input.`);
    }
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < min || height < min || (wan && (width > 8000 || height > 8000 || width / height > 8 || height / width > 8))) {
      throw new ProviderImageInputError(`${label} input image ${index + 1} is ${width}x${height}; each dimension must be at least ${min}px${wan ? ', at most 8000px, with aspect ratio between 1:8 and 8:1' : ''}. Use the full-resolution original or explicitly resize/pad it without cropping. No generation was submitted; do not retry the same input.`);
    }
    if (wan && (!['jpeg', 'png', 'webp', 'bmp'].includes(meta.format ?? '') || (meta.format === 'png' && meta.hasAlpha))) {
      throw new ProviderImageInputError('Wan 2.7 requires JPEG, opaque PNG, WebP or BMP. Convert the input before submitting; no generation was submitted.');
    }
  }
}
