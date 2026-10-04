// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe.each(['codex', 'grok'] as const)('%s relay membership control over real HTTP', provider => {
  const prefix = provider.toUpperCase();
  let directory: string;
  let file: string;
  let server: Server;
  let baseUrl: string;
  let relay: any;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), `makaron-${provider}-allowlist-test-`));
    file = join(directory, 'allowed-users.json');
    vi.stubEnv(`${prefix}_SUBSCRIPTION_OWNER_USER_ID`, 'owner');
    vi.stubEnv(`${prefix}_SUBSCRIPTION_RELAY_SECRET`, 'test-only-secret');
    vi.stubEnv(`${prefix}_SUBSCRIPTION_ALLOWED_USER_IDS`, 'legacy-user');
    vi.stubEnv(`${prefix}_SUBSCRIPTION_ALLOWLIST_PATH`, file);
    const modulePath = `../services/${provider}-subscription-relay/server.mjs?allowlist-http-test`;
    relay = await import(modulePath);
    server = relay.createRelayServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    vi.unstubAllEnvs();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  async function request(method: 'GET' | 'POST', userId: string, payload?: unknown) {
    const pathname = '/v1/allowlist';
    const body = Buffer.from(payload === undefined ? '' : JSON.stringify(payload));
    const timestamp = Date.now().toString();
    const requestId = randomUUID();
    return fetch(`${baseUrl}${pathname}`, {
      method,
      ...(method === 'POST' ? { body } : {}),
      headers: {
        'x-makaron-relay-user-id': userId,
        'x-makaron-relay-timestamp': timestamp,
        'x-makaron-relay-request-id': requestId,
        'x-makaron-relay-signature': relay.createRelaySignature({
          method, pathname, userId, timestamp, requestId, body, secret: 'test-only-secret',
        }),
      },
    });
  }

  it('blocks unsigned callers and prevents ordinary members from managing the roster', async () => {
    expect((await fetch(`${baseUrl}/v1/allowlist`)).status).toBe(401);
    const member = await request('POST', 'legacy-user', { userIds: ['intruder'] });
    expect(member.status).toBe(403);
    expect(await member.json()).toMatchObject({ error: 'owner_required' });
    expect((await request('GET', 'legacy-user')).status).toBe(403);
  });

  it('lets the owner read, add, persist, and remove without any OAuth or upstream call', async () => {
    const before = await request('GET', 'owner');
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ userIds: ['legacy-user', 'owner'] });
    expect((await request('POST', 'owner', { userIds: ['shared-user'] })).status).toBe(200);
    expect(JSON.parse(readFileSync(file, 'utf8')).userIds).toEqual(['shared-user', 'owner']);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await (await request('GET', 'owner')).json()).toEqual({ userIds: ['shared-user', 'owner'] });
    expect((await request('GET', 'legacy-user')).status).toBe(403);
    expect((await request('POST', 'owner', { userIds: [] })).status).toBe(200);
    expect(await (await request('GET', 'owner')).json()).toEqual({ userIds: ['owner'] });
  });

  it('rejects invalid or oversized lists without modifying persisted membership', async () => {
    expect((await request('POST', 'owner', { userIds: ['owner', 123] })).status).toBe(400);
    expect((await request('POST', 'owner', {
      userIds: Array.from({ length: 101 }, (_, i) => `user-${i}`),
    })).status).toBe(400);
    expect(JSON.parse(readFileSync(file, 'utf8')).userIds).toEqual(['owner']);
  });
});
