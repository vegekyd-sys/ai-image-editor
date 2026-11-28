import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, renderTarget, planRender, sniffImageType, stripPngGamma } from '../src/worker.mjs';

// Fake "image": a JSON header, so the fake binding can read dimensions.
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0], webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0] };
const img = (w, h, kind = 'png') => new Uint8Array([...MAGIC[kind], ...new TextEncoder().encode(JSON.stringify({ w, h }))]);
const dims = async stream => JSON.parse(new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer()).slice(8)));
const SRC = '/storage/v1/object/public/images/u1/p1/photo.png';
const RENDER = '/storage/v1/render/image/public/images/u1/p1/photo.png';
const BASE = 'https://cdn.makaron.app';

class FakeR2 {
  constructor() { this.objects = new Map(); }
  wrap(rec) {
    return { size: rec.data.length, httpMetadata: rec.httpMetadata || {}, customMetadata: rec.customMetadata || {},
      body: new Response(rec.data).body, arrayBuffer: async () => rec.data.buffer.slice(0),
      text: async () => new TextDecoder().decode(rec.data), json: async () => JSON.parse(new TextDecoder().decode(rec.data)) };
  }
  async head(k) { this.heads = (this.heads || 0) + 1; const r = this.objects.get(k); return r ? { ...this.wrap(r), body: undefined } : null; }
  async get(k) { const r = this.objects.get(k); return r ? this.wrap(r) : null; }
  async put(k, v, o = {}) {
    if (o.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(k)) return null;
    const data = new Uint8Array(await new Response(v).arrayBuffer());
    this.objects.set(k, { data, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, etag: 'x' });
    return this.wrap(this.objects.get(k));
  }
  async delete(keys) { for (const k of [].concat(keys)) this.objects.delete(k); }
}

class FakeCache {
  constructor() { this.store = new Map(); }
  async put(req, res) { this.store.set(req.url, { h: new Headers(res.headers), d: new Uint8Array(await res.arrayBuffer()) }); }
  async match(req) { const e = this.store.get(req.url); return e ? new Response(e.d, { headers: e.h }) : undefined; }
  async delete(req) { return this.store.delete(req.url); }
}

class FakeImages {
  constructor() { this.calls = []; this.error = null; }
  async info(stream) { const { w, h } = await dims(stream); return { width: w, height: h, format: 'image/png' }; }
  input(stream) {
    let transform;
    return {
      transform(t) { transform = t; return this; },
      output: async (o) => {
        if (this.error) throw new Error(this.error);
        await new Response(stream).arrayBuffer();
        this.calls.push({ transform, output: o });
        const body = new TextEncoder().encode(JSON.stringify({ transform, output: o }));
        return { response: () => new Response(body), contentType: () => o.format };
      },
    };
  }
}

function setup({ images = new FakeImages(), env = {}, sources = {}, clock = { t: 1_000_000 } } = {}) {
  const r2 = new FakeR2(); const cache = new FakeCache(); const calls = [];
  const fetchOrigin = async (input, init = {}) => {
    const req = new Request(input, init); const u = new URL(req.url);
    calls.push({ path: u.pathname, search: u.search, method: req.method });
    const extra = sources[u.pathname];
    if (u.pathname === SRC || extra) {
      const { data = img(736, 1207), type = 'image/png' } = extra || {};
      return new Response(data, { headers: { 'content-type': type, etag: '"src-1"', 'cache-control': 'max-age=604800', 'content-length': String(data.length) } });
    }
    const obj = u.pathname.replace('/render/image/', '/object/');
    if (u.pathname.startsWith('/storage/v1/render/') && (obj === SRC || sources[obj])) return new Response('supabase-render', { headers: { 'content-type': 'image/webp', 'x-from': 'supabase' } });
    if (u.pathname === RENDER) return new Response('supabase-render', { headers: { 'content-type': 'image/webp', 'x-from': 'supabase' } });
    return new Response('{"error":"not found"}', { status: 400 });
  };
  const handler = createHandler({ fetchOrigin, edgeCache: () => cache, now: () => clock.t });
  const run = async (url, init = {}) => {
    const pending = []; const ctx = { waitUntil: p => pending.push(p) };
    const res = await handler(new Request(url, init), { MEDIA_R2: r2, IMAGES: images, ...env }, ctx);
    const text = await res.text(); await Promise.all(pending);
    return { res, text };
  };
  return { r2, cache, images, calls, run, clock };
}

