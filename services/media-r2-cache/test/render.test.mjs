import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, renderTarget, planRender } from '../src/worker.mjs';

// Fake "image": a JSON header, so the fake binding can read dimensions.
const img = (w, h) => new TextEncoder().encode(JSON.stringify({ w, h }));
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
  async head(k) { const r = this.objects.get(k); return r ? { ...this.wrap(r), body: undefined } : null; }
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
  async info(stream) { const { w, h } = JSON.parse(await new Response(stream).text()); return { width: w, height: h, format: 'image/png' }; }
  input(stream) {
    const self = this; let transform;
    return {
      transform(t) { transform = t; return this; },
      async output(o) {
        if (self.error) throw new Error(self.error);
        await new Response(stream).arrayBuffer();
        self.calls.push({ transform, output: o });
        const body = new TextEncoder().encode(JSON.stringify({ transform, output: o }));
        return { response: () => new Response(body), contentType: () => o.format };
      },
    };
  }
}

function setup({ images = new FakeImages(), env = {} } = {}) {
  const r2 = new FakeR2(); const cache = new FakeCache(); const calls = [];
  const fetchOrigin = async (input, init = {}) => {
    const req = new Request(input, init); const u = new URL(req.url);
    calls.push({ path: u.pathname, search: u.search, method: req.method });
    if (u.pathname === SRC) {
      const data = img(736, 1207);
      return new Response(data, { headers: { 'content-type': 'image/png', etag: '"src-1"', 'cache-control': 'max-age=604800', 'content-length': String(data.length) } });
    }
    if (u.pathname === RENDER) return new Response('supabase-render', { headers: { 'content-type': 'image/webp', 'x-from': 'supabase' } });
    return new Response('{"error":"not found"}', { status: 400 });
  };
  const handler = createHandler({ fetchOrigin, edgeCache: () => cache, now: () => 1_000_000 });
  const run = async (url, init = {}) => {
    const pending = []; const ctx = { waitUntil: p => pending.push(p) };
    const res = await handler(new Request(url, init), { MEDIA_R2: r2, IMAGES: images, ...env }, ctx);
    const text = await res.text(); await Promise.all(pending);
    return { res, text };
  };
  return { r2, cache, images, calls, run };
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

test('planRender mirrors Supabase: no enlarge, one-sided cover crops, WebP negotiation', () => {
  const src = { contentType: 'image/png', width: 736, height: 1207 };
  const webp = 'image/avif,image/webp,*/*';
  assert.deepEqual(planRender({ width: 200, height: null, quality: 60, resize: 'cover', format: null }, src, webp),
    { transform: { fit: 'crop', width: 200, height: 1207 }, output: { format: 'image/webp', quality: 60 }, vary: true });
  assert.deepEqual(planRender({ width: 2000, height: null, quality: 95, resize: 'contain', format: null }, src, '*/*'),
    { transform: { fit: 'scale-down', width: 2000 }, output: { format: 'image/png' }, vary: true });
  assert.deepEqual(planRender({ width: 400, height: 400, quality: 60, resize: 'cover', format: 'origin' }, src, webp),
    { transform: { fit: 'crop', width: 400, height: 400 }, output: { format: 'image/png' }, vary: false });
  assert.deepEqual(planRender({ width: 300, height: 300, quality: 95, resize: 'contain', format: 'webp' }, src, '*/*'),
    { transform: { fit: 'scale-down', width: 300, height: 300 }, output: { format: 'image/webp', quality: 95 }, vary: true });
  assert.equal(planRender({ width: 300, height: null, quality: 60, resize: 'cover', format: null }, { ...src, contentType: 'image/jpeg' }, '*/*').output.quality, 60);
  assert.equal(planRender({ width: 300, quality: 60, resize: 'cover', format: null }, { contentType: 'image/gif' }, '*/*'), null);
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
  for (const [q, init] of [['?width=200&foo=1', {}], ['?width=200', { method: 'HEAD' }]]) {
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
