// Makaron public-media pull-through cache for cdn.makaron.app.
//
// Supabase Storage stays authoritative. This Worker sits on the existing
// cdn.makaron.app route and serves public media from three tiers:
//   1. Cloudflare edge cache (Cache API, per location, short TTL)
//   2. R2 (persistent replica, one per object version, lifecycle-expired)
//   3. Supabase origin (unchanged request, exactly as before)
// The request path never waits on an extra origin probe: on a miss the original
// request is forwarded as-is and the R2 fill happens in the background.
// Any unexpected error falls back to the plain origin request (fail open).

const PUBLIC_OBJECT = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;
const MEDIA_EXT = /\.(?:mp4|m4v|mov|webm|mp3|wav|m4a|aac|ogg|oga|opus|flac|jpe?g|png|webp|gif|avif)$/i;
const MEDIA_TYPE = /^(?:video|audio|image)\//i;
// Generic binary type some writers used for media (e.g. run_code .wav outputs
// before 2026-11-07). Trusted as media only when the path has a media extension.
const BINARY_TYPE = /^application\/octet-stream\s*(?:;|$)/i;
const PASS_HEADERS = ['content-type', 'content-disposition', 'content-language', 'last-modified', 'etag'];
const EXPOSE = 'Content-Range, Content-Length, ETag, Accept-Ranges, X-Makaron-Cache';
const KEY_VERSION = 'v1';

export const DEFAULTS = {
  ORIGIN_HOST: 'sdyrtztrjgmmpnirswxt.supabase.co',
  EDGE_TTL_SECONDS: '60',           // per-colo edge copies; bounds staleness when zone purge is not configured
  REVALIDATE_SECONDS: '600',        // R2 copies are re-checked against origin after this
  MAX_FILL_BYTES: String(1024 ** 3), // larger objects are never copied (stay on origin)
  MAX_EDGE_BYTES: String(512 * 1024 ** 2), // Cache API object limit
  LOCK_SECONDS: '120',
  // Comma-separated client continent codes (request.cf.continent) served by
  // plain passthrough, e.g. "NA" to keep Remotion Lambda on the old path.
  // Off by default: a 2026-11-05 A/B showed equal Lambda export times.
  BYPASS_CONTINENTS: '',
  // Rendered images are keyed by source etag, so edge copies can live longer.
  RENDER_EDGE_TTL_SECONDS: '86400',
  RENDER_PAUSE_SECONDS: '600',
  RENDER_DISABLED: '0',
};

const num = (env, name) => Number(env[name] ?? DEFAULTS[name]);

/**
 * Decide whether a request is a cacheable public media read.
 * Returns {bucket, path, r2Key, edgeKey} or null for passthrough.
 */
export function cacheTarget(url, method) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const match = PUBLIC_OBJECT.exec(url.pathname);
  if (!match || !MEDIA_EXT.test(url.pathname)) return null;
  // Only bare URLs or a sole `download` parameter are cached. Anything else
  // (e.g. `?t=<timestamp>` cache busters used after overwrites) bypasses.
  const params = [...url.searchParams.keys()];
  if (params.some(name => name !== 'download') || params.length > 1) return null;
  const download = url.searchParams.has('download') ? url.searchParams.get('download') : null;
  const [, bucket, rawPath] = match;
  let path;
  try { path = decodeURIComponent(rawPath); } catch { return null; }
  if (path.includes('..')) return null;
  const variant = download === null ? '' : `?download=${encodeURIComponent(download)}`;
  return {
    bucket,
    path,
    variant,
    r2Key: `${KEY_VERSION}/${bucket}/${path}${variant}`,
    edgeKey: `https://${url.host}/__r2c/${KEY_VERSION}/${bucket}/${encodeURI(path)}${variant}`,
  };
}

