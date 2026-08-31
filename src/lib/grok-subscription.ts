import { createHash, createHmac, randomUUID } from 'node:crypto';

const SIGNATURE_HEADER = {
  timestamp: 'x-makaron-relay-timestamp',
  requestId: 'x-makaron-relay-request-id',
  userId: 'x-makaron-relay-user-id',
  signature: 'x-makaron-relay-signature',
} as const;

export class GrokSubscriptionRelayError extends Error {
  constructor(
    message: string,
    readonly safeToFallback: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GrokSubscriptionRelayError';
  }
}

function relayUrl(): string | undefined {
  return process.env.GROK_SUBSCRIPTION_RELAY_URL?.trim();
}

function relaySecret(): string | undefined {
  return process.env.GROK_SUBSCRIPTION_RELAY_SECRET?.trim();
}

export function getGrokSubscriptionOwnerUserId(): string | undefined {
  return process.env.GROK_SUBSCRIPTION_OWNER_USER_ID?.trim()
    || process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim();
}

export function getGrokSubscriptionAllowedUserIds(): Set<string> {
  const ids = new Set(
    (process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
  const owner = getGrokSubscriptionOwnerUserId();
  if (owner) ids.add(owner);
  return ids;
}

export function isGrokSubscriptionAllowedUser(userId?: string): boolean {
  return Boolean(
    userId
    && relayUrl()
    && relaySecret()
    && getGrokSubscriptionAllowedUserIds().has(userId),
  );
}

export function createGrokRelaySignature(input: {
  method: string;
  pathname: string;
  timestamp: string;
  requestId: string;
  userId: string;
  body: Uint8Array;
  secret: string;
}): string {
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

async function signedRelayFetch(options: {
  method: 'GET' | 'POST';
  pathname: string;
  userId: string;
  body?: Uint8Array;
  signal?: AbortSignal | null;
}): Promise<Response> {
  const baseUrl = relayUrl();
  const secret = relaySecret();
  if (!baseUrl || !secret) {
    throw new GrokSubscriptionRelayError('GROK_SUBSCRIPTION_RELAY_UNAVAILABLE: relay is not configured', true);
  }
  const body = options.body ?? new Uint8Array();
  const timestamp = String(Date.now());
  const requestId = randomUUID();
  const signature = createGrokRelaySignature({
    method: options.method,
    pathname: options.pathname,
    timestamp,
    requestId,
    userId: options.userId,
    body,
    secret,
  });
  const requestBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(requestBody).set(body);
  return fetch(new URL(options.pathname, baseUrl), {
    method: options.method,
    headers: {
      [SIGNATURE_HEADER.timestamp]: timestamp,
      [SIGNATURE_HEADER.requestId]: requestId,
      [SIGNATURE_HEADER.userId]: options.userId,
      [SIGNATURE_HEADER.signature]: signature,
      ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.method === 'POST' ? { body: requestBody } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function bodyToBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * AI SDK transport for xAI's subscription-only Grok Build chat endpoint.
 * The SDK never receives the owner's OAuth token; it can only call the
 * allowlisted HMAC relay path for the authenticated Makaron user.
 */
export function createGrokSubscriptionFetch(userId: string): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return Response.json({ error: 'unsupported_grok_subscription_path' }, { status: 404 });
    }
    const body = await bodyToBytes(init?.body ?? (request ? await request.clone().arrayBuffer() : undefined));
    try {
      return await signedRelayFetch({
        method: 'POST',
        pathname: '/v1/chat/completions',
        userId,
        body,
        signal: init?.signal ?? request?.signal,
      });
    } catch (error) {
      if (error instanceof GrokSubscriptionRelayError) throw error;
      throw new GrokSubscriptionRelayError(
        `GROK_SUBSCRIPTION_RELAY_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  };
}

export async function preflightGrokSubscriptionRelay(userId: string): Promise<void> {
  let response: Response;
  try {
    response = await signedRelayFetch({
      method: 'POST',
      pathname: '/v1/preflight',
      userId,
      body: new TextEncoder().encode('{}'),
    });
  } catch (error) {
    if (error instanceof GrokSubscriptionRelayError) throw error;
    throw new GrokSubscriptionRelayError(
      `GROK_SUBSCRIPTION_RELAY_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  if (!response.ok) {
    throw new GrokSubscriptionRelayError(
      `GROK_SUBSCRIPTION_RELAY_UNAVAILABLE: preflight HTTP ${response.status}`,
      true,
      response.status,
    );
  }
}

export async function fetchGrokSubscriptionRelay(options: {
  method: 'GET' | 'POST';
  pathname: string;
  userId: string;
  body?: Uint8Array;
}): Promise<Response> {
  let response: Response;
  try {
    response = await signedRelayFetch(options);
  } catch (error) {
    if (error instanceof GrokSubscriptionRelayError) throw error;
    // A POST can have reached xAI even when its response was lost. Fail closed
    // so Makaron never creates the same paid video twice through API fallback.
    throw new GrokSubscriptionRelayError(
      `GROK_SUBSCRIPTION_RELAY_UNKNOWN_OUTCOME: ${error instanceof Error ? error.message : String(error)}`,
      options.method === 'GET',
    );
  }
  if (response.ok) return response;

  const outcome = response.headers.get('x-makaron-relay-outcome');
  const safeToFallback = options.method === 'GET'
    || outcome === 'rejected-before-upstream'
    || outcome === 'upstream-rejected-before-task';
  const detail = (await response.text()).slice(0, 500);
  throw new GrokSubscriptionRelayError(
    `GROK_SUBSCRIPTION_RELAY_ERROR: HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    safeToFallback,
    response.status,
  );
}
