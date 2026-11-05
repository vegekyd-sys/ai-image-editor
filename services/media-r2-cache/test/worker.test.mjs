import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, cacheTarget, fillableOrigin } from '../src/worker.mjs';

const ORIGIN = 'sdyrtztrjgmmpnirswxt.supabase.co';
const MEDIA = 'https://cdn.makaron.app/storage/v1/object/public/images/u1/p1/media/clip-abc.mp4';
const bytes = n => Uint8Array.from({ length: n }, (_, i) => i % 251);

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  if (!m[1]) { const s = Number(m[2]); return { offset: size - s, length: s }; }
  const start = Number(m[1]); const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return { offset: start, length: end - start + 1 };
}

class FakeR2 {
  constructor() { this.objects = new Map(); this.ops = []; this.fail = false; }
  wrap(key, rec, range) {
    const data = range ? rec.data.slice(range.offset, range.offset + range.length) : rec.data;
    return {
      key, size: rec.data.length, etag: rec.etag, httpEtag: `"${rec.etag}"`, range,
      httpMetadata: rec.httpMetadata || {}, customMetadata: rec.customMetadata || {},
      body: new Response(data).body,
      text: async () => new TextDecoder().decode(rec.data),
      json: async () => JSON.parse(new TextDecoder().decode(rec.data)),
    };
  }
  async head(key) { this.ops.push(['head', key]); if (this.fail) throw new Error('r2 down'); const r = this.objects.get(key); return r ? { ...this.wrap(key, r), body: undefined } : null; }
  async get(key, opts = {}) {
    this.ops.push(['get', key]); if (this.fail) throw new Error('r2 down');
    const r = this.objects.get(key); if (!r) return null;
    let range;
    if (opts.range instanceof Headers) range = parseRange(opts.range.get('range'), r.data.length);
    else if (opts.range) range = opts.range;
    return this.wrap(key, r, range);
  }
  async put(key, value, opts = {}) {
    this.ops.push(['put', key]);
    const data = new Uint8Array(await new Response(value).arrayBuffer());
    // Conditional check and write are atomic, like real R2.
    const existing = this.objects.get(key);
    if (opts.onlyIf?.etagDoesNotMatch === '*' && existing) return null;
    if (opts.onlyIf?.etagMatches && existing?.etag !== opts.onlyIf.etagMatches) return null;
    const rec = { data, etag: `r2-${Math.random()}`, httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata };
    this.objects.set(key, rec);
    return this.wrap(key, rec);
  }
  async delete(keys) { for (const k of [].concat(keys)) this.objects.delete(k); }
  async list({ prefix }) { return { objects: [...this.objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }
}

class FakeCache {
  constructor() { this.store = new Map(); }
  async put(req, res) {
    this.store.set(req.url, { headers: new Headers(res.headers), data: new Uint8Array(await res.arrayBuffer()) });
  }
  async match(req) {
    const e = this.store.get(req.url); if (!e) return undefined;
    const inm = req.headers.get('if-none-match');
    if (inm && inm === e.headers.get('etag')) return new Response(null, { status: 304, headers: e.headers });
    const r = parseRange(req.headers.get('range'), e.data.length);
    if (r) {
      const h = new Headers(e.headers);
      h.set('content-range', `bytes ${r.offset}-${r.offset + r.length - 1}/${e.data.length}`);
      h.set('content-length', String(r.length));
      return new Response(e.data.slice(r.offset, r.offset + r.length), { status: 206, headers: h });
    }
    return new Response(e.data, { status: 200, headers: e.headers });
  }
  async delete(req) { return this.store.delete(req.url); }
}

function makeOrigin(files) {
  const calls = [];
  const fetchOrigin = async (input, init = {}) => {
    const req = input instanceof Request ? new Request(input, init) : new Request(input, init);
    const u = new URL(req.url);
    calls.push({ host: u.hostname, path: u.pathname, search: u.search, range: req.headers.get('range'), method: req.method });
    const f = files[u.pathname];
    if (!f) return new Response('not found', { status: 404, headers: { 'content-type': 'application/json' } });
    const base = { 'content-type': f.type || 'video/mp4', etag: f.etag, 'cache-control': f.cc ?? 'no-cache', 'accept-ranges': 'bytes', 'last-modified': 'Wed, 04 Nov 2026 00:00:00 GMT' };
    const r = parseRange(req.headers.get('range'), f.data.length);
    if (r) {
      return new Response(req.method === 'HEAD' ? null : f.data.slice(r.offset, r.offset + r.length), { status: 206, headers: {
        ...base, 'content-length': String(r.length), 'content-range': `bytes ${r.offset}-${r.offset + r.length - 1}/${f.data.length}` } });
    }
    return new Response(req.method === 'HEAD' ? null : f.data, { status: 200, headers: { ...base, 'content-length': String(f.data.length) } });
  };
  return { fetchOrigin, calls };
}

function setup({ files, env = {}, clock = { t: 1_000_000 } } = {}) {
  const r2 = new FakeR2();
  const cache = new FakeCache();
  const origin = makeOrigin(files);
  const handler = createHandler({ fetchOrigin: origin.fetchOrigin, edgeCache: () => cache, now: () => clock.t });
  const run = async (url, init = {}) => {
    const pending = [];
    const ctx = { waitUntil: p => pending.push(p) };
    const res = await handler(new Request(url, init), { MEDIA_R2: r2, ...env }, ctx);
    const body = new Uint8Array(await res.arrayBuffer());
    await Promise.all(pending);
    return { res, body };
  };
  return { r2, cache, origin, run, clock };
}

const PATH = '/storage/v1/object/public/images/u1/p1/media/clip-abc.mp4';
const file = (data, etag = '"e1"', extra = {}) => ({ [PATH]: { data, etag, ...extra } });

test('cacheTarget only accepts bare or download-only public media URLs', () => {
  assert.ok(cacheTarget(new URL(MEDIA), 'GET'));
  assert.ok(cacheTarget(new URL(MEDIA + '?download=a.mp4'), 'GET'));
  assert.equal(cacheTarget(new URL(MEDIA + '?t=123'), 'GET'), null);
  assert.equal(cacheTarget(new URL(MEDIA), 'POST'), null);
  assert.equal(cacheTarget(new URL('https://cdn.makaron.app/storage/v1/object/public/images/u/x/draft.json'), 'GET'), null);
  assert.equal(cacheTarget(new URL('https://cdn.makaron.app/storage/v1/object/sign/images/u/x.mp4'), 'GET'), null);
  assert.equal(cacheTarget(new URL('https://cdn.makaron.app/rest/v1/projects'), 'GET'), null);
});

test('non-media and cache-busted requests pass through to the Supabase host untouched', async () => {
  const { run, origin, r2 } = setup({ files: file(bytes(100)) });
  const { res } = await run(MEDIA + '?t=99');
  assert.equal(res.status, 200);
  assert.equal(origin.calls.length, 1);
  assert.equal(origin.calls[0].host, ORIGIN);
  assert.equal(origin.calls[0].search, '?t=99');
  assert.equal(r2.objects.size, 0);
});

test('cold range miss serves origin bytes, then fills R2 and edge once', async () => {
  const data = bytes(5000);
  const { run, origin, r2, cache } = setup({ files: file(data) });
  const { res, body } = await run(MEDIA, { headers: { range: 'bytes=100-199' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('x-makaron-cache'), 'MISS');
  assert.deepEqual(body, data.slice(100, 200));
  assert.equal(origin.calls.length, 2, 'client range + one background full read');
  assert.equal(origin.calls[1].range, null);
  const stored = r2.objects.get('v1/images/u1/p1/media/clip-abc.mp4');
  assert.ok(stored);
  assert.deepEqual(stored.data, data);
  assert.equal(stored.customMetadata.etag, '"e1"');
  assert.equal(cache.store.size, 1);
});

test('warm edge serves exact ranges without touching origin or R2', async () => {
  const data = bytes(5000);
  const { run, origin, r2 } = setup({ files: file(data) });
  await run(MEDIA, { headers: { range: 'bytes=0-9' } });
  const before = origin.calls.length; r2.ops.length = 0;
  const { res, body } = await run(MEDIA, { headers: { range: 'bytes=4000-4999' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('x-makaron-cache'), 'HIT-EDGE');
  assert.equal(res.headers.get('cache-control'), 'no-cache', 'browser policy mirrors origin');
  assert.equal(res.headers.get('etag'), '"e1"');
  assert.deepEqual(body, data.slice(4000, 5000));
  assert.equal(origin.calls.length, before);
  assert.equal(r2.ops.length, 0);
});

test('R2 hit serves ranges with origin etag, content-range and re-primes edge', async () => {
  const data = bytes(3000);
  const { run, origin, cache } = setup({ files: file(data) });
  await run(MEDIA);
  cache.store.clear();
  const before = origin.calls.length;
  const { res, body } = await run(MEDIA, { headers: { range: 'bytes=-500' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('x-makaron-cache'), 'HIT-R2');
  assert.equal(res.headers.get('content-range'), 'bytes 2500-2999/3000');
  assert.equal(res.headers.get('content-length'), '500');
  assert.equal(res.headers.get('etag'), '"e1"');
  assert.deepEqual(body, data.slice(2500));
  assert.equal(origin.calls.length, before, 'fresh replica is not revalidated');
  assert.equal(cache.store.size, 1);
});

test('full GET from R2 and conditional 304', async () => {
  const data = bytes(1000);
  const { run, cache } = setup({ files: file(data) });
  await run(MEDIA);
  cache.store.clear();
  const full = await run(MEDIA);
  assert.equal(full.res.status, 200);
  assert.equal(full.res.headers.get('content-length'), '1000');
  assert.deepEqual(full.body, data);
  cache.store.clear();
  const nm = await run(MEDIA, { headers: { 'if-none-match': '"e1"' } });
  assert.equal(nm.res.status, 304);
});

test('concurrent cold misses copy the object from origin only once', async () => {
  const data = bytes(2000);
  const { origin, r2 } = setup({ files: file(data) });
  const cache = new FakeCache();
  const handler = createHandler({ fetchOrigin: origin.fetchOrigin, edgeCache: () => cache, now: () => 1 });
  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  // Two separate isolates (separate handlers) racing on the same object.
  const handler2 = createHandler({ fetchOrigin: origin.fetchOrigin, edgeCache: () => cache, now: () => 1 });
  await Promise.all([
    handler(new Request(MEDIA, { headers: { range: 'bytes=0-9' } }), { MEDIA_R2: r2 }, ctx).then(r => r.arrayBuffer()),
    handler2(new Request(MEDIA, { headers: { range: 'bytes=10-19' } }), { MEDIA_R2: r2 }, ctx).then(r => r.arrayBuffer()),
  ]);
  await Promise.all(pending);
  const fullReads = origin.calls.filter(c => c.range === null).length;
  assert.equal(fullReads, 1);
});

test('stale replica is revalidated and purged when the origin was overwritten', async () => {
  const files = file(bytes(1000), '"e1"');
  const clock = { t: 1_000_000 };
  const { run, cache, r2 } = setup({ files, clock });
  await run(MEDIA);
  cache.store.clear();
  files[PATH] = { data: bytes(1200).reverse(), etag: '"e2"' };
  clock.t += 601_000;
  const stale = await run(MEDIA, { headers: { range: 'bytes=0-9' } });
  assert.equal(stale.res.headers.get('x-makaron-cache'), 'HIT-R2', 'one stale hit is served while checking');
  assert.equal(r2.objects.has('v1/images/u1/p1/media/clip-abc.mp4'), false, 'purged after check');
  cache.store.clear();
  const fresh = await run(MEDIA);
  assert.equal(fresh.res.headers.get('x-makaron-cache'), 'MISS');
  assert.equal(fresh.res.headers.get('etag'), '"e2"');
  assert.equal(r2.objects.get('v1/images/u1/p1/media/clip-abc.mp4').customMetadata.etag, '"e2"');
});

test('private, oversized or non-media origin responses are never copied', async () => {
  for (const extra of [{ cc: 'private, max-age=0' }, { type: 'text/html' }]) {
    const { run, r2 } = setup({ files: file(bytes(100), '"e1"', extra) });
    await run(MEDIA);
    assert.equal(r2.objects.has('v1/images/u1/p1/media/clip-abc.mp4'), false, JSON.stringify(extra));
  }
  const { run, r2 } = setup({ files: file(bytes(100)), env: { MAX_FILL_BYTES: '50' } });
  await run(MEDIA);
  assert.equal(r2.objects.has('v1/images/u1/p1/media/clip-abc.mp4'), false);
  assert.equal(fillableOrigin(new Response('x', { headers: { 'content-type': 'video/mp4', etag: 'W/"x"', 'content-length': '1' } }), 10), false);
});

test('R2 failure and kill switch fall back to the plain origin request', async () => {
  const data = bytes(400);
  const a = setup({ files: file(data) });
  a.r2.fail = true;
  const failed = await a.run(MEDIA, { headers: { range: 'bytes=0-99' } });
  assert.equal(failed.res.status, 206);
  assert.deepEqual(failed.body, data.slice(0, 100));
  const b = setup({ files: file(data), env: { R2C_DISABLED: '1' } });
  const off = await b.run(MEDIA);
  assert.equal(off.res.status, 200);
  assert.equal(off.res.headers.get('x-makaron-cache'), null);
  assert.equal(b.r2.objects.size, 0);
});

test('purge endpoint requires the secret and removes R2 copies and variants', async () => {
  const data = bytes(300);
  const { run, r2, cache } = setup({ files: file(data), env: { PURGE_SECRET: 's3cret' } });
  await run(MEDIA);
  await run(MEDIA + '?download=x.mp4');
  assert.equal(r2.objects.size >= 2, true);
  const denied = await run('https://cdn.makaron.app/__r2c/purge', { method: 'POST', body: '{"paths":["images/u1/p1/media/clip-abc.mp4"]}' });
  assert.equal(denied.res.status, 401);
  const ok = await run('https://cdn.makaron.app/__r2c/purge', {
    method: 'POST', headers: { authorization: 'Bearer s3cret' },
    body: JSON.stringify({ paths: ['images/u1/p1/media/clip-abc.mp4'] }),
  });
  assert.equal(ok.res.status, 200);
  assert.equal([...r2.objects.keys()].filter(k => k.startsWith('v1/')).length, 0);
  assert.equal(cache.store.size, 0);
});

test('missing origin objects are not cached and keep the 404', async () => {
  const { run, r2 } = setup({ files: {} });
  const { res } = await run(MEDIA);
  assert.equal(res.status, 404);
  assert.equal(r2.objects.size, 0);
});

test('fill reads Storage directly and drops a version that differs from the one served', async () => {
  // Simulates Supabase's CDN: plain reads see v2, a lagging variant still sees v1.
  const v1 = bytes(1000); const v2 = bytes(900);
  const { r2, cache, run } = setup({ files: {} });
  const calls = [];
  const handler = createHandler({
    edgeCache: () => cache, now: () => 1_000_000,
    fetchOrigin: async (input, init = {}) => {
      const req = new Request(input, init); const u = new URL(req.url);
      calls.push(u.search);
      const stale = !u.searchParams.has('r2c') && req.headers.get('accept-encoding') === 'identity';
      const [data, etag] = stale ? [v1, '"e1"'] : u.searchParams.has('r2c') ? [v1, '"e1"'] : [v2, '"e2"'];
      return new Response(data, { status: 200, headers: { 'content-type': 'video/mp4', etag, 'content-length': String(data.length), 'cache-control': 'no-cache' } });
    },
  });
  const pending = [];
  const res = await handler(new Request(MEDIA), { MEDIA_R2: r2 }, { waitUntil: p => pending.push(p) });
  await res.arrayBuffer(); await Promise.all(pending);
  assert.equal(res.headers.get('etag'), '"e2"');
  assert.ok(calls.some(s => s.includes('r2c=')), 'fill bypasses Supabase CDN');
  assert.equal(r2.objects.has('v1/images/u1/p1/media/clip-abc.mp4'), false, 'mismatched version not stored');
  assert.equal(cache.store.size, 0);
  void run;
});

test('requests from bypassed continents pass straight through', async () => {
  const { r2, origin, run } = setup({ files: file(bytes(500)) });
  const req = new Request(MEDIA);
  Object.defineProperty(req, 'cf', { value: { continent: 'NA' } });
  const pending = [];
  const handler = createHandler({ fetchOrigin: origin.fetchOrigin, edgeCache: () => ({ match: async () => undefined, put: async () => {}, delete: async () => {} }), now: () => 1 });
  const res = await handler(req, { MEDIA_R2: r2, BYPASS_CONTINENTS: 'NA' }, { waitUntil: p => pending.push(p) });
  await res.arrayBuffer(); await Promise.all(pending);
  assert.equal(res.headers.get('x-makaron-cache'), null);
  assert.equal(r2.ops.length, 0);
  // Other continents still use the cache.
  const asia = await run(MEDIA);
  assert.equal(asia.res.headers.get('x-makaron-cache'), 'MISS');
});