function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some(v => v.trim() === '*' || v.trim().replace(/^W\//, '') === bare);
}

/** Headers we send to clients for a cached copy, mirroring the origin. */
function clientHeaders(meta, status) {
  const h = new Headers();
  if (meta.contentType) h.set('content-type', meta.contentType);
  if (meta.contentDisposition) h.set('content-disposition', meta.contentDisposition);
  if (meta.lastModified) h.set('last-modified', meta.lastModified);
  if (meta.etag) h.set('etag', meta.etag);
  h.set('cache-control', meta.cacheControl || 'no-cache');
  h.set('accept-ranges', 'bytes');
  h.set('access-control-allow-origin', '*');
  h.set('access-control-expose-headers', EXPOSE);
  h.set('timing-allow-origin', '*');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-makaron-cache', status);
  return h;
}

function metaFromOrigin(headers) {
  return {
    etag: headers.get('etag') || '',
    contentType: headers.get('content-type') || '',
    contentDisposition: headers.get('content-disposition') || '',
    lastModified: headers.get('last-modified') || '',
    cacheControl: headers.get('cache-control') || '',
  };
}

function metaFromR2(object) {
  const c = object.customMetadata || {};
  return {
    etag: c.etag || '',
    contentType: object.httpMetadata?.contentType || '',
    contentDisposition: object.httpMetadata?.contentDisposition || '',
    lastModified: c.lastModified || '',
    cacheControl: c.cacheControl || '',
    checkedAt: Number(c.checkedAt) || 0,
    size: object.size,
  };
}

/**
 * A media content type, or application/octet-stream on a path with a media
 * extension. The client still receives the origin content-type unchanged.
 */
export function isMediaResponseType(contentType, pathname) {
  const type = contentType || '';
  if (MEDIA_TYPE.test(type)) return true;
  return BINARY_TYPE.test(type) && MEDIA_EXT.test(pathname || '');
}

/** Origin response is a complete, public, identity-encoded media object. */
export function fillableOrigin(response, maxBytes, pathname = '') {
  const h = response.headers;
  if (response.status !== 200) return false;
  if (!isMediaResponseType(h.get('content-type'), pathname)) return false;
  if (/(?:private|no-store)/i.test(h.get('cache-control') || '')) return false;
  const enc = h.get('content-encoding');
  if (enc && enc !== 'identity') return false;
  const etag = h.get('etag') || '';
  if (!etag || etag.startsWith('W/')) return false;
  const size = Number(h.get('content-length'));
  return Number.isSafeInteger(size) && size > 0 && size <= maxBytes;
}

// --- Image transformations (Supabase /render/image compatible) -------------
//
// `/storage/v1/render/image/public/<bucket>/<path>?width&height&quality&resize&format`
// is served by the Cloudflare Images binding from the R2 replica of the source,
// so Supabase no longer bills it as a transformed source image (2026-11-24).
// Output mirrors Supabase (probed 2026-11-24):
//   - never enlarges;
//   - resize=cover (default) with one dimension keeps the other dimension at
//     the source size and center-crops (width=200 on 736x1207 → 200x1207);
//   - resize=contain fits inside the box;
//   - WebP when Accept allows it, else the source format; format=origin keeps
//     the source format, format=webp forces WebP; `Vary: Accept` unless format=origin;
//   - etag and cache-control are the source object's.
//   - the source type comes from its bytes (a .png label on JPEG bytes renders
//     as JPEG); only JPEG and PNG sources are transformed here;
//   - a side implied from the source is capped at 8192.
// Anything else (other params, fill, gif/svg, WebP/AVIF/other sources, HEAD,
// >20 MB, binding errors) is forwarded to Supabase unchanged.
const RENDER_IMAGE = /^\/storage\/v1\/render\/image\/public\/([^/]+)\/(.+)$/;
// Bump when rendering output changes, so old edge renditions are not reused.
const RENDER_KEY_VERSION = 'r2';
const RENDER_MAX_SIDE = 8192;            // Supabase caps an implied side at 8192
const RENDER_PARAMS = new Set(['width', 'height', 'quality', 'resize', 'format']);
const RENDER_MAX_INPUT = 20 * 1024 ** 2; // Images binding input limit
const RENDER_DEFAULT_QUALITY = 80;       // Supabase default

const intParam = (v, min, max) => (/^\d{1,5}$/.test(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null);

/** Parse a render URL into {source, opts}, or null when it must pass through. */
export function renderTarget(url, method, headers = new Headers()) {
  // Ranged reads of a rendition (206 from Supabase) are left to Supabase.
  if (method !== 'GET' || headers.has('range')) return null;
  const match = RENDER_IMAGE.exec(url.pathname);
  if (!match) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some(k => !RENDER_PARAMS.has(k)) || new Set(keys).size !== keys.length) return null;
  const p = Object.fromEntries(url.searchParams);
  const opts = {
    width: p.width === undefined ? null : intParam(p.width, 1, 2500),
    height: p.height === undefined ? null : intParam(p.height, 1, 2500),
    quality: p.quality === undefined ? RENDER_DEFAULT_QUALITY : intParam(p.quality, 20, 100),
    resize: p.resize ?? 'cover',
    format: p.format ?? null,
  };
  if ((p.width !== undefined && !opts.width) || (p.height !== undefined && !opts.height)) return null;
  if (!opts.width && !opts.height) return null;
  if (opts.quality === null || !['cover', 'contain'].includes(opts.resize)) return null;
  if (opts.format !== null && !['origin', 'webp'].includes(opts.format)) return null;
  const sourceUrl = new URL(`https://${url.host}/storage/v1/object/public/${match[1]}/${match[2]}`);
  const source = cacheTarget(sourceUrl, 'GET');
  if (!source || /\.(?:gif|svg)$/i.test(source.path)) return null;
  return { source, sourceUrl, opts };
}

/**
 * Map Supabase render options to Images binding transform/output options.
 * Returns null when the source type is not transformable here.
 */
export function planRender(opts, src, accept) {
  if (src.type !== 'image/jpeg' && src.type !== 'image/png') return null;
  let transform, needsSize = false;
  if (opts.resize === 'contain') {
    transform = { fit: 'scale-down', ...(opts.width && { width: opts.width }), ...(opts.height && { height: opts.height }) };
  } else {
    // "crop" = cover without enlarging. A missing side is the source side,
    // capped at 8192 like Supabase (9000x9000, width=600 → 600x8192).
    needsSize = !(opts.width && opts.height);
    const cap = v => Math.min(v || 0, RENDER_MAX_SIDE);
    transform = { fit: 'crop', width: opts.width || cap(src.width), height: opts.height || cap(src.height) };
  }
  const webp = opts.format === 'webp' || (opts.format === null && /image\/webp/i.test(accept || ''));
  const format = webp ? 'image/webp' : src.type;
  const output = { format, ...(format !== 'image/png' && { quality: opts.quality }) };
  // Supabase sends `Vary: Accept` unless format=origin (even for format=webp).
  return { transform, output, vary: opts.format !== 'origin', needsSize };
}

/**
 * Drop PNG gAMA/cHRM chunks. Supabase ignores them (output pixels equal the
 * stored values); Cloudflare applies them, which shifted ffmpeg frames
 * (gAMA 0.51) by ~9/255. Chunks are self-delimited, so the rest is unchanged.
 */
export function stripPngGamma(buffer) {
  const b = new Uint8Array(buffer);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const keep = [b.subarray(0, 8)];
  let pos = 8, dropped = false;
  while (pos + 12 <= b.length) {
    const len = view.getUint32(pos);
    const end = pos + 12 + len;
    if (end > b.length) return buffer;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    if (type === 'gAMA' || type === 'cHRM') dropped = true;
    else keep.push(b.subarray(pos, end));
    pos = end;
    if (type === 'IEND') break;
  }
  if (!dropped) return buffer;
  const out = new Uint8Array(keep.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of keep) { out.set(c, o); o += c.length; }
  return out.buffer;
}

/** Real image type from magic bytes; Supabase decides by content, not label. */
export function sniffImageType(buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
}

function log(event, fields = {}) {
  // Never log object paths, query strings or request headers.
  console.log(JSON.stringify({ event, ...fields }));
}

export function createHandler(deps = {}) {
  const fetchOrigin = deps.fetchOrigin || ((req, init) => fetch(req, init));
  const edgeCache = deps.edgeCache || (() => caches.default);
  const now = deps.now || (() => Date.now());
  const inflight = new Map();

  function once(key, ctx, task) {
    if (inflight.has(key) || inflight.size > 500) return;
    const p = task().catch(e => log('bg_error', { op: key.split(':')[0], name: e?.name || 'Error' }))
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    ctx.waitUntil(p);
  }

  function originUrl(url, env) {
    const o = new URL(url);
    o.hostname = env.ORIGIN_HOST || DEFAULTS.ORIGIN_HOST;
    o.protocol = 'https:';
    o.port = '';
    return o;
  }

  // Supabase's own CDN keeps a separate copy per request variant (e.g. per
  // Accept-Encoding) and invalidates them lazily after an overwrite, so a
  // cache fill can read a stale version. Fill/revalidate reads go to Storage
  // with a unique query so they never hit Supabase's CDN.
  function freshOriginUrl(url, env) {
    const o = originUrl(url, env);
    o.searchParams.set('r2c', String(now()));
    return o;
  }

  // The pre-existing behavior: same method, headers and body, sent to the
  // Supabase project host (the same origin cdn.makaron.app resolves to).
  const passthrough = (request, env) =>
    fetchOrigin(new Request(originUrl(new URL(request.url), env), request));

  async function putEdge(target, meta, size, body, env) {
    if (size > num(env, 'MAX_EDGE_BYTES')) { await body?.cancel?.(); return; }
    const h = clientHeaders(meta, 'HIT-EDGE');
    h.set('content-length', String(size));
    h.set('cache-control', `public, max-age=${num(env, 'EDGE_TTL_SECONDS')}`);
    h.set('x-r2c-origin-cache-control', meta.cacheControl || 'no-cache');
    await edgeCache().put(new Request(target.edgeKey), new Response(body, { headers: h }));
  }

  async function acquireLock(bucket, key, env) {
    const lockKey = `locks/${key}`;
    const expires = now() + num(env, 'LOCK_SECONDS') * 1000;
    const body = JSON.stringify({ expires });
    if (await bucket.put(lockKey, body, { onlyIf: { etagDoesNotMatch: '*' } })) return true;
    const prev = await bucket.get(lockKey);
    if (!prev) return false;
    let prevExpires = 0;
    try { prevExpires = (await prev.json()).expires; } catch { /* corrupt lock */ }
    if (prevExpires > now()) return false;
    return Boolean(await bucket.put(lockKey, body, { onlyIf: { etagMatches: prev.etag } }));
  }

  // Background: copy the full origin object into R2 (and the local edge).
  // expectedEtag: the version the client was just served; a fill that reads a
  // different version is dropped rather than cached.
  async function fill(target, url, env, expectedEtag) {
    const bucket = env.MEDIA_R2;
    if (await bucket.head(target.r2Key)) return;
    if (!await acquireLock(bucket, target.r2Key, env)) return;
    const res = await fetchOrigin(freshOriginUrl(url, env), {
      headers: { 'accept-encoding': 'identity' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!fillableOrigin(res, num(env, 'MAX_FILL_BYTES'), url.pathname)) { await res.body?.cancel(); return; }
    if (expectedEtag && res.headers.get('etag') !== expectedEtag) {
      await res.body?.cancel();
      log('fill_version_mismatch', {});
      return;
    }
    const meta = metaFromOrigin(res.headers);
    const size = Number(res.headers.get('content-length'));
    const [toR2, toEdge] = res.body.tee();
    const edgeWrite = putEdge(target, meta, size, toEdge, env).catch(e => log('edge_put_error', { name: e?.name }));
    await bucket.put(target.r2Key, toR2, {
      httpMetadata: { contentType: meta.contentType, contentDisposition: meta.contentDisposition || undefined },
      customMetadata: {
        etag: meta.etag, lastModified: meta.lastModified, cacheControl: meta.cacheControl,
        checkedAt: String(now()), sourceSize: String(size),
      },
    });
    await edgeWrite;
    log('fill', { bytes: size });
  }

  // Background: make sure an R2 copy still matches the origin version.
  async function revalidate(target, url, meta, env) {
    const res = await fetchOrigin(freshOriginUrl(url, env), {
      headers: { range: 'bytes=0-0', 'accept-encoding': 'identity' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    await res.body?.cancel();
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1]);
    const same = res.status === 206 && res.headers.get('etag') === meta.etag && total === meta.size;
    if (same) {
      // Refresh checkedAt by copying metadata in place is not supported by R2;
      // store a tiny marker instead so we don't re-check on every hit.
      await env.MEDIA_R2.put(`checks/${target.r2Key}`, String(now()));
      return;
    }
    if (res.status === 206 || res.status === 404 || res.status === 400) {
      await purgeTarget(target, env);
      log('revalidate_purge', { status: res.status });
    }
  }

  async function lastChecked(target, meta, env) {
    const marker = await env.MEDIA_R2.get(`checks/${target.r2Key}`);
    const t = marker ? Number(await marker.text()) : 0;
    return Math.max(meta.checkedAt || 0, t || 0);
  }

  async function purgeTarget(target, env) {
    await env.MEDIA_R2.delete([target.r2Key, `checks/${target.r2Key}`]);
    await edgeCache().delete(new Request(target.edgeKey));
    await purgeZone([target.edgeKey], env);
  }

  async function purgeZone(urls, env) {
    if (!env.CF_PURGE_TOKEN || !env.CF_ZONE_ID || !urls.length) return;
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_PURGE_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: urls }),
    });
    if (!res.ok) log('zone_purge_error', { status: res.status });
  }

  // POST /__r2c/purge  {"paths": ["images/<path>.mp4", ...]}  (bucket/path)
  async function handlePurge(request, env, url) {
    if (!env.PURGE_SECRET || request.headers.get('authorization') !== `Bearer ${env.PURGE_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    let paths;
    try { paths = (await request.json()).paths; } catch { paths = null; }
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
      return new Response('Expected {"paths": [...]} (1-100)', { status: 400 });
    }
    const targets = [];
    for (const p of paths) {
      if (typeof p !== 'string' || !p.includes('/')) continue;
      const u = new URL(`https://${url.host}/storage/v1/object/public/${p.split('/').map(encodeURIComponent).join('/')}`);
      const base = cacheTarget(u, 'GET');
      if (!base) continue;
      targets.push(base);
      // Also drop any `?download=` variants stored in R2.
      const listed = await env.MEDIA_R2.list({ prefix: `${base.r2Key}?download=` });
      for (const o of listed.objects) {
        const variant = o.key.slice(base.r2Key.length);
        targets.push({ ...base, r2Key: o.key, edgeKey: base.edgeKey + variant, variant });
      }
    }
    const keys = targets.flatMap(t => [t.r2Key, `checks/${t.r2Key}`]);
    for (let i = 0; i < keys.length; i += 1000) await env.MEDIA_R2.delete(keys.slice(i, i + 1000));
    await Promise.all(targets.map(t => edgeCache().delete(new Request(t.edgeKey))));
    for (let i = 0; i < targets.length; i += 30) await purgeZone(targets.slice(i, i + 30).map(t => t.edgeKey), env);
    return Response.json({ purged: targets.length });
  }

  // R2 reports `range` on every object, including full reads and head(), so
  // 206 is only sent when the client asked for a range (GET with a valid
  // Range header). Full GETs and HEADs are 200 with the full content-length.
  function serveR2(request, object, target, status, ranged) {
    const meta = metaFromR2(object);
    if (etagMatches(request.headers.get('if-none-match'), meta.etag)) {
      object.body?.cancel?.();
      return new Response(null, { status: 304, headers: clientHeaders(meta, status) });
    }
    const h = clientHeaders(meta, status);
    if (ranged && object.range) {
      const { offset, length } = object.range;
      h.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      h.set('content-length', String(length));
      return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers: h });
    }
    h.set('content-length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers: h });
  }

  // Free Images plan returns error 9422 after 5,000 unique transformations a
  // month; stop trying for a while instead of failing every request first.
  let renderPausedUntil = 0;

  // Rendered copies live in the edge cache under a key without the source
  // etag; the entry records the etag and when it was confirmed. Within
  // EDGE_TTL_SECONDS it is served as is (same staleness bound as media);
  // after that one R2 head re-confirms the source version.
  const RENDER_META = 'x-r2c-meta';

  async function putRendered(edgeKey, body, contentType, meta, env) {
    const h = new Headers({ 'cache-control': `public, max-age=${num(env, 'RENDER_EDGE_TTL_SECONDS')}` });
    if (contentType) h.set('content-type', contentType);
    h.set(RENDER_META, JSON.stringify({ ...meta, confirmedAt: now(), pass: body === null }));
    await edgeCache().put(new Request(edgeKey), new Response(body ?? '', { headers: h }));
  }

  function checkSource(source, sourceUrl, meta, env, ctx) {
    once(`check:${source.r2Key}`, ctx, async () => {
      if (now() - await lastChecked(source, meta, env) > num(env, 'REVALIDATE_SECONDS') * 1000) {
        await revalidate(source, sourceUrl, meta, env);
      }
    });
  }

  async function handleRender(request, env, ctx, url, target) {
    const { source, sourceUrl, opts } = target;
    const bucket = env.MEDIA_R2;
    const accept = request.headers.get('accept');
    const variant = opts.format || (/image\/webp/i.test(accept || '') ? 'webp-ok' : 'plain');
    const vary = opts.format !== 'origin'; // Supabase: `Vary: Accept` unless format=origin
    const respond = (body, contentType, meta, status) => {
      const h = clientHeaders(meta, status);
      h.set('content-type', contentType);
      if (vary) h.set('vary', 'Accept');
      if (etagMatches(request.headers.get('if-none-match'), meta.etag)) {
        return new Response(null, { status: 304, headers: h });
      }
      h.set('content-length', String(body.byteLength));
      return new Response(body, { status: 200, headers: h });
    };
    // Output depends on (source bytes, params, whether WebP is acceptable).
    const q = new URLSearchParams({
      w: String(opts.width || ''), h: String(opts.height || ''), q: String(opts.quality), r: opts.resize, v: variant,
    });
    const edgeKey = `https://${url.host}/__r2c/img/${RENDER_KEY_VERSION}/${source.bucket}/${encodeURI(source.path)}?${q}`;

    let head;
    const edge = await edgeCache().match(new Request(edgeKey));
    if (edge) {
      let cached = null;
      try { cached = JSON.parse(edge.headers.get(RENDER_META) || 'null'); } catch { /* corrupt entry */ }
      let fresh = Boolean(cached) && now() - cached.confirmedAt < num(env, 'EDGE_TTL_SECONDS') * 1000;
      if (cached && !fresh) {
        head = await bucket.head(source.r2Key);
        fresh = Boolean(head) && metaFromR2(head).etag === cached.etag;
        if (fresh) checkSource(source, sourceUrl, metaFromR2(head), env, ctx);
      }
      if (fresh) {
        const body = await edge.arrayBuffer();
        if (cached.pass) return null;
        if (now() - cached.confirmedAt >= num(env, 'EDGE_TTL_SECONDS') * 1000) {
          ctx.waitUntil(putRendered(edgeKey, body, edge.headers.get('content-type'), cached, env).catch(() => {}));
        }
        return respond(body, edge.headers.get('content-type'), cached, 'HIT-IMAGE-EDGE');
      }
      await edge.body?.cancel?.();
    }

    if (head === undefined) head = await bucket.head(source.r2Key);
    let meta, input = null;
    if (head) {
      meta = metaFromR2(head);
      checkSource(source, sourceUrl, meta, env, ctx);
    } else {
      // Cold source: transform straight from origin bytes and copy them into
      // R2 in the background (no wait for the R2 write). The fill-lock holder
      // reads Storage directly (current version); others read once through
      // Supabase's CDN, so a burst of thumbnails is never billed by Supabase.
      const locked = await acquireLock(bucket, source.r2Key, env);
      const res = locked
        ? await fetchOrigin(freshOriginUrl(sourceUrl, env), { headers: { 'accept-encoding': 'identity' }, cf: { cacheTtl: 0, cacheEverything: false } })
        : await fetchOrigin(new Request(originUrl(sourceUrl, env)), { headers: { 'accept-encoding': 'identity' } });
      const size = Number(res.headers.get('content-length'));
      if (res.status !== 200 || !(size > 0 && size <= RENDER_MAX_INPUT)) { await res.body?.cancel(); return null; }
      const fillable = locked && fillableOrigin(res, num(env, 'MAX_FILL_BYTES'), sourceUrl.pathname);
      meta = { ...metaFromOrigin(res.headers), size };
      input = await res.arrayBuffer();
      if (fillable) {
        ctx.waitUntil(bucket.put(source.r2Key, input, {
          httpMetadata: { contentType: meta.contentType, contentDisposition: meta.contentDisposition || undefined },
          customMetadata: { etag: meta.etag, lastModified: meta.lastModified, cacheControl: meta.cacheControl, checkedAt: String(now()), sourceSize: String(size) },
        }).then(() => log('fill', { bytes: size, via: 'render' })).catch(e => log('bg_error', { op: 'render_fill', name: e?.name })));
      }
    }
    if (meta.size > RENDER_MAX_INPUT) return null;
    const stored = { etag: meta.etag, contentType: meta.contentType, contentDisposition: meta.contentDisposition,
      lastModified: meta.lastModified, cacheControl: meta.cacheControl };

    if (!input) {
      const object = await bucket.get(source.r2Key);
      if (!object) return null;
      input = await object.arrayBuffer();
    }
    const type = sniffImageType(input);
    if (type === 'image/png') input = stripPngGamma(input);
    let plan = planRender(opts, { type, width: 0, height: 0 }, accept);
    if (!plan) {
      // Not JPEG/PNG bytes (WebP, AVIF, animated, mislabelled...): Supabase
      // decides those. Remember it so later requests skip the R2 read.
      ctx.waitUntil(putRendered(edgeKey, null, '', stored, env).catch(() => {}));
      return null;
    }
    if (plan.needsSize) {
      const { width, height } = await env.IMAGES.info(new Blob([input]).stream());
      plan = planRender(opts, { type, width, height }, accept);
    }
    const result = await env.IMAGES.input(new Blob([input]).stream()).transform(plan.transform).output(plan.output);
    const out = await result.response().arrayBuffer();
    const contentType = result.contentType?.() || plan.output.format;
    ctx.waitUntil(putRendered(edgeKey, out, contentType, stored, env)
      .catch(e => log('render_edge_put_error', { name: e?.name })));
    log('render', { in: meta.size, out: out.byteLength });
    return respond(out, contentType, stored, 'IMAGE');
  }

  return async function handle(request, env, ctx) {
    env = { ...DEFAULTS, ...env };
    const url = new URL(request.url);

    if (url.pathname === '/__r2c/purge' && request.method === 'POST') {
      return handlePurge(request, env, url);
    }

    if (url.pathname.startsWith('/storage/v1/render/image/')) {
      const target = env.RENDER_DISABLED === '1' || env.R2C_DISABLED === '1' || !env.MEDIA_R2 || !env.IMAGES
        || now() < renderPausedUntil ? null : renderTarget(url, request.method, request.headers);
      if (target) {
        try {
          const res = await handleRender(request, env, ctx, url, target);
          if (res) return res;
        } catch (error) {
          const msg = String(error?.message || '');
          if (msg.includes('9422')) renderPausedUntil = now() + num(env, 'RENDER_PAUSE_SECONDS') * 1000;
          log('render_fallback', { name: error?.name || 'Error', code: /\b(9\d{3})\b/.exec(msg)?.[1] });
        }
      }
      const res = await passthrough(request, env);
      const h = new Headers(res.headers);
      h.set('x-makaron-cache', 'MISS');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }

    const bypass = String(env.BYPASS_CONTINENTS || '').split(',').map(c => c.trim()).filter(Boolean);
    const continent = request.cf?.continent;
    const regionBypass = Boolean(continent && bypass.includes(continent));
    const target = env.R2C_DISABLED === '1' || !env.MEDIA_R2 || regionBypass ? null : cacheTarget(url, request.method);
    if (!target) return passthrough(request, env);

    try {
      // Tier 1: edge cache. Cache API handles Range / If-None-Match itself.
      const edgeReq = new Request(target.edgeKey, { headers: request.headers, method: 'GET' });
      const edge = await edgeCache().match(edgeReq);
      if (edge) {
        const h = new Headers(edge.headers);
        h.set('cache-control', h.get('x-r2c-origin-cache-control') || 'no-cache');
        h.delete('x-r2c-origin-cache-control');
        h.set('x-makaron-cache', 'HIT-EDGE');
        return new Response(request.method === 'HEAD' ? null : edge.body, { status: edge.status, headers: h });
      }

      // Tier 2: R2 replica.
      const rangeHeader = request.headers.get('range');
      let object;
      if (request.method === 'HEAD') {
        object = await env.MEDIA_R2.head(target.r2Key);
      } else if (rangeHeader) {
        // Multi-range or malformed ranges keep the origin behavior.
        if (!/^bytes=(\d+-\d*|-\d+)$/.test(rangeHeader.trim())) return passthrough(request, env);
        object = await env.MEDIA_R2.get(target.r2Key, { range: request.headers });
      } else {
        object = await env.MEDIA_R2.get(target.r2Key);
      }
      if (object) {
        const meta = metaFromR2(object);
        const ifRange = request.headers.get('if-range');
        if (ifRange && rangeHeader && ifRange !== meta.etag && !Date.parse(ifRange)) {
          // If-Range mismatch means "send the whole thing": let origin decide.
          object.body?.cancel?.();
          return passthrough(request, env);
        }
        once(`edge:${target.r2Key}`, ctx, async () => {
          const full = await env.MEDIA_R2.get(target.r2Key);
          if (full) await putEdge(target, metaFromR2(full), full.size, full.body, env);
        });
        once(`check:${target.r2Key}`, ctx, async () => {
          if (now() - await lastChecked(target, meta, env) > num(env, 'REVALIDATE_SECONDS') * 1000) {
            await revalidate(target, url, meta, env);
          }
        });
        return serveR2(request, object, target, 'HIT-R2', request.method !== 'HEAD' && Boolean(rangeHeader));
      }

      // Tier 3: origin, request forwarded unchanged. Fill R2 in the background.
      // HEAD never fills: a HEAD sweep over cold objects would otherwise pull
      // every whole file from origin (2026-11-06: 759 HEADs → 22.8 GB uncached).
      const response = await passthrough(request, env);
      const total = response.status === 206
        ? Number(/\/(\d+)$/.exec(response.headers.get('content-range') || '')?.[1])
        : Number(response.headers.get('content-length'));
      if (request.method !== 'HEAD'
        && (response.status === 200 || response.status === 206 || response.status === 304)
        && (response.status === 304 || isMediaResponseType(response.headers.get('content-type'), url.pathname))
        && (response.status === 304 || (Number.isSafeInteger(total) && total <= num(env, 'MAX_FILL_BYTES')))) {
        const etag = response.headers.get('etag');
        const expected = response.status !== 304 && etag && !etag.startsWith('W/') ? etag : null;
        once(`fill:${target.r2Key}`, ctx, () => fill(target, url, env, expected));
      }
      const h = new Headers(response.headers);
      h.set('x-makaron-cache', 'MISS');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
    } catch (error) {
      log('fallback', { name: error?.name || 'Error' });
      return passthrough(request, env);
    }
  };
}

export default { fetch: createHandler() };
