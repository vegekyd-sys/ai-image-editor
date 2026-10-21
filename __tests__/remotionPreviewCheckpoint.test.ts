// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({objects:new Map<string,string>(),download:vi.fn(),upload:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseAdmin:()=>({storage:{from:()=>({download:state.download,upload:state.upload})}})}));
import{readPreviewCheckpoint,writePreviewCheckpoint}from'@/lib/remotion-preview-checkpoint';
const key='media:'+'a'.repeat(64);
beforeEach(()=>{
  state.objects.clear();vi.clearAllMocks();vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_DEPLOYMENT_ID','dpl-A');
  state.upload.mockImplementation(async(path:string,content:string)=>{state.objects.set(path,content);return{error:null};});
  state.download.mockImplementation(async(path:string)=>state.objects.has(path)?{data:new Blob([state.objects.get(path)!]),error:null}:{data:null,error:{status:404,message:'not found'}});
});
afterEach(()=>vi.unstubAllEnvs());
describe('shared preview checkpoint pointers',()=>{
  it('recovers from private storage without any process-local pointer and isolates deployments',async()=>{
    const pointer={version:1 as const,key,snapshotId:'snap_test123',expiresAt:Date.now()+86400_000,sizeBytes:1024};
    await writePreviewCheckpoint(pointer);expect(await readPreviewCheckpoint(key)).toEqual(pointer);
    vi.stubEnv('VERCEL_DEPLOYMENT_ID','dpl-B');expect(await readPreviewCheckpoint(key)).toBeUndefined();
    vi.stubEnv('VERCEL_DEPLOYMENT_ID','dpl-A');expect(await readPreviewCheckpoint('media:'+'b'.repeat(64))).toBeUndefined();
  });
  it('does not restore expired or substituted cache pointers',async()=>{
    await writePreviewCheckpoint({version:1,key,snapshotId:'snap_old',expiresAt:Date.now()-1,sizeBytes:1});expect(await readPreviewCheckpoint(key)).toBeUndefined();
    const path=[...state.objects.keys()][0];state.objects.set(path,JSON.stringify({version:1,key:'media:'+'b'.repeat(64),snapshotId:'snap_wrong',expiresAt:Date.now()+86400_000,sizeBytes:1}));expect(await readPreviewCheckpoint(key)).toBeUndefined();
  });
});
