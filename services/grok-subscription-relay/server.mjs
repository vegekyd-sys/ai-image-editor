import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { getValidXaiOAuthCredential } from './xai-oauth.mjs';

const XAI_BASE_URL = process.env.XAI_API_BASE?.trim() || 'https://api.x.ai';
const GROK_CLI_PROXY_BASE_URL = process.env.GROK_CLI_PROXY_BASE_URL?.trim()
  || 'https://cli-chat-proxy.grok.com';
const GROK_BUILD_CLIENT_VERSION = process.env.GROK_BUILD_CLIENT_VERSION?.trim() || '1.0.12';
const PORT = Number.parseInt(process.env.PORT || '25985', 10);
const HOST = process.env.HOST?.trim() || '127.0.0.1';
const RELAY_SECRET = process.env.GROK_SUBSCRIPTION_RELAY_SECRET?.trim();
const OWNER_USER_ID = process.env.GROK_SUBSCRIPTION_OWNER_USER_ID?.trim();
const SIGNATURE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const allowedUserIds = new Set(
  (process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);
if (OWNER_USER_ID) allowedUserIds.add(OWNER_USER_ID);

const HEADER = {
  timestamp: 'x-makaron-relay-timestamp',
  requestId: 'x-makaron-relay-request-id',
  userId: 'x-makaron-relay-user-id',
  signature: 'x-makaron-relay-signature',
};

const replayCache = new Map();

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:xai-|Bearer\s+)[A-Za-z0-9._-]{20,}/gi, '[redacted]')
    .slice(0, 500);
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createRelaySignature(input) {
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  const canonical = [
    input.method.toUpperCase(),
    input.pathname,
    input.timestamp,
    input.requestId,
    input.userId,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', input.secret).update(canonical).digest('hex');
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyRelayRequest({ method, pathname, headers, body, now = Date.now() }) {
  if (!RELAY_SECRET || !OWNER_USER_ID) return { ok: false, status: 503, error: 'relay_not_configured' };
  const timestamp = headers[HEADER.timestamp];
  const requestId = headers[HEADER.requestId];
  const userId = headers[HEADER.userId];
  const signature = headers[HEADER.signature];
  if (![timestamp, requestId, userId, signature].every(value => typeof value === 'string' && value)) {
    return { ok: false, status: 401, error: 'missing_signature' };
  }
  if (!allowedUserIds.has(userId)) return { ok: false, status: 403, error: 'not_allowlisted' };
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > SIGNATURE_WINDOW_MS) {
    return { ok: false, status: 401, error: 'stale_signature' };
  }
  for (const [seenId, expiresAt] of replayCache) {
    if (expiresAt <= now) replayCache.delete(seenId);
  }
  if (replayCache.has(requestId)) return { ok: false, status: 409, error: 'replayed_request' };
  const expected = createRelaySignature({ method, pathname, timestamp, requestId, userId, body, secret: RELAY_SECRET });
  if (!secureEqual(signature, expected)) return { ok: false, status: 401, error: 'invalid_signature' };
  replayCache.set(requestId, now + SIGNATURE_WINDOW_MS);
  return { ok: true, userId };
}

function isAllowedPath(method, pathname) {
  if (method === 'POST') {
    return [
      '/v1/chat/completions',
      '/v1/videos/generations',
      '/v1/videos/edits',
      '/v1/videos/extensions',
    ].includes(pathname);
  }
  return method === 'GET' && /^\/v1\/videos\/[A-Za-z0-9-]+$/.test(pathname);
}

export function buildGrokAgentHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: 'text/event-stream',
    'content-type': 'application/json',
    'user-agent': `grok-shell/${GROK_BUILD_CLIENT_VERSION}`,
    'x-grok-client-version': GROK_BUILD_CLIENT_VERSION,
    'x-grok-client-identifier': 'grok-shell',
    'x-grok-client-mode': 'headless',
    'x-authenticateresponse': 'authenticate-response',
    'x-xai-token-auth': 'xai-grok-cli',
    'x-grok-model-override': 'grok-4.5',
  };
}

function validateGrokAgentBody(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'invalid_payload' };
  }
  if (payload.model !== 'grok-4.5') return { ok: false, error: 'unsupported_model' };
  if (payload.stream !== true) return { ok: false, error: 'stream_required' };
  return { ok: true };
}

