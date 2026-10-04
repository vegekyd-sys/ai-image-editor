import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_DEVICE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;
const FETCH_TIMEOUT_MS = 30_000;
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const USER_AGENT = 'makaron-grok-relay/0.1';

let cachedCredential;
let refreshInFlight;

export function getCredentialPath() {
  return process.env.GROK_SUBSCRIPTION_OAUTH_PATH?.trim()
    || '/srv/vlab/makaron-grok-relay/state/xai-oauth.json';
}

function trustedXaiUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.hostname !== 'x.ai' && !url.hostname.endsWith('.x.ai'))) {
    throw new Error(`xAI OAuth discovery returned untrusted ${label}`);
  }
  return url.toString();
}

function formBody(value) {
  return new URLSearchParams(value).toString();
}

async function readJson(response, context) {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (!response.ok) {
    const detail = typeof value?.error_description === 'string'
      ? value.error_description
      : typeof value?.error === 'string' ? value.error : undefined;
    throw Object.assign(
      new Error(`${context} failed (${response.status})${detail ? `: ${detail}` : ''}`),
      { status: response.status, oauthError: value?.error },
    );
  }
  return value;
}

async function oauthFetch(url, init = {}, fetchImpl = fetch) {
  return fetchImpl(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export async function discoverXaiOAuth(fetchImpl = fetch) {
  const response = await oauthFetch(XAI_OAUTH_DISCOVERY_URL, {}, fetchImpl);
  const value = await readJson(response, 'xAI OAuth discovery');
  if (typeof value?.device_authorization_endpoint !== 'string' || typeof value?.token_endpoint !== 'string') {
    throw new Error('xAI OAuth discovery response is missing device-code endpoints');
  }
  return {
    deviceAuthorizationEndpoint: trustedXaiUrl(value.device_authorization_endpoint, 'device authorization endpoint'),
    tokenEndpoint: trustedXaiUrl(value.token_endpoint, 'token endpoint'),
  };
}

export async function requestXaiDeviceCode(options = {}) {
  const discovery = options.discovery || await discoverXaiOAuth(options.fetchImpl);
  const response = await oauthFetch(discovery.deviceAuthorizationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: XAI_OAUTH_CLIENT_ID, scope: XAI_OAUTH_SCOPE }),
  }, options.fetchImpl);
  const value = await readJson(response, 'xAI device-code request');
  if (typeof value?.device_code !== 'string' || typeof value?.user_code !== 'string'
    || typeof value?.verification_uri !== 'string') {
    throw new Error('xAI device-code response is incomplete');
  }
  return {
    deviceCode: value.device_code,
    userCode: value.user_code,
    verificationUri: trustedXaiUrl(value.verification_uri, 'verification URI'),
    verificationUriComplete: typeof value.verification_uri_complete === 'string'
      ? trustedXaiUrl(value.verification_uri_complete, 'complete verification URI')
      : undefined,
    expiresInMs: Number.isFinite(Number(value.expires_in))
      ? Math.max(1, Number(value.expires_in)) * 1000
      : DEFAULT_DEVICE_TIMEOUT_MS,
    intervalMs: Number.isFinite(Number(value.interval))
      ? Math.max(1, Number(value.interval)) * 1000
      : DEFAULT_POLL_INTERVAL_MS,
    ...discovery,
  };
}

function decodeJwtClaims(token) {
  try {
    const payload = token?.split('.')?.[1];
    return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : {};
  } catch {
    return {};
  }
}