test('renderTarget accepts only the Supabase parameters the app uses', () => {
  const t = q => renderTarget(new URL(`${BASE}${RENDER}${q}`), 'GET');
  assert.deepEqual(t('?width=200&quality=60').opts, { width: 200, height: null, quality: 60, resize: 'cover', format: null });
  assert.equal(t('?width=2000&quality=95&resize=contain').opts.resize, 'contain');
  assert.equal(t('?width=300&quality=60&format=origin').opts.format, 'origin');
  assert.equal(t('?width=300').source.r2Key, 'v1/images/u1/p1/photo.png');
  for (const bad of ['', '?quality=60', '?width=200&foo=1', '?width=200&width=300', '?width=0', '?width=9999',
    '?width=200&quality=5', '?width=200&resize=fill', '?width=200&format=avif']) {
    assert.equal(t(bad), null, bad);
  }
  assert.equal(renderTarget(new URL(`${BASE}${RENDER}?width=200`), 'HEAD'), null);
  assert.equal(renderTarget(new URL(`${BASE}/storage/v1/render/image/public/images/a/b.gif?width=200`), 'GET'), null);
});

test('planRender mirrors Supabase: no enlarge, one-sided cover crops (capped at 8192), WebP negotiation', () => {
  const src = { type: 'image/png', width: 736, height: 1207 };
  const webp = 'image/avif,image/webp,*/*';
  assert.deepEqual(planRender({ width: 200, height: null, quality: 60, resize: 'cover', format: null }, src, webp),
    { transform: { fit: 'crop', width: 200, height: 1207 }, output: { format: 'image/webp', quality: 60 }, vary: true, needsSize: true });
  assert.deepEqual(planRender({ width: 2000, height: null, quality: 95, resize: 'contain', format: null }, src, '*/*'),
    { transform: { fit: 'scale-down', width: 2000 }, output: { format: 'image/png' }, vary: true, needsSize: false });
  assert.deepEqual(planRender({ width: 400, height: 400, quality: 60, resize: 'cover', format: 'origin' }, src, webp),
    { transform: { fit: 'crop', width: 400, height: 400 }, output: { format: 'image/png' }, vary: false, needsSize: false });
  assert.deepEqual(planRender({ width: 300, height: 300, quality: 95, resize: 'contain', format: 'webp' }, src, '*/*').output, { format: 'image/webp', quality: 95 });
  assert.equal(planRender({ width: 300, height: null, quality: 60, resize: 'cover', format: null }, { ...src, type: 'image/jpeg' }, '*/*').output.quality, 60);
  assert.deepEqual(planRender({ width: 600, height: null, quality: 80, resize: 'cover', format: null }, { type: 'image/jpeg', width: 9000, height: 9000 }, '*/*').transform,
    { fit: 'crop', width: 600, height: 8192 });
  assert.equal(planRender({ width: 300, quality: 60, resize: 'cover', format: null }, { type: null }, '*/*'), null);
  assert.equal(sniffImageType(img(1, 1, 'jpeg').buffer), 'image/jpeg');
  assert.equal(sniffImageType(img(1, 1, 'png').buffer), 'image/png');
  assert.equal(sniffImageType(img(1, 1, 'webp').buffer), null);
});

