import {describe, expect, it, vi} from 'vitest';
import {nativeR2Key, nativeR2Ready, signNativeR2Url, REMOTION_R2_ACCOUNT, REMOTION_R2_BUCKET} from '../src/lib/remotion-r2-delivery';
import {resolveRemotionMediaDelivery} from '../src/lib/remotion-media-delivery';
import type {DesignPayload} from '../src/types';
import {digest} from '../services/media-cdn/src/worker.mjs';

const source = 'https://cdn.makaron.app/storage/v1/object/public/images/owner/project/voice.wav';
const metadata = {etag: '"source-v1"', size: 16, type: 'audio/wav', freshness: 3600};
const credentials = {accessKeyId: 'a'.repeat(32), secretAccessKey: 'b'.repeat(64)};
const design: DesignPayload = {code: `<Audio src="${source}"/>`, props: {voice: source}, width: 1080, height: 1920};
const originalResponse = () => new Response(new Uint8Array([0]), {status: 206, headers: {
  'content-range': 'bytes 0-0/16', 'content-length': '1', 'content-type': 'audio/wav', etag: metadata.etag, 'cache-control': 'public, max-age=3600',
}});
const nativeResponse = (etag = metadata.etag) => new Response(new Uint8Array([0]), {status: 206, headers: {
  'content-range': 'bytes 0-0/16', 'content-length': '1', 'content-type': 'audio/wav',
  'x-amz-meta-makaron-source-etag': etag, 'x-amz-meta-makaron-source-size': '16',
}});

describe('private native R2 render delivery', () => {
  it('does not enable native delivery when scoped read credentials are absent', async () => {
    vi.stubEnv('REMOTION_R2_READ_ACCESS_KEY_ID', ''); vi.stubEnv('REMOTION_R2_READ_SECRET_ACCESS_KEY', '');
    try {
      const plan = await resolveRemotionMediaDelivery(design, {userId: 'owner', mode: 'r2-native', origin: 'https://media-cache.makaron.app',
        secret: 'test-secret-at-least-thirty-two-bytes', fetch: (() => {throw Error('must not fetch');}) as typeof fetch});
      expect(plan.summary.enabled).toBe(false); expect(plan.sources(design)).toEqual({});
    } finally {vi.unstubAllEnvs();}
  });
  it('signs only the fixed private cache namespace and keeps long-term credentials out of the URL', async () => {
    const now = Math.floor(Date.now() / 3600_000) * 3600_000 + 1000;
    const signed = await signNativeR2Url(source, metadata, now, credentials);
    const url = new URL(signed!);
    expect(url.hostname).toBe(`${REMOTION_R2_ACCOUNT}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${REMOTION_R2_BUCKET}/${nativeR2Key(source, metadata)}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('21600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(signed).not.toContain(credentials.secretAccessKey);
    expect(await signNativeR2Url(source, metadata, now + 100, credentials)).toBe(signed);
    expect(nativeR2Key(source.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co'), metadata)).toBe(nativeR2Key(source, metadata));
    expect(nativeR2Key(source + '?token=private', metadata)).toBeNull();
    expect(nativeR2Key('https://provider.test/private.wav', metadata)).toBeNull();
    const canonical = source.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co');
    expect(nativeR2Key(source, metadata)).toBe(`v1/native/${await digest(canonical + '\n*/*')}/${await digest(metadata.etag + '\n' + metadata.size)}`);
    expect(new URL((await signNativeR2Url(source + '#t=1', metadata, now, credentials))!).hash).toBe('#t=1');
  });
  it('requires the stored source version and full size, rather than trusting existence alone', async () => {
    for (const etag of ['"other-version"', metadata.etag]) {
      expect(await nativeR2Ready('https://example.test/object', metadata,
        (async () => nativeResponse(etag)) as typeof fetch, new AbortController().signal)).toBe(etag === metadata.etag);
    }
  });
  it('uses a ready native object and warms asynchronously without waiting for the copy response', async () => {
    const target = `https://${REMOTION_R2_ACCOUNT}.r2.cloudflarestorage.com/${REMOTION_R2_BUCKET}/object`;
    const plan = await resolveRemotionMediaDelivery(design, {userId: 'owner', mode: 'r2-native', origin: 'https://media-cache.makaron.app',
      secret: 'test-secret-at-least-thirty-two-bytes', budgetMs: 100,
      nativeSigner: async () => target,
      fetch: (async input => {
        const host = new URL(String(input)).hostname;
        if (host === 'media-cache.makaron.app') return new Promise(() => {});
        return host.endsWith('r2.cloudflarestorage.com') ? nativeResponse() : originalResponse();
      }) as typeof fetch});
    expect(plan.summary.versioned).toBe(1); expect(plan.sources(design)[source]).toBe(target);
    expect(design.props!.voice).toBe(source);
  });
  it('keeps the original path when the private object is missing, unverified or not ready by the existing deadline', async () => {
    for (const response of [() => new Response(null, {status: 404}), () => nativeResponse('"other-version"')]) {
      const plan = await resolveRemotionMediaDelivery(design, {userId: 'owner', mode: 'r2-native', origin: 'https://media-cache.makaron.app',
        secret: 'test-secret-at-least-thirty-two-bytes', nativeSigner: async () => 'https://example.test/native',
        fetch: (async input => new URL(String(input)).hostname.endsWith('supabase.co') ? originalResponse() : response()) as typeof fetch});
      expect(plan.summary.versioned).toBe(0);
      expect(plan.sources(design)[source]).toBe(source.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co'));
    }
  });
});
