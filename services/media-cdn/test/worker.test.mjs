import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import { createHandler, parseRange, acquireFillLock } from '../src/worker.mjs';

const signingSecret = 'unit-test-signing-secret-at-least-32-bytes';
function renderQuery(metadata, bypass = false, delivery) {
  const payload = Buffer.from(JSON.stringify({v: 1, expires: Date.now() + 3600_000, ...(delivery ? {delivery} : {}), ...(bypass ? {bypass: true} : {metadata})})).toString('base64url');
  const sig = createHmac('sha256', signingSecret).update('https://origin.test/storage/v1/object/public/images/test.mp4\n' + payload).digest('base64url');
  return '?__mk_render=' + payload + '.' + sig;
}
function fixture({ type = 'video/mp4', policy = 'public, max-age=3600', headPolicy, cookie, ignoreRange = false, gatewayFailures = 0, renderReplica = false } = {}) {
  let data = new TextEncoder().encode('0123456789abcdef'), etag = '"v1"';
  let missing = false;
  const calls = [], objects = new Map(), objectMetadata = new Map(), locks = new Map(), edges = new Map(), tasks = [];
  let generation = 0;
  const headers = () => ({ ...(cookie ? { 'set-cookie': cookie } : {}), 'content-type': type, 'content-length': String(data.length), etag, 'cache-control': policy,
    'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff', 'last-modified': 'Mon, 19 Oct 2026 00:00:00 GMT' });
  const fetchOrigin = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push({ method: req.method, range: req.headers.get('range'), url: req.url, ifMatch: req.headers.get('if-match') });
    if (missing) return new Response('gone', { status: 404 });
    if (req.headers.has('if-match') && req.headers.get('if-match') !== etag) return new Response('changed', {status: 412});
    if (req.headers.has('if-match') && gatewayFailures-- > 0) return new Response('gateway unavailable', {status: 502});
    if (req.method === 'HEAD') return new Response(null, { headers: {...headers(), ...(headPolicy ? {'cache-control': headPolicy} : {})} });
    const range = parseRange(req.headers.get('range'), data.length);
    if (!ignoreRange && range && typeof range !== 'string') return new Response(data.slice(range.offset, range.offset + range.length), {
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
      const bytes = objects.get(key); if (!bytes) return null; const range = options?.range; return {size: bytes.length, ...(range ? {range} : {}), body: new Response(range ? bytes.slice(range.offset, range.offset + range.length) : bytes).body };
    },
    async put(key, stream, options) {
      if (typeof stream === 'string') {
        const previous = locks.get(key);
        if (options?.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
        if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== previous?.etag) return null;
        const etag = String(++generation); locks.set(key, { body: stream, etag }); return { etag };
      }
      objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer())); objectMetadata.set(key, options?.customMetadata); return {};
    },
  };
  const handle = createHandler({ fetchOrigin, edgeCache: () => cache,  });
  return {
    calls, objects, objectMetadata, edges, bucket,
    change() { data = new TextEncoder().encode('fedcba9876543210'); etag = '"v2"'; for (const key of edges.keys()) if (key.endsWith('/metadata')) edges.delete(key); },
    remove() { missing = true; for (const key of edges.keys()) if (key.endsWith('/metadata')) edges.delete(key); },
    async request(options = {}, path = '/storage/v1/object/public/images/test.mp4') {
      return handle(new Request('https://candidate.test' + path, options), { ORIGIN_HOST: 'origin.test', CDN_HOST: 'cdn.test', MEDIA_CACHE: bucket, ...(renderReplica ? {RENDER_CACHE: bucket, RENDER_REPLICA: '1'} : {}), MEASURE_CACHE: '0', MEASURE_ORIGIN: '0', RENDER_SIGNING_SECRET: signingSecret }, { waitUntil(p) { tasks.push(p); } });
    },
    async settle() { while (tasks.length) await Promise.all(tasks.splice(0)); },
  };
}