test('source type comes from bytes: JPEG labelled PNG renders as JPEG; WebP bytes go to Supabase', async () => {
  const MIS = '/storage/v1/object/public/images/u1/p1/mislabelled.png';
  const WEBP = '/storage/v1/object/public/images/u1/p1/photo.webp';
  const s = setup({ sources: { [MIS]: { data: img(640, 480, 'jpeg'), type: 'image/png' }, [WEBP]: { data: img(640, 480, 'webp'), type: 'image/webp' } } });
  const m = await s.run(`${BASE}${MIS.replace('/object/', '/render/image/')}?width=200&height=200&resize=cover`, { headers: { accept: '*/*' } });
  assert.equal(m.res.headers.get('content-type'), 'image/jpeg');
  const w1 = await s.run(`${BASE}${WEBP.replace('/object/', '/render/image/')}?width=200`, { headers: { accept: '*/*' } });
  assert.equal(w1.res.headers.get('x-from'), 'supabase');
  const w2 = await s.run(`${BASE}${WEBP.replace('/object/', '/render/image/')}?width=200`, { headers: { accept: '*/*' } });
  assert.equal(w2.res.headers.get('x-from'), 'supabase', 'remembered as pass-through');
  assert.equal(s.images.calls.length, 1);
});

test('when another request holds the fill lock, the source is read once and still transformed here', async () => {
  const s = setup();
  // Simulate a held lock: fill() cannot acquire it, so R2 stays empty.
  await s.r2.put('locks/v1/images/u1/p1/photo.png', JSON.stringify({ expires: 9e15 }));
  const r = await s.run(`${BASE}${RENDER}?width=200&height=200&resize=cover`, { headers: { accept: 'image/webp' } });
  assert.equal(r.res.headers.get('x-makaron-cache'), 'IMAGE');
  assert.equal(s.images.calls.length, 1);
  assert.ok(!s.r2.objects.has('v1/images/u1/p1/photo.png'));
  assert.ok(s.calls.every(c => c.path === SRC), 'only the source object was read, never Supabase render');
});

test('cold render copies the source into R2 once, transforms it, then serves from the edge', async () => {
  const s = setup();
  const url = `${BASE}${RENDER}?width=200&quality=60`;
  const a = await s.run(url, { headers: { accept: 'image/webp,*/*' } });
  assert.equal(a.res.status, 200);
  assert.equal(a.res.headers.get('x-makaron-cache'), 'IMAGE');
  assert.equal(a.res.headers.get('content-type'), 'image/webp');
  assert.equal(a.res.headers.get('etag'), '"src-1"');
  assert.equal(a.res.headers.get('cache-control'), 'max-age=604800');
  assert.equal(a.res.headers.get('vary'), 'Accept');
  assert.deepEqual(JSON.parse(a.text).transform, { fit: 'crop', width: 200, height: 1207 });
  assert.ok(s.r2.objects.has('v1/images/u1/p1/photo.png'));
  assert.deepEqual(s.calls.map(c => c.path), [SRC]);
  assert.match(s.calls[0].search, /r2c=/);

  const b = await s.run(url, { headers: { accept: 'image/webp,*/*' } });
  assert.equal(b.res.headers.get('x-makaron-cache'), 'HIT-IMAGE-EDGE');
  assert.equal(b.text, a.text);
  assert.equal(s.images.calls.length, 1);

  const png = await s.run(url, { headers: { accept: '*/*' } });
  assert.equal(png.res.headers.get('content-type'), 'image/png');
  assert.equal(s.images.calls.length, 2);
  assert.equal(s.calls.length, 1, 'source read from origin only once');

  const nm = await s.run(url, { headers: { accept: 'image/webp', 'if-none-match': '"src-1"' } });
  assert.equal(nm.res.status, 304);
});

