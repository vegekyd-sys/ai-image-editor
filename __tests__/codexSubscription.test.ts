import { describe, expect, it, vi } from 'vitest';
import {
  assertCodexSubscriptionRateLimitsAvailable,
  CODEX_RELAY_HEADERS,
  CODEX_SUBSCRIPTION_RESPONSES_URL,
  createCodexRelaySignature,
  createCodexSubscriptionFetch,
  getCodexSubscriptionUsage,
  parseCodexSubscriptionUsage,
  parseCodexSubscriptionAccessToken,
  type CodexSubscriptionCredentials,
} from '@/lib/codex-subscription';

function fakeJwt(payload: Record<string, unknown>): string {
  const encoded = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value))
    .toString('base64url');
  return `${encoded({ alg: 'none', typ: 'JWT' })}.${encoded(payload)}.signature`;
}

describe('Codex subscription transport', () => {
  it('creates a deterministic HMAC over method, path, owner, request id, and body', () => {
    expect(createCodexRelaySignature({
      method: 'post',
      pathname: '/v1/responses',
      timestamp: '1788060000000',
      requestId: 'request-1',
      userId: 'owner-id',
      body: '{"input":"hello"}',
      secret: 'relay-secret',
    })).toBe('3eecfc3761db2df0f03958fc632c483bd1a10cbecbcaa7ce7ec5c1980dcd567b');
  });

  it('parses the weekly allowance window without exposing token activity', () => {
    const usage = parseCodexSubscriptionUsage(
      { account: { planType: 'pro' } },
      {
        rateLimits: {
          planType: 'pro',
          primary: {
            usedPercent: 41,
            windowDurationMins: 10_080,
            resetsAt: 1_788_452_789,
          },
        },
      },
    );

    expect(usage).toEqual({
      planType: 'pro',
      weekly: {
        usedPercent: 41,
        remainingPercent: 59,
        windowDurationMins: 10_080,
        resetsAt: 1_788_452_789,
      },
    });
  });

  it('extracts only the routing account id and expiry from managed JWT claims', () => {
    const token = fakeJwt({
      exp: 2_000_000_000,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_personal',
      },
    });
    expect(parseCodexSubscriptionAccessToken(token)).toEqual({
      accountId: 'acct_personal',
      expiresAtMs: 2_000_000_000_000,
    });
    expect(() => parseCodexSubscriptionAccessToken('not-a-jwt'))
      .toThrow('not a JWT');
  });

  it('treats App Server quota and spend-control exhaustion as unavailable', () => {
    expect(() => assertCodexSubscriptionRateLimitsAvailable({}))
      .toThrow('returned no rate-limit state');
    expect(() => assertCodexSubscriptionRateLimitsAvailable({
      rateLimits: { rateLimitReachedType: null, spendControlReached: false },
    })).not.toThrow();
    expect(() => assertCodexSubscriptionRateLimitsAvailable({
      rateLimits: { rateLimitReachedType: 'rate_limit_reached' },
    })).toThrow('UsageLimitExceeded');
    expect(() => assertCodexSubscriptionRateLimitsAvailable({
      rateLimits: { rateLimitReachedType: null },
      rateLimitsByLimitId: {
        codex: { rateLimitReachedType: null, spendControlReached: true },
      },
    })).toThrow('spend control reached');
  });

  it('replaces placeholder API auth with Codex-managed headers and refreshes once on 401', async () => {
    const first: CodexSubscriptionCredentials = {
      accessToken: 'first-access-token',
      accountId: 'account-first',
      expiresAtMs: Date.now() + 60_000,
      clientVersion: '0.150.0',
    };
    const refreshed: CodexSubscriptionCredentials = {
      accessToken: 'refreshed-access-token',
      accountId: 'account-refreshed',
      expiresAtMs: Date.now() + 120_000,
      clientVersion: '0.150.0',
    };
    const credentials = vi.fn(async (forceRefresh: boolean) => (
      forceRefresh ? refreshed : first
    ));
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return requests.length === 1
        ? new Response('unauthorized', { status: 401 })
        : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const transport = createCodexSubscriptionFetch({
      projectId: 'private-project-id',
      credentials,
      fetch: fetchImpl,
    });

    const response = await transport('https://placeholder.invalid/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer placeholder',
        'api-key': 'placeholder',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ store: false, input: 'hello' }),
    });

    expect(response.status).toBe(200);
    expect(credentials.mock.calls.map(([force]) => force)).toEqual([false, true]);
    expect(requests).toHaveLength(2);
    expect(requests.map(request => request.url)).toEqual([
      CODEX_SUBSCRIPTION_RESPONSES_URL,
      CODEX_SUBSCRIPTION_RESPONSES_URL,
    ]);
    expect(requests[0].headers.get('authorization')).toBe('Bearer first-access-token');
    expect(requests[1].headers.get('authorization')).toBe('Bearer refreshed-access-token');
    expect(requests[0].headers.get('chatgpt-account-id')).toBe('account-first');
    expect(requests[1].headers.get('chatgpt-account-id')).toBe('account-refreshed');
    expect(requests[0].headers.get('api-key')).toBeNull();
    expect(requests[0].headers.get('originator')).toBe('makaron');
    expect(requests[0].headers.get('version')).toBe('0.150.0');
    expect(requests[0].headers.get('session-id')).toBe(requests[1].headers.get('session-id'));
    expect(requests[0].headers.get('session-id')).not.toContain('private-project-id');
    expect(requests[0].headers.get('x-client-request-id'))
      .not.toBe(requests[1].headers.get('x-client-request-id'));
    expect(await requests[0].text()).toBe(JSON.stringify({ store: false, input: 'hello' }));
    expect(await requests[1].text()).toBe(JSON.stringify({ store: false, input: 'hello' }));
  });

  it('returns quota responses to the Agent fallback boundary without refreshing OAuth', async () => {
    const credentials = vi.fn(async () => ({
      accessToken: 'access-token',
      accountId: 'account-id',
      expiresAtMs: Date.now() + 60_000,
    }));
    const transport = createCodexSubscriptionFetch({
      projectId: 'project',
      credentials,
      fetch: async () => new Response('UsageLimitExceeded', { status: 429 }),
    });
    const response = await transport('https://placeholder.invalid/responses', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(429);
    expect(credentials).toHaveBeenCalledTimes(1);
    expect(credentials).toHaveBeenCalledWith(false);
  });

  it('uses the signed relay for the owner without loading local Codex credentials', async () => {
    const credentials = vi.fn();
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const transport = createCodexSubscriptionFetch({
      projectId: 'private-project',
      userId: 'owner-id',
      relayUrl: 'https://relay.example.test/codex/',
      relaySecret: 'relay-secret',
      credentials,
      fetch: fetchImpl,
    });
    const payload = JSON.stringify({ model: 'gpt-5.6-terra', input: 'hello' });
    const response = await transport('https://placeholder.invalid/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer placeholder' },
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(credentials).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.url).toBe('https://relay.example.test/codex/v1/responses');
    expect(request.headers.get('authorization')).toBeNull();
    expect(request.headers.get(CODEX_RELAY_HEADERS.userId)).toBe('owner-id');
    expect(request.headers.get(CODEX_RELAY_HEADERS.sessionId)).toMatch(/^makaron-[a-f0-9]{40}$/);
    const timestamp = request.headers.get(CODEX_RELAY_HEADERS.timestamp)!;
    const requestId = request.headers.get(CODEX_RELAY_HEADERS.requestId)!;
    expect(request.headers.get(CODEX_RELAY_HEADERS.signature)).toBe(createCodexRelaySignature({
      method: 'POST',
      pathname: '/codex/v1/responses',
      timestamp,
      requestId,
      userId: 'owner-id',
      body: payload,
      secret: 'relay-secret',
    }));
  });

  it('reads sanitized subscription usage through the signed relay', async () => {
    let receivedRequest: Request | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      receivedRequest = new Request(input, init);
      return new Response(JSON.stringify({
        planType: 'pro',
        weekly: {
          usedPercent: 12,
          remainingPercent: 88,
          windowDurationMins: 10_080,
          resetsAt: 1_788_452_789,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await expect(getCodexSubscriptionUsage('owner-id', {
      relayUrl: 'https://relay.example.test/',
      relaySecret: 'relay-secret',
      fetch: fetchImpl,
    })).resolves.toMatchObject({ planType: 'pro', weekly: { remainingPercent: 88 } });
    expect(receivedRequest?.url).toBe('https://relay.example.test/v1/usage');
    expect(receivedRequest?.headers.get(CODEX_RELAY_HEADERS.userId)).toBe('owner-id');
  });

  it('fails closed when relay mode does not receive an authenticated user id', async () => {
    const transport = createCodexSubscriptionFetch({
      projectId: 'project',
      relayUrl: 'https://relay.example.test/',
      relaySecret: 'relay-secret',
      fetch: vi.fn(),
    });
    await expect(transport('https://placeholder.invalid/responses', {
      method: 'POST',
      body: '{}',
    })).rejects.toThrow('authenticated user id is required');
  });
});
