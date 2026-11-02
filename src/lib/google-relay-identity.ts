import { getVercelOidcToken } from '@vercel/oidc';

/** Short-lived Cloud Run IAM identity. Never persist account credentials on V. */
export async function getGeminiCloudIdentity(signal: AbortSignal): Promise<string> {
  const audience = process.env.GEMINI_RELAY_CLOUD_URL?.trim();
  const provider = process.env.GEMINI_RELAY_WIF_PROVIDER?.trim();
  const account = process.env.GEMINI_RELAY_SERVICE_ACCOUNT?.trim();
  if (!audience || !provider || !account
      || !/^https:\/\/[a-z0-9-]+\.a\.run\.app$/.test(audience)
      || !/^\/\/iam.googleapis.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[\w-]+\/providers\/[\w-]+$/.test(provider)
      || !/^[\w-]+@[\w-]+\.iam\.gserviceaccount\.com$/.test(account)) {
    throw new Error('Google cloud identity is not configured');
  }
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
  return token;
}