test('unsupported requests and binding failures fall back to Supabase render unchanged', async () => {
  const s = setup();
  for (const [q, init] of [['?width=200&foo=1', {}], ['?width=200', { method: 'HEAD' }], ['?width=200', { headers: { range: 'bytes=0-99' } }]]) {
    const r = await s.run(`${BASE}${RENDER}${q}`, init);
    assert.equal(r.res.headers.get('x-from'), 'supabase');
    assert.equal(r.res.headers.get('x-makaron-cache'), 'MISS');
  }
  assert.equal(s.images.calls.length, 0);

  const quota = setup();
  quota.images.error = 'IMAGES_TRANSFORM_ERROR 9422: monthly limit';
  const q1 = await quota.run(`${BASE}${RENDER}?width=200`);
  assert.equal(q1.res.headers.get('x-from'), 'supabase');
  quota.images.error = null;
  const q2 = await quota.run(`${BASE}${RENDER}?width=300`);
  assert.equal(q2.res.headers.get('x-from'), 'supabase', 'paused after 9422');
  assert.equal(quota.images.calls.length, 0);

  const off = setup({ env: { RENDER_DISABLED: '1' } });
  assert.equal((await off.run(`${BASE}${RENDER}?width=200`)).res.headers.get('x-from'), 'supabase');
  const noBinding = setup({ images: null });
  assert.equal((await noBinding.run(`${BASE}${RENDER}?width=200`)).res.headers.get('x-from'), 'supabase');
});

test('missing sources keep the Supabase error response', async () => {
  const s = setup();
  const r = await s.run(`${BASE}/storage/v1/render/image/public/images/nope/missing.png?width=200`);
  assert.equal(r.res.status, 400);
  assert.equal(s.images.calls.length, 0);
});

test('warm hits skip R2 for 60s, then one R2 head re-confirms; an overwritten source re-renders', async () => {
  const s = setup();
  const url = `${BASE}${RENDER}?width=200&height=200&resize=cover`;
  const opts = { headers: { accept: 'image/webp' } };
  await s.run(url, opts);
  s.r2.heads = 0;
  const a = await s.run(url, opts);
  assert.equal(a.res.headers.get('x-makaron-cache'), 'HIT-IMAGE-EDGE');
  assert.equal(s.r2.heads, 0, 'no R2 round trip within the edge TTL');
  assert.equal(a.res.headers.get('etag'), '"src-1"');
  assert.equal(a.res.headers.get('cache-control'), 'max-age=604800');

  s.clock.t += 61_000;
  const b = await s.run(url, opts);
  assert.equal(b.res.headers.get('x-makaron-cache'), 'HIT-IMAGE-EDGE');
  assert.equal(s.r2.heads, 1, 'one head to re-confirm the source');
  const c = await s.run(url, opts);
  assert.equal(s.r2.heads, 1, 're-confirmed entry is fresh again');

  // Source overwritten: the purge removed R2's copy and origin has a new etag.
  const rec = s.r2.objects.get('v1/images/u1/p1/photo.png');
  rec.customMetadata = { ...rec.customMetadata, etag: '"src-2"' };
  s.clock.t += 61_000;
  const d = await s.run(url, opts);
  assert.equal(d.res.headers.get('x-makaron-cache'), 'IMAGE', 're-rendered after the source changed');
  assert.equal(d.res.headers.get('etag'), '"src-2"');
  assert.equal(s.images.calls.length, 2);
});

test('stripPngGamma removes only gAMA and cHRM chunks', () => {
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length); const v = new DataView(out.buffer);
    v.setUint32(0, data.length); out.set([...type].map(c => c.charCodeAt(0)), 4); out.set(data, 8); v.setUint32(8 + data.length, 0xdeadbeef);
    return out;
  };
  const parts = [new Uint8Array(MAGIC.png), chunk('IHDR', new Uint8Array(13).fill(1)), chunk('gAMA', new Uint8Array(4).fill(2)),
    chunk('cHRM', new Uint8Array(32).fill(3)), chunk('IDAT', new Uint8Array(20).fill(4)), chunk('IEND', new Uint8Array(0))];
  const join = ps => { const o = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
  const out = new Uint8Array(stripPngGamma(join(parts).buffer));
  assert.deepEqual(out, join([parts[0], parts[1], parts[4], parts[5]]));
  const plain = join([parts[0], parts[1], parts[4], parts[5]]).buffer;
  assert.equal(stripPngGamma(plain), plain, 'untouched when nothing to drop');
  const truncated = join(parts).buffer.slice(0, 40);
  assert.equal(stripPngGamma(truncated), truncated, 'malformed input left alone');
});
