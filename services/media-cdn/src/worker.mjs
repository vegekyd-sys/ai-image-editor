// Supabase remains authoritative. R2 holds versioned, disposable public-media
// replicas; the edge holds short-lived responses. No Supabase credential is used.
const VERSION = 'v1';
const MAX_R2_PUT = 5 * 1024 ** 3;
const MAX_EDGE_OBJECT = 500 * 1024 ** 2;
const EXPOSE = 'Content-Range, ETag, Accept-Ranges, X-Makaron-Cache';
const COPY_HEADERS = [
  'content-type', 'content-language', 'content-disposition', 'last-modified',
  'etag', 'content-length', 'accept-ranges', 'vary',
];
const pendingFills = new Map();

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
  return headers;
}

function withStatus(response, status, freshness) {
  const headers = new Headers(response.headers);
  headers.set('x-makaron-cache', status);
  if (freshness !== undefined) headers.set('cache-control', `public, max-age=${freshness}, must-revalidate`);
  headers.set('access-control-expose-headers', EXPOSE);
  return new Response(response.body, { status: response.status, headers });
}

// Response.clone()/ReadableStream.tee() can buffer an entire movie when one
// consumer is slower. Pump to both writers with backpressure instead. A failed
// replica never breaks the user's download; a cancelled download can finish its
// replica within waitUntil's remaining lifetime.
export function boundedCopy(source, streams) {
  const reader = source.getReader();
  let writers = streams.map(stream => stream.writable.getWriter());
  const done = (async () => {
    try {
      while (writers.length) {
        const { value, done } = await reader.read();
        if (done) break;
        const results = await Promise.allSettled(writers.map(writer => writer.write(value)));
        writers = writers.filter((writer, index) => {
          if (results[index].status === 'fulfilled') return true;
          writer.releaseLock();
          return false;
        });
      }
      if (!writers.length) await reader.cancel();
      await Promise.allSettled(writers.map(writer => writer.close()));
    } catch (error) {
      await Promise.allSettled(writers.map(writer => writer.abort(error)));
      throw error;
    } finally {
      reader.releaseLock();
      for (const writer of writers) writer.releaseLock();
    }
  })();
  return { readable: streams[0].readable, done };
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

async function releaseUnread(promise, readable) {
  try { return await promise; }
  finally { await readable.cancel().catch(() => {}); }
}

function logFailure(operation, error) {
  // Do not log media URLs, query strings, or request headers.
  console.warn(`media-cdn ${operation}: ${error?.name || 'Error'}`);
}

export function createHandler({
  fetchOrigin = fetch,
  edgeCache = () => caches.default,
  fixedStream = size => new FixedLengthStream(size),
} = {}) {
  return async function handle(request, env, ctx) {
    env = { ORIGIN_HOST: 'sdyrtztrjgmmpnirswxt.supabase.co', CDN_HOST: 'cdn.makaron.app', FRESHNESS_SECONDS: '60', MEASURE_ORIGIN: '1', ...env };
    const url = new URL(request.url);
    const origin = new URL(url);
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
    const ttl = Math.min(300, Math.max(1, Number(env.FRESHNESS_SECONDS) || 60));
    const accept = request.headers.get('accept') || '*/*';
    const canonical = `${origin.href}\n${accept}`;
    const id = await digest(canonical);
    const cache = edgeCache();
    const cacheBase = `https://${env.CDN_HOST}/storage/v1/object/public/__makaron_cache/${VERSION}/${id}`;
    const metadataKey = new Request(`${cacheBase}/metadata`);
    const anonymousHeaders = { accept, 'accept-encoding': 'identity' };
    const fetchAnonymous = async (method, headers = {}) => {
      const response = await fetchOrigin(origin, {
        method, headers: { ...anonymousHeaders, ...headers },
        redirect: 'manual', cf: { cacheTtl: 0, cacheEverything: false },
      });
      if (env.MEASURE_ORIGIN === '1') console.log(JSON.stringify({
        event: 'media-origin', key: id.slice(0, 16), method, status: response.status,
        responseBytes: method === 'HEAD' ? 0 : Number(response.headers.get('content-length')) || 0,
        range: Boolean(headers.range),
      }));
      return response;
    };
    let metadata;
    try {
      const saved = await cache.match(metadataKey);
      metadata = saved ? await saved.json() : null;
      if (!metadata) {
        const head = await fetchAnonymous('HEAD');
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
        metadata = { size, etag, freshness: /(?:no-cache|max-age=0)/i.test(head.headers.get('cache-control') || '') ? 0 : ttl, headers: Object.fromEntries(publicHeaders(head.headers, '', ttl)) };
        if (metadata.freshness > 0) ctx.waitUntil(cache.put(metadataKey, new Response(JSON.stringify(metadata), {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` },
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
      if (cached) return withStatus(cached, 'HIT', metadata.freshness);
      const object = await env.MEDIA_CACHE.get(r2Key, range ? { range } : undefined);
      if (range) {
        headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
        headers.set('content-length', String(range.length));
      }
      if (object) {
        headers.set('x-makaron-cache', 'R2');
        if (range) {
          warmEdge(env.MEDIA_CACHE, r2Key, bodyKey, metadata, cache, ctx, ttl);
          return new Response(object.body, { status: 206, headers });
        }
        return copyToEdge(object.body, bodyKey, metadata, headers, cache, ctx, ttl);
      }

      const response = await fetchAnonymous('GET', range ? {
        range: `bytes=${range.offset}-${range.offset + range.length - 1}`,
        'if-range': metadata.etag,
      } : {});
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
      if (range) {
        fillFromOrigin(fetchAnonymous, env.MEDIA_CACHE, r2Key, metadata, bodyKey, cache, ctx, ttl);
        return new Response(response.body, { status: 206, headers });
      }
      const download = new TransformStream();
      const replica = fixedStream(metadata.size);
      const upload = env.MEDIA_CACHE.put(r2Key, replica.readable, {
        httpMetadata: new Headers(metadata.headers),
      });
      const copied = boundedCopy(response.body, [download, replica]);
      ctx.waitUntil(Promise.all([copied.done, releaseUnread(upload, replica.readable)])
        .then(() => warmEdge(env.MEDIA_CACHE, r2Key, bodyKey, metadata, cache, ctx, ttl))
        .catch(error => logFailure('replica write', error)));
      return new Response(copied.readable, { headers });
    } catch (error) {
      logFailure('cache fallback', error);
      return withStatus(await passThrough(), 'BYPASS');
    }
  };
}

function copyToEdge(body, key, metadata, headers, cache, ctx, ttl) {
  if (metadata.size > MAX_EDGE_OBJECT) return new Response(body, { headers });
  const download = new TransformStream();
  const replica = new TransformStream();
  const copy = boundedCopy(body, [download, replica]);
  const put = cache.put(key, new Response(replica.readable, {
    headers: publicHeaders(new Headers(metadata.headers), 'HIT', ttl),
  }));
  ctx.waitUntil(Promise.all([copy.done, releaseUnread(put, replica.readable)]).catch(error => logFailure('edge write', error)));
  return new Response(copy.readable, { headers });
}

function warmEdge(bucket, key, bodyKey, metadata, cache, ctx, ttl) {
  if (metadata.size > MAX_EDGE_OBJECT) return Promise.resolve();
  const pendingKey = `edge:${key}`;
  if (pendingFills.has(pendingKey)) return pendingFills.get(pendingKey);
  const promise = (async () => {
    if (await cache.match(bodyKey)) return;
    const object = await bucket.get(key);
    if (object) await cache.put(bodyKey, new Response(object.body, {
      headers: publicHeaders(new Headers(metadata.headers), 'HIT', ttl),
    }));
  })().catch(error => logFailure('edge warm', error)).finally(() => pendingFills.delete(pendingKey));
  pendingFills.set(pendingKey, promise);
  ctx.waitUntil(promise);
  return promise;
}

function fillFromOrigin(fetchAnonymous, bucket, key, metadata, bodyKey, cache, ctx, ttl) {
  if (pendingFills.has(key)) return;
  const promise = (async () => {
    const full = await fetchAnonymous('GET', { 'if-match': metadata.etag });
    if (full.status !== 200 || full.headers.get('etag') !== metadata.etag
      || Number(full.headers.get('content-length')) !== metadata.size || !cacheableResponse(full.headers)) {
      await full.body?.cancel();
      return;
    }
    await bucket.put(key, full.body, {
      httpMetadata: new Headers(metadata.headers),
    });
    await warmEdge(bucket, key, bodyKey, metadata, cache, ctx, ttl);
  })().catch(error => logFailure('range warm', error)).finally(() => pendingFills.delete(key));
  pendingFills.set(key, promise);
  ctx.waitUntil(promise);
}

export default { fetch: createHandler() };
