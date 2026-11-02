// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const oidc=vi.hoisted(()=>vi.fn());
vi.mock('@vercel/oidc',()=>({getVercelOidcToken:oidc}));
import { getGeminiCloudIdentity } from '@/lib/google-relay-identity';
beforeEach(()=>{
 vi.stubEnv('GEMINI_RELAY_CLOUD_URL','https://private-worker.a.run.app');
 vi.stubEnv('GEMINI_RELAY_WIF_PROVIDER','//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/makaron/providers/vercel');
 vi.stubEnv('GEMINI_RELAY_SERVICE_ACCOUNT','makaron@project.iam.gserviceaccount.com');oidc.mockResolvedValue('request-bound-oidc');
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
describe('short-lived Cloud IAM identities',()=>{
 it('exchanges the request OIDC for an audience-bound IAM identity without storing credentials',async()=>{
  const f=vi.fn().mockResolvedValueOnce(Response.json({access_token:'ephemeral-access'})).mockResolvedValueOnce(Response.json({token:'ephemeral-identity'}));vi.stubGlobal('fetch',f);
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe('ephemeral-identity');
  expect(f.mock.calls[0][0]).toBe('https://sts.googleapis.com/v1/token');
  expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({subjectToken:'request-bound-oidc',audience:process.env.GEMINI_RELAY_WIF_PROVIDER});
  expect(f.mock.calls[1][1].headers.authorization).toBe('Bearer ephemeral-access');
  expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({audience:'https://private-worker.a.run.app',includeEmail:true});
 });
 it('accepts the current service-number/region Cloud Run URL format',async()=>{
  vi.stubEnv('GEMINI_RELAY_CLOUD_URL','https://private-worker-123.asia-east1.run.app');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({access_token:'ephemeral'})).mockResolvedValueOnce(Response.json({token:'identity'})));
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe('identity');
 });
 it('never asks IAM for a token after federation rejects the request',async()=>{
  const f=vi.fn().mockResolvedValue(Response.json({error:'denied'},{status:403}));vi.stubGlobal('fetch',f);
  await expect(getGeminiCloudIdentity(AbortSignal.timeout(5000))).rejects.toThrow('exchange unavailable');expect(f).toHaveBeenCalledOnce();
 });
 it('rejects an arbitrary cloud target before exposing OIDC',async()=>{
  vi.stubEnv('GEMINI_RELAY_CLOUD_URL','https://untrusted.test');vi.stubGlobal('fetch',vi.fn());
  await expect(getGeminiCloudIdentity(AbortSignal.timeout(5000))).rejects.toThrow('not configured');expect(oidc).not.toHaveBeenCalled();
 });
});
