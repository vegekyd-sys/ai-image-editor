import { spawn } from 'node:child_process';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const AUTH_TIMEOUT_MS = 15_000;
const REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const SIGNATURE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PORT = Number.parseInt(process.env.PORT || '25984', 10);
const HOST = process.env.HOST?.trim() || '127.0.0.1';
const RELAY_SECRET = process.env.CODEX_SUBSCRIPTION_RELAY_SECRET?.trim();
const OWNER_USER_ID = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
const LEGACY_ALLOWED_USER_IDS = new Set(
  (process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
);
const CODEX_CLI_PATH = process.env.CODEX_CLI_PATH?.trim() || 'codex';
const ORIGINATOR = process.env.CODEX_SUBSCRIPTION_ORIGINATOR?.trim() || 'makaron';
const ALLOWLIST_PATH = process.env.CODEX_SUBSCRIPTION_ALLOWLIST_PATH?.trim()
  || (process.env.CODEX_HOME?.trim()
    ? resolve(process.env.CODEX_HOME, '..', 'allowed-users.json')
    : undefined);

const HEADER = {
  timestamp: 'x-makaron-relay-timestamp',
  requestId: 'x-makaron-relay-request-id',
  userId: 'x-makaron-relay-user-id',
  signature: 'x-makaron-relay-signature',
  sessionId: 'x-makaron-codex-session-id',
};

let cachedCredentials;
let credentialsInFlight;
const replayCache = new Map();

function normalizeAllowedUserIds(value) {
  const normalized = new Set(
    Array.isArray(value)
      ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [],
  );
  if (OWNER_USER_ID) normalized.add(OWNER_USER_ID);
  return normalized;
}

function loadAllowedUserIds() {
  if (ALLOWLIST_PATH) {
    try {
      const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
      if (Array.isArray(parsed?.userIds)) return normalizeAllowedUserIds(parsed.userIds);
      throw new Error('invalid persisted allowlist');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error(`[makaron-codex-relay] unable to read persisted allowlist: ${safeError(error)}`);
        return normalizeAllowedUserIds([]);
      }
    }
  }
  return normalizeAllowedUserIds([...LEGACY_ALLOWED_USER_IDS]);
}

let allowedUserIds = loadAllowedUserIds();

