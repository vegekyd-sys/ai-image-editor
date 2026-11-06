import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, parseRange, acquireFillLock } from '../src/worker.mjs';

function fixture({ type = 'video/mp4', policy = 'public, max-age=3600', cookie } = {}) {
  let data = new TextEncoder().encode('0123456789abcdef'), etag = '"v1"';
  let missing = false;
  const calls = [], objects = new Map(), locks = new Map(), edges = new Map(), tasks = [];
  let generation = 0;
  const headers = () => ({ ...(cookie ? { 'set-cookie': cookie } : {}), 'content-type': type, 'content-length': String(data.length), etag, 'cache-control': policy, 'last-modified': 'Mon, 19 Oct 2026 00:00:00 GMT' });
  const fetchOrigin = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push({ method: req.method, range: req.headers.get('range') });
    if (missing) return new Response('gone', { status: 404 });
    if (req.method === 'HEAD') return new Response(null, { headers: headers() });
    const range = parseRange(req.headers.get('range'), data.length);
    if (range && typeof range !== 'string') return new Response(data.slice(range.offset, range.offset + range.length), {
      status: 206, headers: { ...headers(), 'content-length': String(range.length), 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${data.length}` },
    });
    return new Response(data, { headers: headers() });
  };
  const cache = {
    async match(req) {
      const saved = edges.get(req.url); if (!saved) return;
      const range = parseRange(req.headers.get('range'), saved.bytes.length);
      if (range && typeof range !== 'string') return new Response(saved.bytes.slice(range.offset, range.offset + range.length), {
        status: 206, headers: { ...saved.headers, 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${saved.bytes.length}`, 'content-length': String(range.length) },
      });
      return new Response(saved.bytes, { headers: saved.headers });
    },
    async put(req, response) { edges.set(req.url, { bytes: new Uint8Array(await response.arrayBuffer()), headers: Object.fromEntries(response.headers) }); },
    async delete(req) { return edges.delete(req.url); },
  };
  const bucket = {
    async head(key) { return objects.has(key) ? {} : null; },
    async get(key, options) {
      if (key.startsWith('v1/locks/')) { const lock = locks.get(key); return lock ? { etag: lock.etag, json: async () => JSON.parse(lock.body) } : null; }
      const bytes = objects.get(key); if (!bytes) return null; const range = options?.range; return { body: new Response(range ? bytes.slice(range.offset, range.offset + range.length) : bytes).body };
    },
    async put(key, stream, options) {
      if (typeof stream === 'string') {
        const previous = locks.get(key);
        if (options?.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
        if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== previous?.etag) return null;
        const etag = String(++generation); locks.set(key, { body: stream, etag }); return { etag };
      }
      objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer())); return {};
    },
  };
  const handle = createHandler({ fetchOrigin, edgeCache: () => cache,  });
  return {
    calls, objects, edges, bucket,
    change() { data = new TextEncoder().encode('fedcba9876543210'); etag = '"v2"'; edges.clear(); },
    remove() { missing = true; edges.clear(); },
    async request(options = {}, path = '/storage/v1/object/public/images/test.mp4') {
      return handle(new Request('https://candidate.test' + path, options), { ORIGIN_HOST: 'origin.test', CDN_HOST: 'cdn.test', MEDIA_CACHE: bucket, MEASURE_ORIGIN: '0' }, { waitUntil(p) { tasks.push(p); } });
    },
    async settle() { while (tasks.length) await Promise.all(tasks.splice(0)); },
  };
}

