// Supabase remains authoritative. R2 holds versioned, disposable public-media
// replicas; the edge holds short-lived responses. No Supabase credential is used.
const VERSION = 'v1';
const MAX_R2_PUT = 5 * 1024 ** 3;
const MAX_EDGE_OBJECT = 500 * 1024 ** 2;
const VERSIONED_BODY_TTL = 24 * 3600;
const EXPOSE = 'Content-Range, ETag, Accept-Ranges, X-Makaron-Cache';
const SECURITY_HEADERS = ['content-security-policy', 'content-security-policy-report-only', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cross-origin-resource-policy'];
const COPY_HEADERS = [
  'content-type', 'content-language', 'content-disposition', 'last-modified',
  'etag', 'content-length', 'accept-ranges', 'vary',
  ...SECURITY_HEADERS,
];
const pendingFills = new Map();
const RENDER_TOKEN = '__mk_render';
let signingSecret, signingKey;

export async function verifyRenderToken(token, origin, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || token.length > 1800) return null;
  const [payload, signature, extra] = token.split('.');
  if (extra || !/^[A-Za-z0-9_-]+$/.test(payload || '') || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) return null;
  try {
    const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    if (signingSecret !== secret) {
      signingSecret = secret;
      signingKey = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
    }
    const canonical = new URL(origin); canonical.hash = ''; canonical.search = canonical.searchParams.toString();
    if (!await crypto.subtle.verify('HMAC', await signingKey, decode(signature), new TextEncoder().encode(canonical.href + '\n' + payload))) return null;
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (value.v !== 1 || !Number.isSafeInteger(value.expires) || value.expires <= now || value.expires > now + 6 * 3600_000 + 60_000) return null;
    if (value.bypass === true && !value.metadata) return value;
    const m = value.metadata;
    if (value.bypass || !m || !/^"[^"\r\n]{1,128}"$/.test(m.etag || '')
      || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > MAX_EDGE_OBJECT
      || typeof m.type !== 'string' || !/^(audio|video)\//i.test(m.type) || m.type.length > 128 || /[\r\n]/.test(m.type)
      || (m.modified && (typeof m.modified !== 'string' || m.modified.length > 128 || !Number.isFinite(Date.parse(m.modified))))) return null;
    return value;
  } catch {return null;}
}

export function isPublicMediaPath(path) {
  return /^\/storage\/v1\/(?:object\/public|render\/image\/public)\/[^/]+\/.+/.test(path);
}

export function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return 'unsupported';
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'unsupported';
    if (start > end || start >= size) return 'unsatisfiable';
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

export async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function publicHeaders(source, cacheStatus, ttl) {
  const headers = new Headers();
  for (const name of COPY_HEADERS) {
    if (source.has(name)) headers.set(name, source.get(name));
  }
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', EXPOSE);
  headers.set('cache-control', `public, max-age=${ttl}, must-revalidate`);
  headers.set('x-makaron-cache', cacheStatus);
  headers.set('x-content-type-options', 'nosniff');
  return headers;
}

function withStatus(response, status, freshness, currentHeaders) {
  const headers = new Headers(response.headers);
  headers.set('x-makaron-cache', status);
  if (freshness !== undefined) headers.set('cache-control', `public, max-age=${freshness}, must-revalidate`);
  headers.set('access-control-expose-headers', EXPOSE);
  if (currentHeaders) for (const name of SECURITY_HEADERS) {
    if (currentHeaders.has(name)) headers.set(name, currentHeaders.get(name));
    else headers.delete(name);
  }
  return new Response(response.body, { status: response.status, headers });
}

function hasUserCookies(headers) {
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/);
  // Supabase's public CDN attaches Cloudflare bot-management cookies even to
  // anonymous media. Drop those infrastructure cookies; reject all others.
  return cookies.flatMap(cookie => cookie.split(/,(?=\s*[^;,=\s]+=)/)).some(cookie => cookie.trim() && !/^\s*(?:__cf_bm|_cfuvid)=/.test(cookie));
}

