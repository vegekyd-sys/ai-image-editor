import { afterAll, describe, expect, it } from 'vitest';

const previousSecret = process.env.CODEX_SUBSCRIPTION_RELAY_SECRET;
const previousOwner = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
const previousAllowed = process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS;
process.env.CODEX_SUBSCRIPTION_RELAY_SECRET = 'relay-secret';
process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = 'owner-id';
process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = 'test-user-id,second-test-id';

// The relay deliberately stays a standalone Node service without joining the
// Next.js TypeScript bundle. Keeping the path dynamic avoids coupling tsc to it.
const relayModulePath = '../services/codex-subscription-relay/server.mjs?relay-auth-test';
const { createRelaySignature, verifyRelayRequest } = await import(relayModulePath);

afterAll(() => {
  if (previousSecret === undefined) delete process.env.CODEX_SUBSCRIPTION_RELAY_SECRET;
  else process.env.CODEX_SUBSCRIPTION_RELAY_SECRET = previousSecret;
  if (previousOwner === undefined) delete process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
  else process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = previousOwner;
  if (previousAllowed === undefined) delete process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS;
  else process.env.CODEX_SUBSCRIPTION_ALLOWED_USER_IDS = previousAllowed;
});

function signedRequest(overrides: { userId?: string; signature?: string } = {}) {
  const body = Buffer.from('{"input":"hello"}');
  const timestamp = Date.now().toString();
  const requestId = `request-${Math.random()}`;
  const userId = overrides.userId ?? 'owner-id';
  const signature = createRelaySignature({
    method: 'POST',
    pathname: '/v1/responses',
    timestamp,
    requestId,
    userId,
    body,
    secret: 'relay-secret',
  });
  return {
    method: 'POST',
    pathname: '/v1/responses',
    body,
    headers: {
      'x-makaron-relay-timestamp': timestamp,
      'x-makaron-relay-request-id': requestId,
      'x-makaron-relay-user-id': userId,
      'x-makaron-relay-signature': overrides.signature ?? signature,
    },
  };
}

describe('Codex subscription relay boundary', () => {
  it('accepts correctly signed owner and allowlisted test-account requests', () => {
    expect(verifyRelayRequest(signedRequest())).toMatchObject({ ok: true, userId: 'owner-id' });
    expect(verifyRelayRequest(signedRequest({ userId: 'test-user-id' })))
      .toMatchObject({ ok: true, userId: 'test-user-id' });
    expect(verifyRelayRequest(signedRequest({ userId: 'second-test-id' })))
      .toMatchObject({ ok: true, userId: 'second-test-id' });
  });

  it('rejects non-owner, tampered, stale, and replayed requests', () => {
    expect(verifyRelayRequest(signedRequest({ userId: 'other-user' })))
      .toMatchObject({ ok: false, status: 403, error: 'not_allowlisted' });
    expect(verifyRelayRequest(signedRequest({ signature: '0'.repeat(64) })))
      .toMatchObject({ ok: false, status: 401, error: 'invalid_signature' });

    const stale = signedRequest();
    expect(verifyRelayRequest({ ...stale, now: Date.now() + 61_000 }))
      .toMatchObject({ ok: false, status: 401, error: 'stale_signature' });

    const replayed = signedRequest();
    expect(verifyRelayRequest(replayed)).toMatchObject({ ok: true });
    expect(verifyRelayRequest(replayed))
      .toMatchObject({ ok: false, status: 409, error: 'replayed_request' });
  });
});
