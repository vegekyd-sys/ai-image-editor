// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),members:vi.fn()}));
vi.mock('@/lib/admin',()=>({isAdmin:mocks.admin}));
vi.mock('@/lib/codex-subscription-allowlist',()=>({getDynamicCodexSubscriptionAllowedUserIds:mocks.members}));
import { POST } from '@/app/api/internal/google-relay-authorize/route';
import { canonicalVideoRelayJson } from '@/lib/gemini-video-subscription';
const secret='test-secret-32-characters-long-private';
function request(input={user_id:'admin',job_id:'12345678-abcd-4321-abcd-123456789012',request_sha256:'a'.repeat(64)},stamp=String(Math.floor(Date.now()/1000)),signature?:string){
 const raw=canonicalVideoRelayJson(input);
 const sig=signature??createHmac('sha256',secret).update(`makaron-job-authorization\n${stamp}\n${raw}`).digest('hex');
 return new Request('https://candidate.test/api/internal/google-relay-authorize',{method:'POST',body:raw,
 headers:{'x-makaron-authorization-timestamp':stamp,'x-makaron-authorization-signature':sig}});
}
beforeEach(()=>{vi.stubEnv('GEMINI_VIDEO_RELAY_ENABLED','true');vi.stubEnv('GEMINI_VIDEO_RELAY_URL','https://relay.test');
 vi.stubEnv('GEMINI_VIDEO_RELAY_SECRET',secret);vi.stubEnv('GEMINI_VIDEO_RELAY_OWNER_ID','owner');mocks.admin.mockResolvedValue(true);mocks.members.mockResolvedValue(['admin']);});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('fresh server-owned job authorization',()=>{
 it('returns only job binding and permission, with no roster or personal data',async()=>{
   expect(await (await POST(request())).json()).toEqual({allowed:true,job_id:'12345678-abcd-4321-abcd-123456789012',request_sha256:'a'.repeat(64)});
 });
 it('requires both membership and the current role on every call',async()=>{
   mocks.admin.mockResolvedValueOnce(false);expect((await (await POST(request())).json()).allowed).toBe(false);
   mocks.members.mockResolvedValueOnce([]);expect((await (await POST(request())).json()).allowed).toBe(false);
   expect((await (await POST(request())).json()).allowed).toBe(true);
 });
 it('rejects forged or expired signatures before looking up any identity',async()=>{
   expect((await POST(request(undefined,undefined,'0'.repeat(64)))).status).toBe(403);
   expect((await POST(request(undefined,String(Math.floor(Date.now()/1000)-31)))).status).toBe(403);
   expect(mocks.admin).not.toHaveBeenCalled();
 });
 it('fails closed on unavailable membership and when disabled',async()=>{
   mocks.members.mockRejectedValueOnce(new Error('unavailable'));expect((await POST(request())).status).toBe(503);
   vi.stubEnv('GEMINI_VIDEO_RELAY_ENABLED','false');expect((await POST(request())).status).toBe(403);
 });
});
