// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const oidc=vi.hoisted(()=>vi.fn());
vi.mock('@vercel/oidc',()=>({getVercelOidcToken:oidc}));
let getGeminiCloudIdentity: typeof import('@/lib/google-relay-identity').getGeminiCloudIdentity;
beforeEach(async()=>{
 vi.resetModules();
 ({getGeminiCloudIdentity}=await import('@/lib/google-relay-identity'));
 vi.stubEnv('GEMINI_RELAY_CLOUD_URL','https://private-worker.a.run.app');
 vi.stubEnv('GEMINI_RELAY_WIF_PROVIDER','//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/makaron/providers/vercel');
 vi.stubEnv('GEMINI_RELAY_SERVICE_ACCOUNT','makaron@project.iam.gserviceaccount.com');oidc.mockResolvedValue('request-bound-oidc');
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();vi.useRealTimers();});
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

describe('machine identity reuse preserves caller authorization boundaries',()=>{
 it('reuses a valid audience-bound token, then refreshes at the bounded cache expiry',async()=>{
  vi.useFakeTimers();
  const token='header.'+Buffer.from(JSON.stringify({aud:'https://private-worker.a.run.app',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
  const f=vi.fn().mockResolvedValueOnce(Response.json({access_token:'one'})).mockResolvedValueOnce(Response.json({token}))
    .mockResolvedValueOnce(Response.json({access_token:'two'})).mockResolvedValueOnce(Response.json({token}));vi.stubGlobal('fetch',f);
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe(token);
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe(token);expect(f).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(300001);
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe(token);expect(f).toHaveBeenCalledTimes(4);
 });
 it('never reuses a token for another audience or service account',async()=>{
  const token='header.'+Buffer.from(JSON.stringify({aud:'https://private-worker.a.run.app',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
  const f=vi.fn().mockResolvedValueOnce(Response.json({access_token:'one'})).mockResolvedValueOnce(Response.json({token}))
    .mockResolvedValueOnce(Response.json({access_token:'two'})).mockResolvedValueOnce(Response.json({token:'new-account-identity'}));vi.stubGlobal('fetch',f);
  await getGeminiCloudIdentity(AbortSignal.timeout(5000));
  vi.stubEnv('GEMINI_RELAY_SERVICE_ACCOUNT','another@project.iam.gserviceaccount.com');
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe('new-account-identity');expect(f).toHaveBeenCalledTimes(4);
 });
 it('refreshes before the actual JWT expires, even within the five-minute cap',async()=>{
  vi.useFakeTimers();
  const token='header.'+Buffer.from(JSON.stringify({aud:'https://private-worker.a.run.app',exp:Math.floor(Date.now()/1000)+70})).toString('base64url')+'.signature';
  const f=vi.fn().mockResolvedValueOnce(Response.json({access_token:'one'})).mockResolvedValueOnce(Response.json({token}))
    .mockResolvedValueOnce(Response.json({access_token:'two'})).mockResolvedValueOnce(Response.json({token:'refreshed'}));vi.stubGlobal('fetch',f);
  await getGeminiCloudIdentity(AbortSignal.timeout(5000));
  await vi.advanceTimersByTimeAsync(11000);
  expect(await getGeminiCloudIdentity(AbortSignal.timeout(5000))).toBe('refreshed');expect(f).toHaveBeenCalledTimes(4);
 });
 it('does not satisfy an aborted call from cache',async()=>{
  const token='header.'+Buffer.from(JSON.stringify({aud:'https://private-worker.a.run.app',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.signature';
  const f=vi.fn().mockResolvedValueOnce(Response.json({access_token:'one'})).mockResolvedValueOnce(Response.json({token}));vi.stubGlobal('fetch',f);
  await getGeminiCloudIdentity(AbortSignal.timeout(5000));
  const c=new AbortController();c.abort();
  await expect(getGeminiCloudIdentity(c.signal)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(2);expect(oidc).toHaveBeenCalledOnce();
 });
});
