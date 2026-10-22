// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({row:null as any,create:vi.fn(),status:vi.fn(),google:vi.fn(),assemble:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({getSupabaseAdmin:()=>({from:()=>{
 const q:any={select:()=>q,eq:()=>q,or:()=>q,maybeSingle:async()=>({data:state.row,error:null}),insert:async(x:any)=>{state.row={...x};return{error:null}},update:(x:any)=>{Object.assign(state.row,x);return q}};return q
},storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:(p:string)=>({data:{publicUrl:'https://cdn.makaron.app/'+p}})})}})}))
vi.mock('@/lib/provider-image-preflight',()=>({readProviderImage:async()=>Buffer.from('source')}))
vi.mock('@/lib/skills/create-video',()=>({createVideo:(x:unknown)=>state.create(x)}))
vi.mock('@/lib/skills/get-video-status',()=>({getVideoStatus:(x:unknown)=>state.status(x)}))
vi.mock('@/lib/google-omni-video',()=>({fetchGoogleOmniVideoBytes:(x:unknown)=>state.google(x)}))
vi.mock('@/lib/video-retake-media',()=>({inspectRetakeSource:async()=>({width:1280,height:720,fps:24,duration:6}),extractRetakeContext:async()=>Buffer.from('context'),extractRetakeBoundaryFrames:vi.fn(),assembleRetake:(...x:unknown[])=>state.assemble(...x),RetakeDeliveryError:class extends Error{}}))
vi.mock('@/lib/billing/mcp-video',()=>({settleMcpVideoStatus:vi.fn()}))
import {createVideoRetake,advanceVideoRetake} from '@/lib/video-retake'
const base={userId:'owner',script:'Make the book red',images:[],videoUrl:'https://cdn.makaron.app/source.mp4',billingRequestId:'0e532fce-b833-4163-a545-5dc549991a86',retake:{start:2,end:4}}
beforeEach(()=>{state.row=null;vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://cdn.makaron.app')})
it('persists and resumes synchronous Omni output without re-querying or regenerating it',async()=>{
 const url='https://generativelanguage.googleapis.com/v1beta/files/result';state.create.mockResolvedValue({success:true,status:'completed',taskId:'google-omni-receipt',videoUrl:url});state.google.mockResolvedValue(Buffer.from('patch'));state.assemble.mockResolvedValue({bytes:Buffer.from('complete'),meta:{duration:6}})
 const result=await createVideoRetake({...base,videoModel:'google-omni'});expect(result).toMatchObject({success:true});expect(state.row).toMatchObject({stage:'saving_patch',provider_task_id:'google-omni-receipt',patch_url:url});expect(state.create).toHaveBeenCalledWith(expect.objectContaining({videoOperation:'edit',videoModel:'google-omni'}))
 const delivered=await advanceVideoRetake(result.taskId!,'owner');expect(delivered).toMatchObject({success:true,status:'completed'});expect(state.google).toHaveBeenCalledWith(url);expect(state.status).not.toHaveBeenCalled();expect(state.create).toHaveBeenCalledTimes(1)
})
it('rejects unsupported Grok creative references and exact endpoint controls before submitting',async()=>{
 expect(await createVideoRetake({...base,videoModel:'grok',images:['https://example.com/ref.jpg']})).toMatchObject({success:false});expect(state.create).not.toHaveBeenCalled();
 expect(await createVideoRetake({...base,videoModel:'grok',retake:{...base.retake,endFrame:{imageUrl:'https://example.com/end.jpg'}}})).toMatchObject({success:false});expect(state.create).not.toHaveBeenCalled()
})
