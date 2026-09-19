import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const CODEX_SUBSCRIPTION_RESPONSES_URL =
  'https://chatgpt.com/backend-api/codex/responses';

const CODEX_AUTH_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const BUNDLED_MAC_CODEX_PATH = '/Applications/ChatGPT.app/Contents/Resources/codex';

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CodexSubscriptionCredentials {
  accessToken: string;
  accountId: string;
  expiresAtMs: number;
  clientVersion?: string;
}

interface JsonRpcResponse {
  id?: string | number;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

export interface CodexSubscriptionUsage {
  planType: string | null;
  weekly: {
    usedPercent: number;
    remainingPercent: number;
    windowDurationMins: number;
    resetsAt: number;
  } | null;
}

interface CodexSubscriptionFetchOptions {
  projectId: string;
  userId?: string;
  endpoint?: string;
  relayUrl?: string;
  relaySecret?: string;
  fetch?: FetchLike;
  credentials?: (forceRefresh: boolean) => Promise<CodexSubscriptionCredentials>;
}

export const CODEX_RELAY_HEADERS = {
  timestamp: 'x-makaron-relay-timestamp',
  requestId: 'x-makaron-relay-request-id',
  userId: 'x-makaron-relay-user-id',
  signature: 'x-makaron-relay-signature',
  sessionId: 'x-makaron-codex-session-id',
} as const;

function resolveRelayUrl(path: string, configured?: string): URL | undefined {
  const relayUrl = configured?.trim() || process.env.CODEX_SUBSCRIPTION_RELAY_URL?.trim();
  if (!relayUrl) return undefined;
  const baseUrl = new URL(relayUrl.endsWith('/') ? relayUrl : `${relayUrl}/`);
  return new URL(path.replace(/^\//, ''), baseUrl);
}

function resolveRelaySecret(configured?: string): string | undefined {
  return configured?.trim() || process.env.CODEX_SUBSCRIPTION_RELAY_SECRET?.trim();
}

export function createCodexRelaySignature(input: {
  method: string;
  pathname: string;
  timestamp: string;
  requestId: string;
  userId: string;
  body: ArrayBuffer | Uint8Array | string;
  secret: string;
}): string {
  const bodyBuffer = typeof input.body === 'string'
    ? Buffer.from(input.body)
    : Buffer.from(input.body instanceof ArrayBuffer ? new Uint8Array(input.body) : input.body);
  const bodyHash = createHash('sha256').update(bodyBuffer).digest('hex');
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

function createCodexRelayHeaders(input: {
  method: string;
  url: URL;
  body: ArrayBuffer | Uint8Array | string;
  userId?: string;
  secret?: string;
  sessionId?: string;
}): Headers {
  const userId = input.userId?.trim();
  const secret = resolveRelaySecret(input.secret);
  if (!userId) {
    throw new Error('CODEX_SUBSCRIPTION_RELAY_UNAVAILABLE: authenticated user id is required');
  }
  if (!secret) {
    throw new Error('CODEX_SUBSCRIPTION_RELAY_UNAVAILABLE: relay secret is not configured');
  }
  const timestamp = Date.now().toString();
  const requestId = randomUUID();
  const signature = createCodexRelaySignature({
    method: input.method,
    pathname: input.url.pathname,
    timestamp,
    requestId,
    userId,
    body: input.body,
    secret,
  });
  const headers = new Headers({
    [CODEX_RELAY_HEADERS.timestamp]: timestamp,
    [CODEX_RELAY_HEADERS.requestId]: requestId,
    [CODEX_RELAY_HEADERS.userId]: userId,
    [CODEX_RELAY_HEADERS.signature]: signature,
  });
  if (input.sessionId) headers.set(CODEX_RELAY_HEADERS.sessionId, input.sessionId);
  return headers;
}

let cachedCredentials: CodexSubscriptionCredentials | undefined;
let credentialsInFlight: Promise<CodexSubscriptionCredentials> | undefined;

function resolveCodexCliPath(): string {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  if (configured) return configured;
  if (process.platform === 'darwin' && existsSync(BUNDLED_MAC_CODEX_PATH)) {
    return BUNDLED_MAC_CODEX_PATH;
  }
  return 'codex';
}

function safeRpcError(error: JsonRpcResponse['error']): string {
  const code = typeof error?.code === 'number' ? ` (${error.code})` : '';
  const message = typeof error?.message === 'string'
    ? error.message.replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]').slice(0, 500)
    : 'unknown app-server error';
  return `${message}${code}`;
}

export function parseCodexSubscriptionAccessToken(
  accessToken: string,
): Pick<CodexSubscriptionCredentials, 'accountId' | 'expiresAtMs'> {
  const segments = accessToken.split('.');
  if (segments.length < 2) {
    throw new Error('Codex subscription access token is not a JWT');
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('Codex subscription access token has invalid JWT claims');
  }

  const authClaims = claims['https://api.openai.com/auth'];
  const accountId = authClaims && typeof authClaims === 'object'
    ? (authClaims as Record<string, unknown>).chatgpt_account_id
    : undefined;
  const expiresAtMs = typeof claims.exp === 'number' ? claims.exp * 1_000 : Number.NaN;
  if (typeof accountId !== 'string' || !accountId.trim()) {
    throw new Error('Codex subscription token does not include a ChatGPT account id');
  }
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error('Codex subscription token does not include an expiry');
  }

  return { accountId, expiresAtMs };
}

export function assertCodexSubscriptionRateLimitsAvailable(payload: unknown): void {
  const result = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const snapshots: Record<string, unknown>[] = [];
  if (result.rateLimits && typeof result.rateLimits === 'object') {
    snapshots.push(result.rateLimits as Record<string, unknown>);
  }
  if (result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object') {
    for (const snapshot of Object.values(result.rateLimitsByLimitId as Record<string, unknown>)) {
      if (snapshot && typeof snapshot === 'object') {
        snapshots.push(snapshot as Record<string, unknown>);
      }
    }
  }
  if (snapshots.length === 0) {
    throw new Error(
      'CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: Codex App Server returned no rate-limit state',
    );
  }

  for (const snapshot of snapshots) {
    const reachedType = snapshot.rateLimitReachedType;
    if (typeof reachedType === 'string' && reachedType.trim()) {
      throw new Error(`UsageLimitExceeded: ${reachedType}`);
    }
    if (snapshot.spendControlReached === true) {
      throw new Error('UsageLimitExceeded: spend control reached');
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseCodexSubscriptionUsage(
  accountPayload: unknown,
  rateLimitsPayload: unknown,
): CodexSubscriptionUsage {
  const accountResult = asRecord(accountPayload);
  const account = asRecord(accountResult?.account);
  const rateLimitResult = asRecord(rateLimitsPayload);
  const primaryRateLimits = asRecord(rateLimitResult?.rateLimits);
  const byLimitId = asRecord(rateLimitResult?.rateLimitsByLimitId);
  const limitSnapshots = [
    primaryRateLimits,
    ...Object.values(byLimitId ?? {}).map(asRecord),
  ].filter((value): value is Record<string, unknown> => Boolean(value));
  const windows = limitSnapshots.flatMap((snapshot) => [
    asRecord(snapshot.primary),
    asRecord(snapshot.secondary),
  ]).filter((value): value is Record<string, unknown> => Boolean(value));
  const weeklyWindow = windows
    .filter(window => asFiniteNumber(window.windowDurationMins) !== undefined)
    .sort((left, right) => {
      const leftDistance = Math.abs((asFiniteNumber(left.windowDurationMins) ?? 0) - 10_080);
      const rightDistance = Math.abs((asFiniteNumber(right.windowDurationMins) ?? 0) - 10_080);
      return leftDistance - rightDistance;
    })[0];
  const usedPercent = weeklyWindow
    ? Math.min(100, Math.max(0, asFiniteNumber(weeklyWindow.usedPercent) ?? 0))
    : undefined;
  const resetsAt = weeklyWindow ? asFiniteNumber(weeklyWindow.resetsAt) : undefined;
  const windowDurationMins = weeklyWindow
    ? asFiniteNumber(weeklyWindow.windowDurationMins)
    : undefined;

  const planType = typeof primaryRateLimits?.planType === 'string'
    ? primaryRateLimits.planType
    : typeof account?.planType === 'string'
      ? account.planType
      : null;
  return {
    planType,
    weekly: usedPercent !== undefined && resetsAt !== undefined && windowDurationMins !== undefined
      ? {
          usedPercent,
          remainingPercent: Math.max(0, 100 - usedPercent),
          windowDurationMins,
          resetsAt,
        }
      : null,
  };
}

export async function getCodexSubscriptionUsage(
  userId?: string,
  options?: { relayUrl?: string; relaySecret?: string; fetch?: FetchLike },
): Promise<CodexSubscriptionUsage> {
  const relayEndpoint = resolveRelayUrl('/v1/usage', options?.relayUrl);
  if (relayEndpoint) {
    const body = '';
    const headers = createCodexRelayHeaders({
      method: 'POST',
      url: relayEndpoint,
      body,
      userId,
      secret: options?.relaySecret,
    });
    const response = await (options?.fetch ?? globalThis.fetch)(relayEndpoint, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: relay HTTP ${response.status}`);
    }
    return await response.json() as CodexSubscriptionUsage;
  }

  const command = resolveCodexCliPath();
  const initializeId = `makaron-usage-init-${randomUUID()}`;
  const accountId = `makaron-usage-account-${randomUUID()}`;
  const rateLimitsId = `makaron-usage-limits-${randomUUID()}`;
  const authId = `makaron-usage-auth-${randomUUID()}`;

  return new Promise<CodexSubscriptionUsage>((resolve, reject) => {
    const child = spawn(command, ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pendingIds = new Set([accountId, rateLimitsId, authId]);
    const results = new Map<string, Record<string, unknown>>();
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let clientVersion: string | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      child.stdin.end();
      if (!child.killed) child.kill('SIGTERM');
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const send = (message: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const timeout = setTimeout(() => {
      fail(new Error('CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: Codex usage request timed out'));
    }, CODEX_AUTH_TIMEOUT_MS);

    child.once('error', error => fail(new Error(
      `CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: unable to start Codex CLI (${error.message})`,
    )));
    child.once('exit', (code, signal) => {
      if (settled) return;
      const detail = stderrBuffer
        .replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]')
        .trim()
        .slice(0, 500);
      fail(new Error(
        `CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: Codex App Server exited (${code ?? signal ?? 'unknown'})${detail ? `: ${detail}` : ''}`,
      ));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-2_000);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      while (stdoutBuffer.includes('\n')) {
        const newline = stdoutBuffer.indexOf('\n');
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;

        let message: JsonRpcResponse;
        try {
          message = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }

        if (message.id === initializeId) {
          if (message.error) {
            fail(new Error(`CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: initialize failed: ${safeRpcError(message.error)}`));
            return;
          }
          const userAgent = message.result?.userAgent;
          if (typeof userAgent === 'string') {
            clientVersion = userAgent.match(/\/([0-9][^\s(;]*)/)?.[1];
          }
          send({ method: 'initialized' });
          send({ id: accountId, method: 'account/read', params: { refreshToken: false } });
          send({ id: rateLimitsId, method: 'account/rateLimits/read' });
          send({
            id: authId,
            method: 'getAuthStatus',
            params: { includeToken: true, refreshToken: false },
          });
          continue;
        }

        if (typeof message.id !== 'string' || !pendingIds.has(message.id)) continue;
        if (message.error) {
          fail(new Error(`CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: ${safeRpcError(message.error)}`));
          return;
        }
        results.set(message.id, message.result ?? {});
        pendingIds.delete(message.id);
        if (pendingIds.size === 0) {
          try {
            const authResult = results.get(authId);
            const authMethod = authResult?.authMethod;
            const accessToken = authResult?.authToken;
            if (authMethod !== 'chatgpt' || typeof accessToken !== 'string' || !accessToken) {
              throw new Error('Codex App Server did not return managed ChatGPT authentication');
            }
            const parsedToken = parseCodexSubscriptionAccessToken(accessToken);
            cachedCredentials = { accessToken, ...parsedToken, clientVersion };
            const parsed = parseCodexSubscriptionUsage(
              results.get(accountId),
              results.get(rateLimitsId),
            );
            settled = true;
            cleanup();
            resolve(parsed);
          } catch (error) {
            fail(new Error(
              `CODEX_SUBSCRIPTION_USAGE_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
            ));
          }
        }
      }
    });

