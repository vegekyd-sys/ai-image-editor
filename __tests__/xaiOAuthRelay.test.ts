import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_SCOPE,
  authorizeXaiDevice,
  clearXaiOAuthCacheForTest,
  getValidXaiOAuthCredential,
  refreshXaiOAuthCredential,
} from '../services/grok-subscription-relay/xai-oauth.mjs'

const temporaryDirectories: string[] = []

function temporaryCredentialPath() {
  const directory = mkdtempSync(join(tmpdir(), 'makaron-xai-oauth-'))
  temporaryDirectories.push(directory)
  return join(directory, 'xai-oauth.json')
}

afterEach(() => {
  clearXaiOAuthCacheForTest()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('xAI device OAuth profile', () => {
  it('requests a device code, polls, and persists only the completed OAuth profile', async () => {
    const credentialPath = temporaryCredentialPath()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_authorization_endpoint: 'https://auth.x.ai/oauth2/device/code',
        token_endpoint: 'https://auth.x.ai/oauth2/token',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://accounts.x.ai/oauth2/device',
        verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
        expires_in: 300,
        interval: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      }), { status: 200 }))
    const onCode = vi.fn()

    await expect(authorizeXaiDevice({
      credentialPath,
      fetchImpl: fetchMock,
      delayImpl: vi.fn().mockResolvedValue(undefined),
      onCode,
    })).resolves.toMatchObject({
      type: 'oauth',
      provider: 'xai',
      access: 'access-token',
      refresh: 'refresh-token',
      authFlow: 'device-code',
    })

    expect(onCode).toHaveBeenCalledWith(expect.objectContaining({
      userCode: 'ABCD-EFGH',
      verificationUriComplete: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
    }))
    const requestBody = String(fetchMock.mock.calls[1][1]?.body)
    expect(requestBody).toContain(`client_id=${XAI_OAUTH_CLIENT_ID}`)
    expect(new URLSearchParams(requestBody).get('scope')).toBe(XAI_OAUTH_SCOPE)
    const stored = JSON.parse(readFileSync(credentialPath, 'utf8'))
    expect(stored).toMatchObject({ access: 'access-token', refresh: 'refresh-token' })
  })

  it('rotates a refresh token and keeps the old token only when xAI omits a replacement', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-next',
      refresh_token: 'refresh-next',
      expires_in: 3600,
    }), { status: 200 }))

    await expect(refreshXaiOAuthCredential({
      type: 'oauth',
      provider: 'xai',
      access: 'access-old',
      refresh: 'refresh-old',
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    }, { fetchImpl: fetchMock })).resolves.toMatchObject({
      access: 'access-next',
      refresh: 'refresh-next',
    })
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('grant_type=refresh_token')
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('refresh_token=refresh-old')
  })

  it('refreshes an expired stored profile before returning it', async () => {
    const credentialPath = temporaryCredentialPath()
    const stored = {
      type: 'oauth',
      provider: 'xai',
      access: 'expired-access',
      refresh: 'refresh-old',
      expires: Date.now() - 1,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    }
    writeFileSync(credentialPath, JSON.stringify(stored), { mode: 0o600 })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'fresh-access',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
    }), { status: 200 }))

    await expect(getValidXaiOAuthCredential({ credentialPath, fetchImpl: fetchMock }))
      .resolves.toMatchObject({ access: 'fresh-access', refresh: 'fresh-refresh' })
    expect(JSON.parse(readFileSync(credentialPath, 'utf8'))).toMatchObject({ access: 'fresh-access' })
  })
})
