import {createHash} from 'node:crypto';
import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {mediaDeliveryUrl} from './media-delivery';
import type {Metadata} from './remotion-media-delivery';

export const REMOTION_R2_ACCOUNT = '83bc48856cd8ab6d436b3ed49d825c6f';
export const REMOTION_R2_BUCKET = 'makaron-render-media-cache';
interface Credentials {accessKeyId: string; secretAccessKey: string}
let cachedClient: {key: string; client: S3Client} | undefined;

export function nativeR2Credentials(): Credentials | null {
  const accessKeyId = process.env.REMOTION_R2_READ_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.REMOTION_R2_READ_SECRET_ACCESS_KEY?.trim() || '';
  return /^[a-f0-9]{32}$/i.test(accessKeyId) && /^[a-f0-9]{64}$/i.test(secretAccessKey)
    ? {accessKeyId, secretAccessKey} : null;
}

/** The native namespace is separate from earlier range-proxy experiments. */
export function nativeR2Key(source: string, metadata: Metadata): string | null {
  if (mediaDeliveryUrl(source, 'https://media-cache.makaron.app') === source
    || !/^(audio|video)\//.test(metadata.type) || !Number.isSafeInteger(metadata.size)
    || metadata.size <= 0 || metadata.size > 500 * 1024 ** 2 || !/^"[^"\r\n]{1,128}"$/.test(metadata.etag)) return null;
  const url = new URL(source); url.hostname = 'sdyrtztrjgmmpnirswxt.supabase.co';
  url.hash = ''; url.search = url.searchParams.toString();
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  return `v1/native/${hash(url.href + '\n*/*')}/${hash(metadata.etag + '\n' + metadata.size)}`;
}

export async function signNativeR2Url(source: string, metadata: Metadata, now = Date.now(), credentials = nativeR2Credentials()): Promise<string | null> {
  const key = nativeR2Key(source, metadata);
  if (!credentials || !key) return null;
  const identity = credentials.accessKeyId + '\n' + credentials.secretAccessKey;
  if (cachedClient?.key !== identity) cachedClient = {key: identity, client: new S3Client({
    endpoint: `https://${REMOTION_R2_ACCOUNT}.r2.cloudflarestorage.com`, region: 'auto',
    forcePathStyle: true, credentials, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  })};
  // No network call and no global AWS credential mutation. Only the scoped,
  // expiring object URL enters renderer inputProps, never these credentials.
  const signed = await getSignedUrl(cachedClient.client, new GetObjectCommand({Bucket: REMOTION_R2_BUCKET, Key: key,
    ResponseContentType: metadata.type}), {expiresIn: 6 * 3600, signingDate: new Date(Math.floor(now / 3600_000) * 3600_000)});
  const result = new URL(signed); result.hash = new URL(source).hash;
  return result.href;
}

export async function nativeR2Ready(url: string, metadata: Metadata, fetcher: typeof fetch, signal: AbortSignal): Promise<boolean> {
  const response = await fetcher(url, {headers: {Range: 'bytes=0-0', Accept: '*/*', 'Accept-Encoding': 'identity'}, cache: 'no-store', redirect: 'error', signal});
  try {
    return response.status === 206 && response.headers.get('content-range') === `bytes 0-0/${metadata.size}`
      && response.headers.get('content-length') === '1'
      && response.headers.get('content-type')?.split(';')[0] === metadata.type.split(';')[0]
      && response.headers.get('x-amz-meta-makaron-source-etag') === metadata.etag
      && response.headers.get('x-amz-meta-makaron-source-size') === String(metadata.size);
  } finally {await response.body?.cancel();}
}