    send({
      id: initializeId,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'makaron',
          title: 'Makaron Codex Subscription Usage',
          version: '1.0.0',
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      },
    });
  });
}

export async function readCodexSubscriptionRelayAllowlist(ownerUserId: string): Promise<string[]> {
  const url = resolveRelayUrl('/v1/allowlist');
  if (!url) throw new Error('Codex relay is not configured');
  const headers = createCodexRelayHeaders({ method: 'GET', url, body: '', userId: ownerUserId });
  const response = await fetch(url, { method: 'GET', headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Codex allowlist read failed (${response.status})`);
  const payload = await response.json() as { userIds?: unknown };
  if (!Array.isArray(payload.userIds) || !payload.userIds.every(id => typeof id === 'string')) {
    throw new Error('Codex allowlist response is invalid');
  }
  return payload.userIds;
}

export async function syncCodexSubscriptionRelayAllowlist(
  userIds: string[],
  ownerUserId: string,
): Promise<void> {
  const url = resolveRelayUrl('/v1/allowlist');
  if (!url) {
    throw new Error('CODEX_SUBSCRIPTION_RELAY_UNAVAILABLE: relay URL is not configured');
  }
  const body = JSON.stringify({ userIds });
  const headers = createCodexRelayHeaders({
    method: 'POST',
    url,
    body,
    userId: ownerUserId,
  });
  headers.set('content-type', 'application/json');
  const response = await fetch(url, { method: 'POST', headers, body, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`CODEX_SUBSCRIPTION_RELAY_UNAVAILABLE: allowlist sync failed (${response.status})`);
  }
}

async function loadCredentialsFromCodexAppServer(
  forceRefresh: boolean,
  verifyRateLimits = false,
): Promise<CodexSubscriptionCredentials> {
  const command = resolveCodexCliPath();
  const initializeId = `makaron-init-${randomUUID()}`;
  const authId = `makaron-auth-${randomUUID()}`;
  const rateLimitsId = `makaron-rate-limits-${randomUUID()}`;

  return new Promise<CodexSubscriptionCredentials>((resolve, reject) => {
    const child = spawn(command, ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let clientVersion: string | undefined;
    let pendingCredentials: CodexSubscriptionCredentials | undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      child.stdin.end();
      if (!child.killed) child.kill('SIGTERM');
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (credentials: CodexSubscriptionCredentials) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(credentials);
    };
    const send = (message: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const timeout = setTimeout(() => {
      fail(new Error('CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: Codex App Server authentication timed out'));
    }, CODEX_AUTH_TIMEOUT_MS);

    child.once('error', (error) => {
      fail(new Error(
        `CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: unable to start Codex CLI (${error.message})`,
      ));
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      const detail = stderrBuffer
        .replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]')
        .trim()
        .slice(0, 500);
      fail(new Error(
        `CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: Codex App Server exited before authentication (${code ?? signal ?? 'unknown'})${detail ? `: ${detail}` : ''}`,
      ));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-2_000);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      while (stdoutBuffer.includes('\n')) {
        const newline = stdoutBuffer.indexOf('\n');
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;

        let message: JsonRpcResponse;
        try {
          message = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }

        if (message.id === initializeId) {
          if (message.error) {
            fail(new Error(
              `CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: initialize failed: ${safeRpcError(message.error)}`,
            ));
            return;
          }
          const userAgent = message.result?.userAgent;
          if (typeof userAgent === 'string') {
            clientVersion = userAgent.match(/\/([0-9][^\s(;]*)/)?.[1];
          }
          send({ method: 'initialized' });
          send({
            id: authId,
            method: 'getAuthStatus',
            params: { includeToken: true, refreshToken: forceRefresh },
          });
          continue;
        }

        if (message.id === rateLimitsId) {
          if (message.error) {
            fail(new Error(
              `CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: rate-limit check failed: ${safeRpcError(message.error)}`,
            ));
            return;
          }
          try {
            assertCodexSubscriptionRateLimitsAvailable(message.result);
            if (!pendingCredentials) {
              throw new Error('Codex App Server returned rate limits before authentication');
            }
            succeed(pendingCredentials);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
          continue;
        }

        if (message.id !== authId) continue;
        if (message.error) {
          fail(new Error(
            `CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: auth failed: ${safeRpcError(message.error)}`,
          ));
          return;
        }

        const authMethod = message.result?.authMethod;
        const accessToken = message.result?.authToken;
        if (authMethod !== 'chatgpt') {
          fail(new Error(
            'CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: run `codex login` with the personal ChatGPT account first',
          ));
          return;
        }
        if (typeof accessToken !== 'string' || !accessToken) {
          fail(new Error(
            'CODEX_SUBSCRIPTION_AUTH_UNAVAILABLE: Codex App Server did not return a managed ChatGPT token',
          ));
          return;
        }

        try {
          const parsed = parseCodexSubscriptionAccessToken(accessToken);
          const credentials = { accessToken, ...parsed, clientVersion };
          if (!verifyRateLimits) {
            succeed(credentials);
          } else {
            pendingCredentials = credentials;
            send({ id: rateLimitsId, method: 'account/rateLimits/read' });
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });

    send({
      id: initializeId,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'makaron',
          title: 'Makaron Codex Subscription Provider',
          version: '1.0.0',
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      },
    });
  });
}

export async function getCodexSubscriptionCredentials(
  forceRefresh = false,
): Promise<CodexSubscriptionCredentials> {
  if (
    !forceRefresh
    && cachedCredentials
    && cachedCredentials.expiresAtMs - Date.now() > TOKEN_REFRESH_WINDOW_MS
  ) {
    return cachedCredentials;
  }

  if (!credentialsInFlight) {
    credentialsInFlight = loadCredentialsFromCodexAppServer(forceRefresh)
      .then((credentials) => {
        cachedCredentials = credentials;
        return credentials;
      })
      .finally(() => {
        credentialsInFlight = undefined;
      });
  }
  return credentialsInFlight;
}

export function resetCodexSubscriptionCredentialCacheForTests(): void {
  cachedCredentials = undefined;
  credentialsInFlight = undefined;
}

export function createCodexSubscriptionFetch(
  options: CodexSubscriptionFetchOptions,
): FetchLike {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const credentialLoader = options.credentials ?? getCodexSubscriptionCredentials;
  const relayEndpoint = resolveRelayUrl('/v1/responses', options.relayUrl);
  const endpoint = relayEndpoint ?? new URL(options.endpoint ?? CODEX_SUBSCRIPTION_RESPONSES_URL);
  const sessionId = `makaron-${createHash('sha256')
    .update(options.projectId)
    .digest('hex')
    .slice(0, 40)}`;

  return async (input, init) => {
    const request = new Request(input, init);
    const methodHasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const body = methodHasBody ? await request.clone().arrayBuffer() : undefined;

    if (relayEndpoint) {
      const headers = createCodexRelayHeaders({
        method: request.method,
        url: relayEndpoint,
        body: body ?? '',
        userId: options.userId,
        secret: options.relaySecret,
        sessionId,
      });
      const contentType = request.headers.get('content-type');
      const accept = request.headers.get('accept');
      if (contentType) headers.set('content-type', contentType);
      if (accept) headers.set('accept', accept);
      return fetchImpl(relayEndpoint, {
        method: request.method,
        headers,
        body,
        signal: request.signal,
      });
    }

    const send = async (credentials: CodexSubscriptionCredentials) => {
      const headers = new Headers(request.headers);
      headers.delete('api-key');
      headers.set('Authorization', `Bearer ${credentials.accessToken}`);
      headers.set('ChatGPT-Account-ID', credentials.accountId);
      headers.set('originator', process.env.CODEX_SUBSCRIPTION_ORIGINATOR?.trim() || 'makaron');
      if (credentials.clientVersion) headers.set('version', credentials.clientVersion);
      headers.set('session-id', sessionId);
      headers.set('x-client-request-id', randomUUID());
      return fetchImpl(endpoint, {
        method: request.method,
        headers,
        body,
        signal: request.signal,
      });
    };

    const firstCredentials = await credentialLoader(false);
    const firstResponse = await send(firstCredentials);
    if (firstResponse.status !== 401) return firstResponse;

    await firstResponse.body?.cancel().catch(() => undefined);
    const refreshedCredentials = await credentialLoader(true);
    return send(refreshedCredentials);
  };
}

export function createCodexSubscriptionResponsesModel(
  modelId: string,
  projectId: string,
  options?: Omit<CodexSubscriptionFetchOptions, 'projectId'>,
): LanguageModel {
  const endpoint = resolveRelayUrl('/v1/responses', options?.relayUrl)
    ?? new URL(options?.endpoint ?? CODEX_SUBSCRIPTION_RESPONSES_URL);
  const baseURL = new URL(endpoint);
  baseURL.pathname = baseURL.pathname.replace(/\/responses\/?$/, '');
  baseURL.search = '';

  const codexSubscription = createOpenAI({
    name: 'codex-subscription',
    baseURL: baseURL.toString().replace(/\/$/, ''),
    // The custom fetch replaces this placeholder with Codex-managed ChatGPT OAuth.
    apiKey: 'managed-by-codex-app-server',
    fetch: createCodexSubscriptionFetch({ projectId, ...options }),
  });
  return codexSubscription.responses(modelId);
}

export async function assertCodexSubscriptionAuthenticated(userId?: string): Promise<void> {
  if (resolveRelayUrl('/v1/usage')) {
    await getCodexSubscriptionUsage(userId);
    return;
  }
  const credentials = await loadCredentialsFromCodexAppServer(false, true);
  cachedCredentials = credentials;
}