test('cold full response fills R2; warm edge and R2 serve exact bytes without origin GET', async () => {
  const f = fixture();
  const first = await f.request(); assert.equal(first.headers.get('x-makaron-cache'), 'MISS'); assert.equal(await first.text(), '0123456789abcdef'); await f.settle();
  assert.equal(f.objects.size, 1);
  const warm = await f.request(); assert.equal(warm.headers.get('x-makaron-cache'), 'R2'); assert.equal(await warm.text(), '0123456789abcdef'); await f.settle();
  f.edges.clear();
  const r2 = await f.request(); assert.equal(r2.headers.get('x-makaron-cache'), 'R2'); assert.equal(await r2.text(), '0123456789abcdef'); await f.settle();
  assert.equal(f.calls.filter(c => c.method === 'GET').length, 2);
});
test('cold Range returns requested bytes and warms one complete replica', async () => {
  const f = fixture(); const response = await f.request({ headers: { range: 'bytes=4-7' } });
  assert.equal(response.status, 206); assert.equal(await response.text(), '4567'); await f.settle();
  assert.equal(f.objects.size, 1);
  const warm = await f.request({ headers: { range: 'bytes=-3' } }); assert.equal(warm.status, 206); assert.equal(await warm.text(), 'def');
  assert.equal(warm.headers.get('content-range'), 'bytes 13-15/16');
});
test('HEAD never downloads or falsely claims a body hit', async () => {
  const f = fixture(); const r = await f.request({ method: 'HEAD' }); await f.settle();
  assert.equal(r.headers.get('x-makaron-cache'), 'METADATA'); assert.equal(await r.text(), ''); assert.equal(f.objects.size, 0); assert.equal(f.calls.length, 1);
});
test('conditional requests and unsatisfiable ranges respect HTTP semantics', async () => {
  const f = fixture();
  assert.equal((await f.request({ headers: { 'if-match': '"old"' } })).status, 412);
  assert.equal((await f.request({ headers: { 'if-unmodified-since': 'Sat, 01 Jan 2000 00:00:00 GMT' } })).status, 412);
  assert.equal((await f.request({ headers: { 'if-none-match': 'W/"v1"' } })).status, 304);
  assert.equal((await f.request({ headers: { range: 'bytes=99-' } })).status, 416);
  const mismatch = await f.request({ headers: { range: 'bytes=1-2', 'if-range': '"old"' } }); assert.equal(mismatch.status, 200); assert.equal(await mismatch.text(), '0123456789abcdef'); await f.settle();
});
test('updates get a new replica and deleted sources do not serve old replicas after metadata expiry', async () => {
  const f = fixture(); await (await f.request()).text(); await f.settle(); f.change();
  assert.equal(await (await f.request()).text(), 'fedcba9876543210'); await f.settle(); assert.equal(f.objects.size, 2);
  f.remove(); assert.equal((await f.request()).status, 404);
});
test('signed, authenticated and nonpublic paths bypass all shared storage', async () => {
  for (const [opts, path] of [[{ headers: { authorization: 'Bearer private' } }, undefined], [{ headers: { cookie: 'session=x' } }, undefined], [{}, '/storage/v1/object/sign/images/a?token=secret'], [{}, '/storage/v1/object/public/images/a?token=secret'], [{}, '/rest/v1/users']]) {
    const f = fixture(); const r = await f.request(opts, path); await r.text(); await f.settle(); assert.equal(f.objects.size, 0); assert.equal(f.edges.size, 0); assert.equal(f.calls.length, 1);
  }
});
test('nonmedia and private/no-store origins cannot enter shared cache', async () => {
  for (const config of [{ type: 'application/json' }, { policy: 'private' }, { policy: 'no-store' }]) {
    const f = fixture(config); assert.equal((await f.request()).headers.get('x-makaron-cache'), 'BYPASS'); assert.equal(f.objects.size, 0); assert.equal(f.edges.size, 0);
  }
});
test('query variants use different cache objects', async () => {
  const f = fixture();
  for (const width of [100, 200]) { await (await f.request({}, '/storage/v1/render/image/public/images/a?width=' + width)).text(); await f.settle(); }
  assert.equal(f.objects.size, 2);
});
test('R2 failure falls back to original response', async () => {
  const f = fixture(); f.bucket.get = async () => { throw new Error('unavailable'); };
  const r = await f.request(); assert.equal(r.headers.get('x-makaron-cache'), 'BYPASS'); assert.equal(await r.text(), '0123456789abcdef');
});
test('rejected replica writes do not hang or truncate user download', async () => {
  const f = fixture(); f.bucket.put = async () => { throw new Error('quota'); };
  const r = await f.request(); assert.equal(await r.text(), '0123456789abcdef'); await f.settle();
});
test('R2 conditional lease prevents duplicate fills across independent requests', async () => {
  const f = fixture();
  const leases = await Promise.all([acquireFillLock(f.bucket, 'shared'), acquireFillLock(f.bucket, 'shared'), acquireFillLock(f.bucket, 'shared')]);
  assert.equal(leases.filter(Boolean).length, 1);
});
test('range parser rejects multi-range and unsafe numbers', () => {
  assert.equal(parseRange('bytes=0-1,3-4', 10), 'unsupported'); assert.equal(parseRange('bytes=999999999999999999999-', 10), 'unsupported'); assert.deepEqual(parseRange('bytes=3-99', 10), { offset: 3, length: 7 });
});
test('origin no-cache revalidates metadata on every request but reuses stored media bytes', async () => {
  const f = fixture({ policy: 'no-cache' });
  for (let i = 0; i < 3; i++) { const r = await f.request(); assert.match(r.headers.get('cache-control'), /max-age=0/); await r.text(); await f.settle(); }
  assert.equal(f.calls.filter(c => c.method === 'HEAD').length, 3);
  assert.equal(f.calls.filter(c => c.method === 'GET').length, 2);
});

test('only known Cloudflare infrastructure cookies can be removed before caching', async () => {
  for (const cookie of ['__cf_bm=bot; Path=/; HttpOnly', '_cfuvid=visitor; Path=/']) {
    const f = fixture({ cookie }); const r = await f.request(); assert.equal(r.headers.get('x-makaron-cache'), 'MISS'); assert.equal(r.headers.has('set-cookie'), false); await r.text(); await f.settle(); assert.equal(f.objects.size, 1);
  }
  for (const cookie of ['session=private', '__cf_bm=bot, session=private']) {
    const f = fixture({ cookie }); const r = await f.request(); assert.equal(r.headers.get('x-makaron-cache'), 'BYPASS'); assert.equal(f.objects.size, 0);
  }
});
