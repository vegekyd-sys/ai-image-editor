// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
const stubs=vi.hoisted(()=>({jobs:[] as any[],provider:vi.fn(),meta:vi.fn()}));
vi.mock('@/lib/skills/create-video',()=>({createVideo:stubs.provider}));
vi.mock('@/lib/provider-image-preflight',()=>({readProviderImage:async()=>Buffer.from('source')}));
vi.mock('@/lib/video-retake-media',()=>({inspectRetakeSource:async()=>({duration:30.05,fps:30,width:1280,height:720}),extractRetakeContext:async()=>Buffer.from('context'),extractRetakeBoundaryFrames:async()=>({start:Buffer.from('start'),end:Buffer.from('end')}),assembleRetake:vi.fn()}));
vi.mock('@/lib/supabase/storage',()=>({toPublicStorageUrl:(url:string)=>url}));
vi.mock('@/lib/supabase/service',()=>({getSupabaseAdmin:()=>({
  from:(table:string)=>{
    let id:string|undefined,update:any;
    const query:any={select:()=>query,eq:(key:string,value:string)=>{if(key==='id')id=value;return query},
      insert:async(row:any)=>{if(table==='video_retake_jobs')stubs.jobs.push(row);return{error:null}},
      update:(patch:any)=>{update=patch;return query},
      maybeSingle:async()=>{const row=stubs.jobs.find(job=>job.id===id);if(update&&row)Object.assign(row,update);return{data:table==='projects'?{id:'project'}:table==='video_retake_jobs'?row??null:null,error:null}}};return query;
  },rpc:async()=>({data:1,error:null}),storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:(path:string)=>({data:{publicUrl:'https://storage.example/'+path}})})}
})}));
import {createVideoRetake,retakeVideoMeta} from '@/lib/video-retake';
beforeEach(()=>{stubs.jobs.length=0;stubs.provider.mockReset().mockResolvedValue({success:true,taskId:'provider-test'});vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://storage.example')});
it.each(['fal-h3-max','seedance-2.5','seedance-2.5-eco'])('keeps creative image references through clip preparation and provider submission: %s',async model=>{
  const result=await createVideoRetake({userId:'owner',projectId:'project',images:['https://image.example/brand.jpg'],videoUrl:'https://storage.example/storage/v1/object/public/images/source.mp4',retake:{start:27.25,end:30.05},script:model==='fal-h3-max'?'Use Image 3 as a natural ending.':'Use <<<image_1>>> as a natural ending.',videoModel:model});
  expect(result.success).toBe(true);
  const submitted=stubs.provider.mock.calls[0][0];
  expect(submitted.images).toContain('https://image.example/brand.jpg');
  expect(submitted.videoUrl).toContain('-context.mp4');
  expect(submitted.videoOperation).toBe(model==='fal-h3-max'?'generate':'edit');
  if(model==='fal-h3-max')expect(submitted.images).toHaveLength(3);
  else expect(submitted.images).toEqual(['https://image.example/brand.jpg']);
  expect(retakeVideoMeta(stubs.jobs[0]).sourceUrls).toContain('https://image.example/brand.jpg');
});
it('does not reuse a paid receipt with a different image reference',async()=>{
  const base={userId:'owner',projectId:'project',images:['https://image.example/a.jpg'],videoUrl:'https://storage.example/storage/v1/object/public/images/source.mp4',retake:{start:27.25,end:30.05},script:'Use Image 3',videoModel:'fal-h3-max',billingRequestId:'same-receipt'};
  await createVideoRetake(base);
  const second=await createVideoRetake({...base,images:['https://image.example/b.jpg']});
  expect(second.success).toBe(false);
  expect(second.message).toMatch(/conflict/);
  expect(stubs.provider).toHaveBeenCalledTimes(1);
});
