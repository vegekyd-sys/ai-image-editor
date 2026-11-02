import {describe, expect, it, vi} from 'vitest';
import {beginQueuedMediaDelivery, resolveRemotionMediaDelivery, signRenderMediaUrl, takeQueuedMediaDelivery} from '../src/lib/remotion-media-delivery';
import {verifyRenderToken} from '../services/media-cdn/src/worker.mjs';
import type {DesignPayload} from '../src/types';

const secret = 'unit-test-signing-secret-at-least-32-bytes';
const origin = 'https://media-cache.makaron.app';
const url = 'https://cdn.makaron.app/storage/v1/object/public/images/owner/project/voice.wav';
const design: DesignPayload = {code: `<Audio src="${url}" trimBefore={45} volume={0.7}/>`, props: {voice: url}, width: 1080, height: 1920};
const meta = {etag: '"v1"', size: 16, type: 'audio/wav', freshness: 3600};
const readyResponse = () => new Response(new Uint8Array([0]), {status: 206, headers: {
  'content-range': 'bytes 0-0/16', 'content-length': '1', 'content-type': 'audio/wav', etag: '"v1"', 'cache-control': 'public, max-age=3600',
}});
async function payload(signed: string) {
  const u = new URL(signed); const token = u.searchParams.get('__mk_render')!;
  u.hostname = 'sdyrtztrjgmmpnirswxt.supabase.co'; u.searchParams.delete('__mk_render');
  return verifyRenderToken(token, u, secret);
}

describe('render-only version capabilities', () => {
  it('shares an owner-scoped prefetch across existing job creation and execution', async () => {
    vi.stubEnv('REMOTION_MEDIA_DELIVERY_ORIGIN', origin); vi.stubEnv('REMOTION_MEDIA_DELIVERY_SECRET', secret);
    const fetcher = vi.fn(async () => readyResponse()); vi.stubGlobal('fetch', fetcher);
    try {
      beginQueuedMediaDelivery(design, 'owner', 'project', 'fingerprint');
      beginQueuedMediaDelivery(design, 'owner', 'project', 'fingerprint');
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(takeQueuedMediaDelivery('other-owner', 'project', 'fingerprint')).toBeNull();
      const queued = takeQueuedMediaDelivery('owner', 'project', 'fingerprint')!;
      queued.release(); const plan = await queued.promise;
      expect(plan.summary.versioned).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
      expect(takeQueuedMediaDelivery('owner', 'project', 'fingerprint')).toBeNull();
    } finally {vi.unstubAllGlobals(); vi.unstubAllEnvs();}
  });
  it('Node signatures verify in the Worker and bind the complete source and version', async () => {
    const signed = signRenderMediaUrl(url + '?download=a%20b.wav#t=1', origin, secret, meta);
    expect((await payload(signed))?.metadata).toEqual(meta);
    expect(new URL(signed).hash).toBe('#t=1');
    const u = new URL(signed); const token = u.searchParams.get('__mk_render')!;
    u.hostname = 'sdyrtztrjgmmpnirswxt.supabase.co'; u.searchParams.delete('__mk_render');
    expect(await verifyRenderToken(token, u, secret, Date.now() + 7 * 3600_000)).toBeNull();
    u.pathname += 'other';
    expect(await verifyRenderToken(token, u, secret)).toBeNull();
    expect(signRenderMediaUrl(url, 'https://evil.test', secret, meta)).toBe(url);
  });
  it('uses versions ready during existing preparation and keeps authored media unchanged', async () => {
    let release: () => void = () => {};
    const readySignal = new Promise<void>(resolve => {release = resolve;});
    const calls: string[] = [];
    const planPromise = resolveRemotionMediaDelivery(design, {userId: 'owner', origin, secret, readySignal,
      fetch: (async input => {calls.push(String(input)); return readyResponse();}) as typeof fetch});
    await new Promise(resolve => setTimeout(resolve, 10)); release();
    const plan = await planPromise;
    expect(plan.summary.versioned).toBe(1);
    expect(calls).toEqual([url.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co')]);
    expect((await payload(plan.sources(design)[url]))?.metadata.etag).toBe('"v1"');
    expect(design.code).toContain(`src="${url}" trimBefore={45} volume={0.7}`); expect(design.props!.voice).toBe(url);
  });
  it('never waits for unfinished probes when existing preparation is ready', async () => {
    const plan = await resolveRemotionMediaDelivery(design, {userId: 'owner', origin, secret,
      readySignal: Promise.resolve(), fetch: (() => new Promise(() => {})) as typeof fetch});
    expect(plan.summary.versioned).toBe(0);
    expect(plan.sources(design)[url]).toBe(url.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co'));
  });
  it('does not prefetch another owner and bypasses unsafe source metadata', async () => {
    for (const policy of ['private', 'no-store']) {
      const plan = await resolveRemotionMediaDelivery(design, {userId: 'owner', origin, secret,
        fetch: (async () => {const r = readyResponse(); r.headers.set('cache-control', policy); return r;}) as typeof fetch});
      expect(plan.summary.versioned).toBe(0);
      expect(plan.sources(design)[url]).toBe(url.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co'));
    }
    const plan = await resolveRemotionMediaDelivery(design, {userId: 'different-owner', origin, secret,
      fetch: (() => {throw new Error('must not fetch');}) as typeof fetch});
    expect(plan.summary.eligible).toBe(0);
    expect(plan.sources(design)[url]).toBe(url.replace('cdn.makaron.app', 'sdyrtztrjgmmpnirswxt.supabase.co'));
  });
  it('is off without the isolated configuration and preserves private/provider URLs', async () => {
    const off = await resolveRemotionMediaDelivery(design, {userId: 'owner', origin, secret: 'short'});
    expect(off.sources(design)).toEqual({});
    expect(signRenderMediaUrl(url + '?token=private', origin, secret, meta)).toBe(url + '?token=private');
    expect(signRenderMediaUrl('https://provider.test/private.wav', origin, secret, meta)).toBe('https://provider.test/private.wav');
  });
});
