import { afterAll, describe, expect, it } from 'vitest'

const previousSecret = process.env.GROK_SUBSCRIPTION_RELAY_SECRET
const previousOwner = process.env.GROK_SUBSCRIPTION_OWNER_USER_ID
const previousAllowed = process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS
process.env.GROK_SUBSCRIPTION_RELAY_SECRET = 'relay-secret'
process.env.GROK_SUBSCRIPTION_OWNER_USER_ID = 'owner-id'
process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS = 'test-user-id'

const relayModulePath = '../services/grok-subscription-relay/server.mjs?relay-auth-test'
const {
  buildGrokAgentHeaders,
  createRelaySignature,
  normalizeGrokUsage,
  verifyRelayRequest,
} = await import(relayModulePath)

afterAll(() => {
  if (previousSecret === undefined) delete process.env.GROK_SUBSCRIPTION_RELAY_SECRET
  else process.env.GROK_SUBSCRIPTION_RELAY_SECRET = previousSecret
  if (previousOwner === undefined) delete process.env.GROK_SUBSCRIPTION_OWNER_USER_ID
  else process.env.GROK_SUBSCRIPTION_OWNER_USER_ID = previousOwner
  if (previousAllowed === undefined) delete process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS
  else process.env.GROK_SUBSCRIPTION_ALLOWED_USER_IDS = previousAllowed
})

function signedRequest(overrides: { userId?: string; signature?: string } = {}) {
  const body = Buffer.from('{"model":"grok-imagine-video-1.5"}')
  const timestamp = Date.now().toString()
  const requestId = `request-${Math.random()}`
  const userId = overrides.userId ?? 'owner-id'
  const signature = createRelaySignature({
    method: 'POST',
    pathname: '/v1/videos/generations',
    timestamp,
    requestId,
    userId,
    body,
    secret: 'relay-secret',
  })
  return {
    method: 'POST',
    pathname: '/v1/videos/generations',
    body,
    headers: {
      'x-makaron-relay-timestamp': timestamp,
      'x-makaron-relay-request-id': requestId,
      'x-makaron-relay-user-id': userId,
      'x-makaron-relay-signature': overrides.signature ?? signature,
    },
  }
}

describe('Grok subscription relay boundary', () => {
  it('builds the official Grok Build headless headers without exposing them to clients', () => {
    expect(buildGrokAgentHeaders('oauth-access-token')).toMatchObject({
      authorization: 'Bearer oauth-access-token',
      'x-xai-token-auth': 'xai-grok-cli',
      'x-grok-model-override': 'grok-4.6',
      'x-grok-client-identifier': 'grok-shell',
      'x-grok-client-mode': 'headless',
    })
  })

  it('accepts only correctly signed allowlisted requests', () => {
    expect(verifyRelayRequest(signedRequest())).toMatchObject({ ok: true, userId: 'owner-id' })
    expect(verifyRelayRequest(signedRequest({ userId: 'test-user-id' })))
      .toMatchObject({ ok: true, userId: 'test-user-id' })
    expect(verifyRelayRequest(signedRequest({ userId: 'other-user' })))
      .toMatchObject({ ok: false, status: 403, error: 'not_allowlisted' })
    expect(verifyRelayRequest(signedRequest({ signature: '0'.repeat(64) })))
      .toMatchObject({ ok: false, status: 401, error: 'invalid_signature' })
  })

  it('rejects stale and replayed requests', () => {
    const stale = signedRequest()
    expect(verifyRelayRequest({ ...stale, now: Date.now() + 61_000 }))
      .toMatchObject({ ok: false, status: 401, error: 'stale_signature' })

    const replayed = signedRequest()
    expect(verifyRelayRequest(replayed)).toMatchObject({ ok: true })
    expect(verifyRelayRequest(replayed))
      .toMatchObject({ ok: false, status: 409, error: 'replayed_request' })
  })

  it('normalizes official Grok billing percentages without exposing billing details', () => {
    expect(normalizeGrokUsage({
      subscriptionTier: 'SuperGrok Heavy',
      config: {
        creditUsagePercent: 37.5,
        currentPeriod: {
          type: 'monthly',
          start: '2026-08-01T00:00:00.000Z',
          end: '2026-09-01T00:00:00.000Z',
        },
        privateBillingField: 'not-for-clients',
      },
    })).toEqual({
      available: true,
      planType: 'SuperGrok Heavy',
      usage: {
        usedPercent: 37.5,
        remainingPercent: 62.5,
        windowDurationMins: 44_640,
        resetsAt: 1_788_220_800,
        periodType: 'monthly',
      },
    })
  })
})