export function replaceRelayAllowedUserIds(userIds, options = {}) {
  const next = normalizeAllowedUserIds(userIds);
  if (next.size > 100) throw Object.assign(new Error('allowlist too large'), { statusCode: 400 });
  if (options.persist !== false) {
    if (!ALLOWLIST_PATH) throw Object.assign(new Error('allowlist persistence is not configured'), { statusCode: 503 });
    const temporaryPath = resolve(dirname(ALLOWLIST_PATH), `.allowed-users-${randomUUID()}.tmp`);
    writeFileSync(temporaryPath, `${JSON.stringify({ userIds: [...next] }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, ALLOWLIST_PATH);
  }
  allowedUserIds = next;
  return [...next];
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]')
    .slice(0, 500);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
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
  if (!RELAY_SECRET || !OWNER_USER_ID) {
    return { ok: false, status: 503, error: 'relay_not_configured' };
  }
  const timestamp = headers[HEADER.timestamp];
  const requestId = headers[HEADER.requestId];
  const userId = headers[HEADER.userId];
  const signature = headers[HEADER.signature];
  if (![timestamp, requestId, userId, signature].every(value => typeof value === 'string' && value)) {
    return { ok: false, status: 401, error: 'missing_signature' };
  }
  if (!allowedUserIds.has(userId)) {
    return { ok: false, status: 403, error: 'not_allowlisted' };
  }
  if (pathname === '/v1/allowlist' && userId !== OWNER_USER_ID) {
    return { ok: false, status: 403, error: 'owner_required' };
  }
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || Math.abs(now - numericTimestamp) > SIGNATURE_WINDOW_MS) {
    return { ok: false, status: 401, error: 'stale_signature' };
  }
  for (const [seenId, expiresAt] of replayCache) {
    if (expiresAt <= now) replayCache.delete(seenId);
  }
  if (replayCache.has(requestId)) {
    return { ok: false, status: 409, error: 'replayed_request' };
  }
  const expected = createRelaySignature({
    method,
    pathname,
    timestamp,
    requestId,
    userId,
    body,
    secret: RELAY_SECRET,
  });
  if (!secureEqual(signature, expected)) {
    return { ok: false, status: 401, error: 'invalid_signature' };
  }
  replayCache.set(requestId, now + SIGNATURE_WINDOW_MS);
  return { ok: true, userId };
}

function parseToken(token) {
  const segments = token.split('.');
  if (segments.length < 2) throw new Error('managed token is not a JWT');
  const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
  const expiresAtMs = typeof claims?.exp === 'number' ? claims.exp * 1_000 : Number.NaN;
  if (typeof accountId !== 'string' || !accountId || !Number.isFinite(expiresAtMs)) {
    throw new Error('managed token is missing routing claims');
  }
  return { accountId, expiresAtMs };
}

function callAppServer(methods, forceRefresh = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_CLI_PATH, ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const initializeId = `relay-init-${randomUUID()}`;
    const requests = methods.map((method, index) => ({
      ...method,
      id: `relay-${index}-${randomUUID()}`,
    }));
    const pending = new Set(requests.map(request => request.id));
    const results = new Map();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let clientVersion;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      child.stdin.end();
      if (!child.killed) child.kill('SIGTERM');
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ results, requests, clientVersion });
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timeout = setTimeout(() => fail(new Error('Codex App Server timed out')), AUTH_TIMEOUT_MS);

    child.once('error', error => fail(new Error(`unable to start Codex CLI: ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (!settled) fail(new Error(
        `Codex App Server exited (${code ?? signal ?? 'unknown'})${stderrBuffer.trim() ? `: ${safeError(stderrBuffer)}` : ''}`,
      ));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-2_000);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk;
      while (stdoutBuffer.includes('\n')) {
        const newline = stdoutBuffer.indexOf('\n');
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === initializeId) {
          if (message.error) {
            fail(new Error(`Codex App Server initialize failed: ${safeError(message.error?.message)}`));
            return;
          }
          const userAgent = message.result?.userAgent;
          if (typeof userAgent === 'string') clientVersion = userAgent.match(/\/([0-9][^\s(;]*)/)?.[1];
          send({ method: 'initialized' });
          for (const request of requests) {
            const params = request.method === 'getAuthStatus'
              ? { includeToken: true, refreshToken: forceRefresh }
              : request.params;
            send({ id: request.id, method: request.method, ...(params ? { params } : {}) });
          }
          continue;
        }
        if (typeof message.id !== 'string' || !pending.has(message.id)) continue;
        if (message.error) {
          fail(new Error(`Codex App Server ${message.id} failed: ${safeError(message.error?.message)}`));
          return;
        }
        results.set(message.id, message.result ?? {});
        pending.delete(message.id);
        if (pending.size === 0) succeed();
      }
    });
    send({
      id: initializeId,
      method: 'initialize',
      params: {
        clientInfo: { name: 'makaron-relay', title: 'Makaron Codex Relay', version: '1.0.0' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
  });
}

async function loadCredentials(forceRefresh = false) {
  if (!forceRefresh && cachedCredentials && cachedCredentials.expiresAtMs - Date.now() > REFRESH_WINDOW_MS) {
    return cachedCredentials;
  }
  if (!credentialsInFlight) {
    credentialsInFlight = callAppServer([{ method: 'getAuthStatus' }], forceRefresh)
      .then(({ results, requests, clientVersion }) => {
        const auth = results.get(requests[0].id);
        if (auth?.authMethod !== 'chatgpt' || typeof auth?.authToken !== 'string') {
          throw new Error('dedicated Codex home is not logged in with ChatGPT');
        }
        const parsed = parseToken(auth.authToken);
        cachedCredentials = { accessToken: auth.authToken, ...parsed, clientVersion };
        return cachedCredentials;
      })
      .finally(() => { credentialsInFlight = undefined; });
  }
  return credentialsInFlight;
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : undefined;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeUsage(accountPayload, ratePayload) {
  const account = asRecord(asRecord(accountPayload)?.account);
  const primary = asRecord(asRecord(ratePayload)?.rateLimits);
  const byLimitId = asRecord(asRecord(ratePayload)?.rateLimitsByLimitId);
  const snapshots = [primary, ...Object.values(byLimitId ?? {}).map(asRecord)].filter(Boolean);
  const windows = snapshots.flatMap(snapshot => [asRecord(snapshot.primary), asRecord(snapshot.secondary)]).filter(Boolean);
  const weekly = windows.sort((left, right) => (
    Math.abs((finite(left.windowDurationMins) ?? 0) - 10_080)
    - Math.abs((finite(right.windowDurationMins) ?? 0) - 10_080)
  ))[0];
  const usedPercent = weekly ? finite(weekly.usedPercent) : undefined;
  const windowDurationMins = weekly ? finite(weekly.windowDurationMins) : undefined;
  const resetsAt = weekly ? finite(weekly.resetsAt) : undefined;
  return {
    planType: typeof primary?.planType === 'string'
      ? primary.planType
      : typeof account?.planType === 'string' ? account.planType : null,
    weekly: usedPercent !== undefined && windowDurationMins !== undefined && resetsAt !== undefined
      ? {
          usedPercent: Math.min(100, Math.max(0, usedPercent)),
          remainingPercent: Math.max(0, 100 - Math.min(100, Math.max(0, usedPercent))),
          windowDurationMins,
          resetsAt,
        }
      : null,
  };
}

async function readUsage() {
  const methods = [
    { method: 'account/read', params: { refreshToken: false } },
    { method: 'account/rateLimits/read' },
    { method: 'getAuthStatus' },
  ];
  const { results, requests, clientVersion } = await callAppServer(methods, false);
  const auth = results.get(requests[2].id);
  if (auth?.authMethod !== 'chatgpt' || typeof auth?.authToken !== 'string') {
    throw new Error('dedicated Codex home is not logged in with ChatGPT');
  }
  const parsed = parseToken(auth.authToken);
  cachedCredentials = { accessToken: auth.authToken, ...parsed, clientVersion };
  return sanitizeUsage(results.get(requests[0].id), results.get(requests[1].id));
}

async function forwardResponses(req, res, body) {
  const send = async (credentials) => {
    const headers = new Headers({
      authorization: `Bearer ${credentials.accessToken}`,
      'chatgpt-account-id': credentials.accountId,
      originator: ORIGINATOR,
      'content-type': req.headers['content-type'] || 'application/json',
      accept: req.headers.accept || 'text/event-stream',
      'session-id': req.headers[HEADER.sessionId] || `makaron-${randomUUID()}`,
      'x-client-request-id': randomUUID(),
    });
    if (credentials.clientVersion) headers.set('version', credentials.clientVersion);
    return fetch(RESPONSES_URL, { method: 'POST', headers, body });
  };
  let upstream = await send(await loadCredentials(false));
  if (upstream.status === 401) {
    await upstream.body?.cancel().catch(() => undefined);
    upstream = await send(await loadCredentials(true));
  }
  const responseHeaders = {
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
    'cache-control': 'no-store',
  };
  const upstreamRequestId = upstream.headers.get('x-request-id');
  if (upstreamRequestId) responseHeaders['x-request-id'] = upstreamRequestId;
  res.writeHead(upstream.status, responseHeaders);
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
      sendJson(res, 200, { ok: true });
      return;
    }
    const isAllowlistRead = req.method === 'GET' && url.pathname === '/v1/allowlist';
    if (!isAllowlistRead && (req.method !== 'POST' || !['/v1/responses', '/v1/usage', '/v1/allowlist'].includes(url.pathname))) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    try {
      const body = isAllowlistRead ? Buffer.alloc(0) : await readBody(req);
      const verified = verifyRelayRequest({
        method: req.method,
        pathname: url.pathname,
        headers: req.headers,
        body,
      });
      if (!verified.ok) {
        sendJson(res, verified.status, { error: verified.error });
        return;
      }
      if (url.pathname === '/v1/allowlist') {
        if (isAllowlistRead) {
          sendJson(res, 200, { userIds: [...allowedUserIds] });
          return;
        }
        const payload = JSON.parse(body.toString('utf8'));
        if (!Array.isArray(payload?.userIds) || !payload.userIds.every(id => typeof id === 'string')) {
          sendJson(res, 400, { error: 'invalid_allowlist' });
          return;
        }
        replaceRelayAllowedUserIds(payload.userIds);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (url.pathname === '/v1/usage') {
        sendJson(res, 200, await readUsage());
        return;
      }
      await forwardResponses(req, res, body);
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      console.error(`[makaron-codex-relay] request failed: ${safeError(error)}`);
      if (!res.headersSent) sendJson(res, status, { error: 'relay_unavailable' });
      else res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!RELAY_SECRET || !OWNER_USER_ID) {
    console.error('[makaron-codex-relay] CODEX_SUBSCRIPTION_RELAY_SECRET and CODEX_SUBSCRIPTION_OWNER_USER_ID are required');
    process.exit(1);
  }
  const server = createRelayServer();
  server.listen(PORT, HOST, () => {
    console.log(`[makaron-codex-relay] listening on ${HOST}:${PORT}`);
  });
}