function normalizeTokenResponse(value, currentRefresh) {
  if (typeof value?.access_token !== 'string' || !value.access_token) {
    throw new Error('xAI OAuth token response is missing access_token');
  }
  const refresh = typeof value.refresh_token === 'string' && value.refresh_token
    ? value.refresh_token
    : currentRefresh;
  if (!refresh) throw new Error('xAI OAuth token response is missing refresh_token');
  const claims = decodeJwtClaims(value.id_token || value.access_token);
  const jwtExpiry = Number.isFinite(Number(decodeJwtClaims(value.access_token).exp))
    ? Number(decodeJwtClaims(value.access_token).exp) * 1000
    : undefined;
  const expires = Number.isFinite(Number(value.expires_in))
    ? Date.now() + Math.max(1, Number(value.expires_in)) * 1000
    : jwtExpiry;
  return {
    type: 'oauth',
    provider: 'xai',
    access: value.access_token,
    refresh,
    ...(expires ? { expires } : {}),
    ...(typeof value.id_token === 'string' ? { idToken: value.id_token } : {}),
    ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    ...(typeof claims.sub === 'string' ? { accountId: claims.sub } : {}),
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function pollXaiDeviceCode(device, options = {}) {
  const deadline = Date.now() + device.expiresInMs;
  let intervalMs = Math.max(MIN_POLL_INTERVAL_MS, device.intervalMs);
  while (Date.now() < deadline) {
    const response = await oauthFetch(device.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: DEVICE_GRANT_TYPE,
        client_id: XAI_OAUTH_CLIENT_ID,
        device_code: device.deviceCode,
      }),
    }, options.fetchImpl);
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { value = {}; }
    if (response.ok) {
      return {
        ...normalizeTokenResponse(value),
        tokenEndpoint: device.tokenEndpoint,
        deviceAuthorizationEndpoint: device.deviceAuthorizationEndpoint,
        issuer: XAI_OAUTH_ISSUER,
        scope: XAI_OAUTH_SCOPE,
        authFlow: 'device-code',
        authorizedAt: new Date().toISOString(),
      };
    }
    if (value?.error === 'authorization_pending') {
      await (options.delayImpl || delay)(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (value?.error === 'slow_down') {
      intervalMs += SLOW_DOWN_INCREMENT_MS;
      await (options.delayImpl || delay)(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (value?.error === 'access_denied' || value?.error === 'authorization_denied') {
      throw new Error('xAI device authorization was denied');
    }
    if (value?.error === 'expired_token') throw new Error('xAI device code expired');
    throw new Error(`xAI device token exchange failed (${response.status})${value?.error ? `: ${value.error}` : ''}`);
  }
  throw new Error('xAI device authorization timed out');
}

export function writeXaiOAuthCredential(credential, credentialPath = getCredentialPath()) {
  mkdirSync(dirname(credentialPath), { recursive: true, mode: 0o700 });
  const temporaryPath = resolve(dirname(credentialPath), `.xai-oauth-${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, credentialPath);
  chmodSync(credentialPath, 0o600);
  cachedCredential = credential;
}

export function readXaiOAuthCredential(credentialPath = getCredentialPath()) {
  if (cachedCredential && credentialPath === getCredentialPath()) return cachedCredential;
  const value = JSON.parse(readFileSync(credentialPath, 'utf8'));
  if (value?.type !== 'oauth' || value?.provider !== 'xai'
    || typeof value?.access !== 'string' || typeof value?.refresh !== 'string') {
    throw new Error('xAI OAuth credential file is invalid');
  }
  if (credentialPath === getCredentialPath()) cachedCredential = value;
  return value;
}

export async function refreshXaiOAuthCredential(credential, options = {}) {
  const discovery = credential.tokenEndpoint
    ? { tokenEndpoint: trustedXaiUrl(credential.tokenEndpoint, 'token endpoint') }
    : await discoverXaiOAuth(options.fetchImpl);
  const response = await oauthFetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      grant_type: 'refresh_token',
      client_id: XAI_OAUTH_CLIENT_ID,
      refresh_token: credential.refresh,
    }),
  }, options.fetchImpl);
  const value = await readJson(response, 'xAI OAuth refresh');
  return {
    ...credential,
    ...normalizeTokenResponse(value, credential.refresh),
    tokenEndpoint: discovery.tokenEndpoint,
    refreshedAt: new Date().toISOString(),
  };
}

export async function getValidXaiOAuthCredential(options = {}) {
  const credentialPath = options.credentialPath || getCredentialPath();
  const credential = readXaiOAuthCredential(credentialPath);
  if (!options.forceRefresh && Number(credential.expires) - Date.now() > REFRESH_WINDOW_MS) {
    return credential;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshXaiOAuthCredential(credential, options)
      .then(next => {
        writeXaiOAuthCredential(next, credentialPath);
        return next;
      })
      .finally(() => { refreshInFlight = undefined; });
  }
  return refreshInFlight;
}

export async function authorizeXaiDevice(options = {}) {
  const device = await requestXaiDeviceCode(options);
  await options.onCode?.(device);
  const credential = await pollXaiDeviceCode(device, options);
  writeXaiOAuthCredential(credential, options.credentialPath || getCredentialPath());
  return credential;
}

export function clearXaiOAuthCacheForTest() {
  cachedCredential = undefined;
  refreshInFlight = undefined;
}