function cacheableResponse(headers) {
  return /^(image|video|audio)\//i.test(headers.get('content-type') || '')
    && !/(?:private|no-store)/i.test(headers.get('cache-control') || '')
    && !hasUserCookies(headers)
    && (!headers.get('content-encoding') || headers.get('content-encoding') === 'identity');
}

function logFailure(operation, error) {
  // Do not log media URLs, query strings, or request headers.
  console.warn(`media-cdn ${operation}: ${error?.name || 'Error'}`);
}

export function createHandler({
  fetchOrigin = fetch,
  edgeCache = () => caches.default,
} = {}) {
  return async function handle(request, env, ctx) {
    const requestStart = Date.now();
    env = { ORIGIN_HOST: 'sdyrtztrjgmmpnirswxt.supabase.co', CDN_HOST: 'cdn.makaron.app', FRESHNESS_SECONDS: '60', MEASURE_ORIGIN: '1', ...env };
    const url = new URL(request.url);
    const origin = new URL(url);
    const renderToken = origin.searchParams.get(RENDER_TOKEN);
    origin.searchParams.delete(RENDER_TOKEN);
    origin.hostname = env.ORIGIN_HOST;
    origin.protocol = 'https:';
    origin.port = '';
    const passThrough = () => fetchOrigin(new Request(origin, request), {
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!['GET', 'HEAD'].includes(request.method) || !isPublicMediaPath(url.pathname)) {
      return passThrough();
    }
    // Public cache requests are anonymous. Never forward cookies or bearer
    // tokens into a shared cache, even on an accidentally misconfigured path.
    if (request.headers.has('authorization') || request.headers.has('cookie')
      || url.searchParams.has('token')) return passThrough();
    const pinned = renderToken ? await verifyRenderToken(renderToken, origin, env.RENDER_SIGNING_SECRET) : null;
    if (renderToken && !pinned) return new Response('Invalid render capability', {status: 403, headers: {'cache-control': 'no-store'}});
    if (pinned?.bypass) return withStatus(await passThrough(), 'ORIGIN');
    const ttl = Math.min(300, Math.max(1, Number(env.FRESHNESS_SECONDS) || 60));
    const accept = /\/object\/public\/.*\.(?:wav|mp3|m4a|aac|ogg|mp4|mov|webm|m4v)$/i.test(origin.pathname)
      ? '*/*' : request.headers.get('accept') || '*/*';
    const canonical = `${origin.href}\n${accept}`;
    const id = await digest(canonical);
    const cache = edgeCache();
    const cacheBase = `https://${env.CDN_HOST}/storage/v1/object/public/__makaron_cache/${VERSION}/${id}`;
    const metadataKey = new Request(`${cacheBase}/metadata`);
    const anonymousHeaders = { accept, 'accept-encoding': 'identity' };
    const fetchAnonymous = async (method, headers = {}) => {
      const originStart = Date.now();
      const response = await fetchOrigin(origin, {
        method, headers: { ...anonymousHeaders, ...headers },
        redirect: 'manual', cf: { cacheTtl: 0, cacheEverything: false },
      });
      if (env.MEASURE_ORIGIN === '1') console.log(JSON.stringify({
        event: 'media-origin', key: id.slice(0, 16), method, status: response.status,
        responseBytes: method === 'HEAD' ? 0 : Number(response.headers.get('content-length')) || 0,
        range: Boolean(headers.range),
        elapsedMs: Date.now() - originStart,
      }));
      return response;
    };
    let metadata;
    try {
      if (pinned?.metadata) {
        const m = pinned.metadata;
        const freshness = Math.min(3600, Math.floor((pinned.expires - Date.now()) / 1000));
        metadata = {size: m.size, etag: m.etag, freshness, headers: {
          'content-length': String(m.size), 'content-type': m.type, etag: m.etag, 'accept-ranges': 'bytes',
          ...(m.modified ? {'last-modified': m.modified} : {}),
        }};
      } else {
        const saved = await cache.match(metadataKey);
        metadata = saved ? await saved.json() : null;
      }
      if (!metadata) {
        const rangeFirst = /\/object\/public\/.*\.(?:wav|mp3|m4a|aac|ogg|mp4|mov|webm|m4v)$/i.test(origin.pathname);
        let head = rangeFirst ? null : await fetchAnonymous('HEAD');
        // Hosted Storage marks HEAD private even for anonymously cacheable GET.
        // Validate the actual public GET policy using one byte, never infer it
        // from the path or erase a private GET policy. An ignored Range bypasses.
        if (rangeFirst || (head.status === 200 && /(?:private|no-store)/i.test(head.headers.get('cache-control') || ''))) {
          const probe = await fetchAnonymous('GET', { range: 'bytes=0-0' });
          const contentRange = /^bytes 0-0\/(\d+)$/.exec(probe.headers.get('content-range') || '');
          const eligible = probe.status === 206 && contentRange && cacheableResponse(probe.headers);
          await probe.body?.cancel();
          if (!eligible) return withStatus(await passThrough(), 'BYPASS');
          const headers = new Headers(probe.headers);
          headers.delete('content-range');
          headers.set('content-length', contentRange[1]);
          head = new Response(null, {headers});
        }
        const type = head.headers.get('content-type') || '';
        const size = Number(head.headers.get('content-length'));
        const etag = head.headers.get('etag');
        const encoding = head.headers.get('content-encoding');
        if (head.status !== 200 || !/^(image|video|audio)\//i.test(type)
          || !Number.isSafeInteger(size) || size <= 0 || size > MAX_R2_PUT
          || !etag || etag.startsWith('W/') || (encoding && encoding !== 'identity')
          || hasUserCookies(head.headers)
          || /(?:private|no-store)/i.test(head.headers.get('cache-control') || '')) {
          return withStatus(await passThrough(), 'BYPASS');
        }
        const policy = head.headers.get('cache-control') || '';
        const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(policy);
        // Match origin browser reuse instead of reducing a one-hour source to
        // one minute. Internal metadata still revalidates at least every minute.
        const freshness = /(?:^|,)\s*no-cache\b/i.test(policy) ? 0
          : Math.min(3600, maxAge ? Number(maxAge[1]) : ttl);
        metadata = { size, etag, freshness, headers: Object.fromEntries(publicHeaders(head.headers, '', freshness)) };
        if (metadata.freshness > 0) ctx.waitUntil(cache.put(metadataKey, new Response(JSON.stringify(metadata), {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.min(ttl, freshness)}` },
        })).catch(error => logFailure('metadata cache', error)));
      }
      const headers = publicHeaders(new Headers(metadata.headers), 'METADATA', metadata.freshness);
      const ifMatch = request.headers.get('if-match');
      const unmodified = request.headers.get('if-unmodified-since');
      if ((ifMatch && !ifMatch.split(',').some(value => value.trim() === '*' || value.trim() === metadata.etag))
        || (!ifMatch && unmodified && Date.parse(headers.get('last-modified')) > Date.parse(unmodified))) {
        headers.delete('content-length');
        return new Response(null, { status: 412, headers });
      }
      const ifNoneMatch = request.headers.get('if-none-match');
      if (ifNoneMatch && ifNoneMatch.split(',').some(value =>
        value.trim() === '*' || value.trim().replace(/^W\//, '') === metadata.etag)) {
        headers.delete('content-length');
        return new Response(null, { status: 304, headers });
      }
      if (!ifNoneMatch && request.headers.has('if-modified-since')
        && Date.parse(headers.get('last-modified')) <= Date.parse(request.headers.get('if-modified-since'))) {
        headers.delete('content-length');
        return new Response(null, { status: 304, headers });
      }
      if (request.method === 'HEAD') return new Response(null, { headers });
      let range = parseRange(request.headers.get('range'), metadata.size);
      const ifRange = request.headers.get('if-range');
      if (ifRange && ifRange !== metadata.etag
        && !(Date.parse(ifRange) >= Date.parse(headers.get('last-modified')))) range = null;
      if (range === 'unsupported') return withStatus(await passThrough(), 'BYPASS');
      if (range === 'unsatisfiable') {
        headers.set('content-range', `bytes */${metadata.size}`);
        headers.set('content-length', '0');
        return new Response(null, { status: 416, headers });
      }
      const version = await digest(`${metadata.etag}\n${metadata.size}`);
      const r2Key = `${VERSION}/${id}/${version}`;
      const bodyKey = new Request(`${cacheBase}/body/${version}`);
      const rangedKey = new Request(bodyKey, {
        headers: range ? { range: `bytes=${range.offset}-${range.offset + range.length - 1}` } : {},
      });
      const cached = await cache.match(rangedKey);
      if (cached) {
        if (env.MEASURE_ORIGIN === '1') console.log(JSON.stringify({event: 'media-edge', key: id.slice(0, 16), cache: 'HIT', elapsedMs: Date.now() - requestStart, range: request.headers.get('range')}));
        return withStatus(cached, 'HIT', metadata.freshness, headers);
      }
      if (range) {
        headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
        headers.set('content-length', String(range.length));
      }
      const bodyHeaders = range ? {
        range: `bytes=${range.offset}-${range.offset + range.length - 1}`,
        [pinned ? 'if-match' : 'if-range']: metadata.etag,
      } : pinned ? {'if-match': metadata.etag} : {};
      let response = await fetchAnonymous('GET', bodyHeaders);
      // A transient upstream gateway failure must not immediately abort a whole
      // multi-worker export. Retry once, before exposing any body, retaining the
      // exact range and version condition. Successful reads have no extra work.
      if ([502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        response = await fetchAnonymous('GET', bodyHeaders);
      }
      const expectedStatus = range ? 206 : 200;
      const expectedLength = range?.length ?? metadata.size;
      // A file can be overwritten between HEAD and GET. Deliver the actual
      // origin response, but never associate the new bytes with the old key.
      if (response.status !== expectedStatus || response.headers.get('etag') !== metadata.etag
        || Number(response.headers.get('content-length')) !== expectedLength
        || !cacheableResponse(response.headers)
        || hasUserCookies(response.headers)
        || (range && response.headers.get('content-range') !== headers.get('content-range'))) {
        ctx.waitUntil(cache.delete(metadataKey).catch(() => {}));
        return withStatus(response, 'BYPASS');
      }
      headers.set('x-makaron-cache', 'MISS');
      // A cold edge keeps the existing origin path. R2 lookup and transfer are
      // background-only: their regional latency cannot block a render/download.
      if (metadata.size <= MAX_EDGE_OBJECT) warmReplica(fetchAnonymous, env.MEDIA_CACHE, r2Key, metadata, bodyKey, cache, ctx, ttl, env.MEASURE_ORIGIN === '1');
      if (range) {
        return new Response(response.body, { status: 206, headers });
      }
      // Native streaming preserves Content-Length and avoids JavaScript work per
      // chunk. A separate, globally locked fill keeps a cache failure or CPU/time
      // limit from truncating the user's response. Cold full GET costs up to 2x
      // origin bytes; measure this explicitly before enabling production traffic.
      return new Response(response.body, { headers });
    } catch (error) {
      logFailure('cache fallback', error);
      return withStatus(await passThrough(), 'BYPASS');
    }
  };
}

function warmReplica(fetchAnonymous, bucket, key, metadata, bodyKey, cache, ctx, ttl, measure) {
  const pendingKey = `replica:${key}`;
  if (pendingFills.has(pendingKey) || pendingFills.size >= 1000) return;
  const promise = (async () => {
    if (await bucket.head(key)) await warmEdge(bucket, key, bodyKey, metadata, cache, ctx, ttl);
    else fillFromOrigin(fetchAnonymous, bucket, key, metadata, bodyKey, cache, ctx, ttl, measure);
  })().catch(error => logFailure('replica warm', error)).finally(() => pendingFills.delete(pendingKey));
  pendingFills.set(pendingKey, promise);
  ctx.waitUntil(promise);
}

function warmEdge(bucket, key, bodyKey, metadata, cache, ctx, ttl) {
  if (metadata.size > MAX_EDGE_OBJECT) return Promise.resolve();
  const pendingKey = `edge:${key}`;
  if (pendingFills.has(pendingKey)) return pendingFills.get(pendingKey);
  const promise = (async () => {
    if (await cache.match(bodyKey)) return;
    const object = await bucket.get(key);
    if (object) await cache.put(bodyKey, new Response(object.body, {
      // Body keys contain the verified version. A longer internal TTL avoids
      // re-reading R2 every minute; metadata still controls invalidation and
      // the browser-facing response keeps its original short freshness.
      headers: publicHeaders(new Headers(metadata.headers), 'HIT', Math.max(ttl, VERSIONED_BODY_TTL)),
    }));
  })().catch(error => logFailure('edge warm', error)).finally(() => pendingFills.delete(pendingKey));
  pendingFills.set(pendingKey, promise);
  ctx.waitUntil(promise);
  return promise;
}

export async function acquireFillLock(bucket, key) {
  const lockKey = `v1/locks/${key}`;
  const now = Date.now();
  const lock = JSON.stringify({ expires: now + 90_000 });
  let acquired = await bucket.put(lockKey, lock, { onlyIf: { etagDoesNotMatch: '*' } });
  if (!acquired) {
    const previous = await bucket.get(lockKey);
    if (!previous) return null;
    let expires;
    try { expires = (await previous.json()).expires; } catch { return null; }
    if (!Number.isFinite(expires) || expires > now) return null;
    acquired = await bucket.put(lockKey, lock, { onlyIf: { etagMatches: previous.etag } });
  }
  return acquired ? lockKey : null;
}

function fillFromOrigin(fetchAnonymous, bucket, key, metadata, bodyKey, cache, ctx, ttl, measure = false) {
  if (pendingFills.has(key)) return;
  const promise = (async () => {
    const lockKey = await acquireFillLock(bucket, key);
    if (!lockKey) return;
    {
      // Another request may have completed between our initial miss and lock.
      if (await bucket.head(key)) return;
      const full = await fetchAnonymous('GET', { 'if-match': metadata.etag });
      if (full.status !== 200 || full.headers.get('etag') !== metadata.etag
        || Number(full.headers.get('content-length')) !== metadata.size || !cacheableResponse(full.headers)) {
        await full.body?.cancel();
        return;
      }
      await bucket.put(key, full.body, { httpMetadata: new Headers(metadata.headers) });
      if (measure) console.log(JSON.stringify({ event: 'media-replica', key: key.split('/')[1].slice(0, 16), completedBytes: metadata.size }));
      // Narration fills are small enough to prime the edge in the same bounded
      // background operation. Large files warm on a subsequent request.
      if (metadata.size <= 16 * 1024 ** 2) await warmEdge(bucket, key, bodyKey, metadata, cache, ctx, ttl);
      // Keep the fill within the background lifetime. A subsequent R2 hit can
      // populate the edge independently; chaining both here can exceed 30s.
    }
    // Keep the lease until it expires. Deleting it could remove a new owner's
    // lease if this fill outlived its 90-second term. Bucket lifecycle clears it.
  })().catch(error => logFailure('range warm', error)).finally(() => pendingFills.delete(key));
  pendingFills.set(key, promise);
  ctx.waitUntil(promise);
}

export default { fetch: createHandler() };