test('cold edge streams origin while R2 warms; ready edge avoids origin body reads', async () => {
  const f = fixture();
  const first = await f.request(); assert.equal(first.headers.get('x-makaron-cache'), 'MISS'); assert.equal(await first.text(), '0123456789abcdef'); await f.settle();
  assert.equal(f.objects.size, 1);
  const warm = await f.request(); assert.equal(warm.headers.get('x-makaron-cache'), 'HIT'); assert.equal(await warm.text(), '0123456789abcdef'); await f.settle();
  f.edges.clear();
  const r2 = await f.request(); assert.equal(r2.headers.get('x-makaron-cache'), 'MISS'); assert.equal(await r2.text(), '0123456789abcdef'); await f.settle();
  assert.equal((await f.request()).headers.get('x-makaron-cache'), 'HIT');
  assert.equal(f.calls.filter(c => c.method === 'GET' && c.range !== 'bytes=0-0').length, 3);
});
test('a verified render version skips every origin metadata probe and shares the versioned body cache', async () => {
  const f = fixture(); const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  const source = '/storage/v1/object/public/images/test.mp4';
  const first = await f.request({}, source + query);
  assert.equal(await first.text(), '0123456789abcdef'); await f.settle();
  const ready = await f.request({headers: {range: 'bytes=4-7'}}, source + query);
  assert.equal(ready.status, 206); assert.equal(await ready.text(), '4567');
  assert.equal(ready.headers.get('x-makaron-cache'), 'HIT');
  assert.equal(f.calls.filter(c => c.range === 'bytes=0-0' || c.method === 'HEAD').length, 0);
  assert.equal(f.calls.filter(c => c.url.includes('__mk_render')).length, 0);
});
test('render replicas serve exact native ranges without depending on edge body caching', async () => {
  const f = fixture({renderReplica: true});
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  const path = '/storage/v1/object/public/images/test.mp4' + query;
  assert.equal(await (await f.request({}, path)).text(), '0123456789abcdef'); await f.settle();
  const reads = f.calls.length;
  const response = await f.request({headers: {range: 'bytes=4-7'}}, path);
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 4-7/16');
  assert.equal(response.headers.get('x-makaron-cache'), 'R2'); assert.equal(await response.text(), '4567');
  assert.equal(f.calls.length, reads); assert.equal(f.edges.size, 0);
});
test('native warm capabilities publish a separate key namespace and source-version proof', async () => {
  const f = fixture({renderReplica: true});
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600}, false, 'native');
  const path = '/storage/v1/object/public/images/test.mp4' + query;
  assert.equal(await (await f.request({}, path)).text(), '0123456789abcdef'); await f.settle();
  const key = [...f.objects.keys()][0]; assert.match(key, /^v1\/native\/[a-f0-9]{64}\/[a-f0-9]{64}$/);
  assert.deepEqual(f.objectMetadata.get(key), {'makaron-source-etag': '"v1"', 'makaron-source-size': '16'});
  assert.equal((await f.request({headers: {range: 'bytes=0-0'}}, path)).headers.get('x-makaron-cache'), 'R2');
});
test('verified versions retain origin no-cache browser freshness', async () => {
  const f = fixture();
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 0});
  const response = await f.request({}, '/storage/v1/object/public/images/test.mp4' + query);
  assert.match(response.headers.get('cache-control'), /max-age=0/); await response.text(); await f.settle();
});
test('a stuck render replica lookup returns to origin within the bounded lookup budget', async () => {
  const f = fixture({renderReplica: true}); let release;
  f.bucket.get = () => new Promise(resolve => {release = resolve;});
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  const start = Date.now(); const response = await f.request({}, '/storage/v1/object/public/images/test.mp4' + query);
  assert.equal(await response.text(), '0123456789abcdef'); assert.ok(Date.now() - start < 500);
  release(null); await f.settle();
});
test('a replica with an incorrect full size cannot replace the original media', async () => {
  const f = fixture({renderReplica: true});
  f.bucket.get = async () => ({size: 3, body: new Response('bad').body});
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  assert.equal(await (await f.request({}, '/storage/v1/object/public/images/test.mp4' + query)).text(), '0123456789abcdef');
  await f.settle();
});
test('a transient origin gateway failure retries the same pinned range before exposing bytes', async () => {
  const f = fixture({gatewayFailures: 1});
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  const response = await f.request({headers: {range: 'bytes=4-7'}}, '/storage/v1/object/public/images/test.mp4' + query);
  assert.equal(response.status, 206); assert.equal(await response.text(), '4567');
  assert.deepEqual(f.calls.slice(0, 2).map(c => [c.range, c.ifMatch]), [['bytes=4-7', '"v1"'], ['bytes=4-7', '"v1"']]);
  await f.settle();
});
test('persistent gateway errors stop after one retry and cannot fill the cache', async () => {
  const f = fixture({gatewayFailures: 10});
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  const response = await f.request({}, '/storage/v1/object/public/images/test.mp4' + query);
  assert.equal(response.status, 502); assert.equal(await response.text(), 'gateway unavailable');
  await f.settle(); assert.equal(f.calls.length, 2); assert.equal(f.objects.size, 0); assert.equal(f.edges.size, 0);
});
test('a signed origin fallback bypasses R2 and all version probes', async () => {
  const f = fixture(); f.bucket.head = () => {throw new Error('must not inspect replicas');};
  const response = await f.request({}, '/storage/v1/object/public/images/test.mp4' + renderQuery(null, true));
  assert.equal(response.headers.get('x-makaron-cache'), 'ORIGIN');
  assert.equal(await response.text(), '0123456789abcdef'); await f.settle();
  assert.equal(f.calls.length, 1); assert.equal(f.objects.size, 0);
  assert.equal(f.calls[0].url.includes('__mk_render'), false);
});
test('tampered capabilities are rejected before a cached hit and a changed cold version cannot replace the requested bytes', async () => {
  const f = fixture(); const source = '/storage/v1/object/public/images/test.mp4';
  const query = renderQuery({etag: '"v1"', size: 16, type: 'video/mp4', freshness: 3600});
  await (await f.request({}, source + query)).text(); await f.settle();
  const dot = query.lastIndexOf('.') + 1;
  const bad = query.slice(0, dot) + (query[dot] === 'a' ? 'b' : 'a') + query.slice(dot + 1);
  assert.equal((await f.request({}, source + bad)).status, 403);
  const cold = fixture(); cold.change();
  assert.equal((await cold.request({}, source + query)).status, 412);
  await cold.settle(); assert.equal(cold.objects.size, 0);
});
test('cold Range returns requested bytes and warms one complete replica', async () => {
  const f = fixture(); const response = await f.request({ headers: { range: 'bytes=4-7' } });
  assert.equal(response.status, 206); assert.equal(await response.text(), '4567'); await f.settle();
  assert.equal(f.objects.size, 1);
  const warm = await f.request({ headers: { range: 'bytes=-3' } }); assert.equal(warm.status, 206); assert.equal(await warm.text(), 'def');
  assert.equal(warm.headers.get('content-range'), 'bytes 13-15/16');
});
test('public media cache preserves origin document protections', async () => {
  const f = fixture({type: 'image/svg+xml'});
  const cold = await f.request(); await cold.text(); await f.settle();
  const ready = await f.request();
  for (const response of [cold, ready]) {
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});
test('HEAD checks one metadata byte without filling media or falsely claiming a body hit', async () => {
  const f = fixture(); const r = await f.request({ method: 'HEAD' }); await f.settle();
  assert.equal(r.headers.get('x-makaron-cache'), 'METADATA'); assert.equal(await r.text(), ''); assert.equal(f.objects.size, 0); assert.equal(f.calls.length, 1);
});
test('audio/video metadata uses one GET probe, and versioned edge bodies outlive metadata', async () => {
  const f = fixture();
  await (await f.request()).text(); await f.settle();
  const warm = await f.request(); await warm.text(); await f.settle();
  assert.equal(f.calls.filter(c => c.method === 'HEAD').length, 0);
  assert.equal(f.calls.filter(c => c.range === 'bytes=0-0').length, 1);
  assert.match(warm.headers.get('cache-control'), /max-age=3600/);
  const body = [...f.edges.entries()].find(([key]) => key.includes('/body/'))[1];
  assert.match(body.headers['cache-control'], /max-age=86400/);
  f.change();
  assert.equal(await (await f.request()).text(), 'fedcba9876543210');
});
test('short origin freshness is preserved for both metadata and browser', async () => {
  const f = fixture({policy: 'public, max-age=10'});
  const response = await f.request(); await response.text(); await f.settle();
  assert.match(response.headers.get('cache-control'), /max-age=10/);
  const metadata = [...f.edges.entries()].find(([key]) => key.endsWith('/metadata'))[1];
  assert.equal(metadata.headers['cache-control'], 'public, max-age=10');
});
test('private HEAD uses a public one-byte GET policy and retains the full object size', async () => {
  const f = fixture({headPolicy: 'private, no-cache'});
  const first = await f.request();
  assert.equal(first.headers.get('x-makaron-cache'), 'MISS');
  assert.equal(first.headers.get('content-length'), '16');
  assert.equal(await first.text(), '0123456789abcdef'); await f.settle();
  const ranged = await f.request({headers: {range: 'bytes=4-7'}});
  assert.equal(ranged.status, 206); assert.equal(await ranged.text(), '4567');
  assert.equal(f.calls.filter(c => c.range === 'bytes=0-0').length, 1);
});
test('private GET and origins ignoring the one-byte probe are never cached', async () => {
  for (const config of [{policy: 'private'}, {headPolicy: 'private', ignoreRange: true}]) {
    const f = fixture(config);
    const response = await f.request();
    assert.equal(response.headers.get('x-makaron-cache'), 'BYPASS');
    assert.equal(await response.text(), '0123456789abcdef');
    await f.settle(); assert.equal(f.objects.size, 0); assert.equal(f.edges.size, 0);
  }
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
test('R2 failure never owns or delays the original response', async () => {
  const f = fixture(); f.bucket.get = async () => { throw new Error('unavailable'); };
  const r = await f.request(); assert.equal(r.headers.get('x-makaron-cache'), 'MISS'); assert.equal(await r.text(), '0123456789abcdef'); await f.settle();
});
test('a stuck R2 operation cannot block a cold client read', async () => {
  const f = fixture(); let release;
  const pending = new Promise(resolve => {release = resolve;});
  f.bucket.head = () => pending;
  const response = await f.request();
  assert.equal(await response.text(), '0123456789abcdef');
  assert.equal(response.headers.get('x-makaron-cache'), 'MISS');
  release(null); await f.settle();
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
  assert.equal(f.calls.filter(c => c.range === 'bytes=0-0').length, 3);
  assert.equal(f.calls.filter(c => c.method === 'GET' && c.range !== 'bytes=0-0').length, 2);
});

test('only known Cloudflare infrastructure cookies can be removed before caching', async () => {
  for (const cookie of ['__cf_bm=bot; Path=/; HttpOnly', '_cfuvid=visitor; Path=/']) {
    const f = fixture({ cookie }); const r = await f.request(); assert.equal(r.headers.get('x-makaron-cache'), 'MISS'); assert.equal(r.headers.has('set-cookie'), false); await r.text(); await f.settle(); assert.equal(f.objects.size, 1);
  }
  for (const cookie of ['session=private', '__cf_bm=bot, session=private']) {
    const f = fixture({ cookie }); const r = await f.request(); assert.equal(r.headers.get('x-makaron-cache'), 'BYPASS'); assert.equal(f.objects.size, 0);
  }
});
