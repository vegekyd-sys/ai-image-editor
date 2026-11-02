import { getVercelOidcToken } from '@vercel/oidc';

let cachedIdentity: { key: string; token: string; expiresAt: number } | undefined;

/** Short-lived Cloud Run IAM identity. Never persist account credentials on V. */
export async function getGeminiCloudIdentity(signal: AbortSignal): Promise<string> {
  const audience = process.env.GEMINI_RELAY_CLOUD_URL?.trim();
  const provider = process.env.GEMINI_RELAY_WIF_PROVIDER?.trim();
  const account = process.env.GEMINI_RELAY_SERVICE_ACCOUNT?.trim();
  if (!audience || !provider || !account
      || !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/.test(audience)
      || !/^\/\/iam.googleapis.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[\w-]+\/providers\/[\w-]+$/.test(provider)
      || !/^[\w-]+@[\w-]+\.iam\.gserviceaccount\.com$/.test(account)) {
    throw new Error('Google cloud identity is not configured');
  }
  signal.throwIfAborted();
  const cacheKey = JSON.stringify([audience, provider, account]);
  if (cachedIdentity?.key === cacheKey && cachedIdentity.expiresAt > Date.now()) return cachedIdentity.token;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  const oidc = await getVercelOidcToken();
  const exchange = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', signal: bounded, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audience: provider, grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken: oidc,
      scope: 'https://www.googleapis.com/auth/cloud-platform' }),
  });
  if (!exchange.ok) throw new Error('Google identity exchange unavailable');
  const { access_token: accessToken } = await exchange.json();
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google identity exchange unavailable');
  const identity = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateIdToken`, {
    method: 'POST', signal: bounded,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ audience, includeEmail: true }),
  });
  if (!identity.ok) throw new Error('Google cloud authorization unavailable');
  const { token } = await identity.json();
  if (typeof token !== 'string' || !token) throw new Error('Google cloud authorization unavailable');
  // Cache only a trusted IAM response with the exact audience and a usable
  // expiry. Machine identity caching never caches caller membership/role checks.
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const expiresAt = Math.min(Date.now()+300000, claims.exp*1000-60000);
    if (claims.aud === audience && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      cachedIdentity = { key: cacheKey, token, expiresAt };
    }
  } catch { /* Unreadable identities are returned without being cached. */ }
  return token;
}