async function forwardGrokAgent(res, body) {
  const send = async credential => fetch(`${GROK_CLI_PROXY_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: buildGrokAgentHeaders(credential.access),
    body,
  });
  let upstream = await send(await getValidXaiOAuthCredential());
  if (upstream.status === 401) {
    await upstream.body?.cancel().catch(() => undefined);
    upstream = await send(await getValidXaiOAuthCredential({ forceRefresh: true }));
  }
  const headers = {
    'content-type': upstream.headers.get('content-type') || 'text/event-stream',
    'cache-control': 'no-store',
  };
  if ([401, 403, 429].includes(upstream.status)) {
    headers['x-makaron-relay-outcome'] = 'upstream-rejected-before-task';
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
}

async function forwardXai(req, res, url, body) {
  const send = async credential => fetch(`${XAI_BASE_URL}${url.pathname}`, {
    method: req.method,
    headers: {
      authorization: `Bearer ${credential.access}`,
      'user-agent': 'makaron-grok-relay/0.1',
      ...(req.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(req.method === 'POST' ? { body } : {}),
  });
  let upstream = await send(await getValidXaiOAuthCredential());
  if (upstream.status === 401) {
    await upstream.body?.cancel().catch(() => undefined);
    upstream = await send(await getValidXaiOAuthCredential({ forceRefresh: true }));
  }
  const headers = {
    'content-type': upstream.headers.get('content-type') || 'application/json',
    'cache-control': 'no-store',
  };
  // xAI documents synchronous auth/rate-limit rejection before a video job is
  // created. Only those responses may safely trigger Makaron's API fallback.
  if ([401, 403, 429].includes(upstream.status)) {
    headers['x-makaron-relay-outcome'] = 'upstream-rejected-before-task';
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
}

export function createRelayServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      try {
        await getValidXaiOAuthCredential();
        sendJson(res, 200, { ok: true, auth: 'xai-oauth' });
      } catch {
        sendJson(res, 503, { ok: false, auth: 'missing' });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/preflight') {
      try {
        const body = await readBody(req);
        const verified = verifyRelayRequest({ method: req.method, pathname: url.pathname, headers: req.headers, body });
        if (!verified.ok) {
          sendJson(res, verified.status, { error: verified.error }, { 'x-makaron-relay-outcome': 'rejected-before-upstream' });
          return;
        }
        await getValidXaiOAuthCredential();
        sendJson(res, 200, { ok: true });
      } catch (error) {
        if (error?.code === 'ENOENT' || /OAuth credential/i.test(safeError(error))) {
          sendJson(res, 503, { error: 'xai_oauth_missing' }, { 'x-makaron-relay-outcome': 'rejected-before-upstream' });
          return;
        }
        sendJson(res, Number.isInteger(error?.statusCode) ? error.statusCode : 400, { error: 'invalid_request' }, { 'x-makaron-relay-outcome': 'rejected-before-upstream' });
      }
      return;
    }
    if (!isAllowedPath(req.method, url.pathname)) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    try {
      const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
      const verified = verifyRelayRequest({ method: req.method, pathname: url.pathname, headers: req.headers, body });
      if (!verified.ok) {
        sendJson(res, verified.status, { error: verified.error }, { 'x-makaron-relay-outcome': 'rejected-before-upstream' });
        return;
      }
      if (url.pathname === '/v1/chat/completions') {
        const validation = validateGrokAgentBody(body);
        if (!validation.ok) {
          sendJson(res, 400, { error: validation.error }, { 'x-makaron-relay-outcome': 'rejected-before-upstream' });
          return;
        }
        await forwardGrokAgent(res, body);
      } else {
        await forwardXai(req, res, url, body);
      }
    } catch (error) {
      console.error(`[makaron-grok-relay] request failed: ${safeError(error)}`);
      if (!res.headersSent) sendJson(res, 502, { error: 'unknown_upstream_outcome' });
      else res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!RELAY_SECRET || !OWNER_USER_ID) {
    console.error('[makaron-grok-relay] GROK_SUBSCRIPTION_RELAY_SECRET and GROK_SUBSCRIPTION_OWNER_USER_ID are required');
    process.exit(1);
  }
  const server = createRelayServer();
  server.listen(PORT, HOST, () => console.log(`[makaron-grok-relay] listening on ${HOST}:${PORT}`));
}
