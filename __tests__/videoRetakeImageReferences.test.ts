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
it('uses the exact supplied ending image as the native endpoint and omits conflicting source-video references',async()=>{
  const ending='https://image.example/homepage.jpg';
  const result=await createVideoRetake({userId:'owner',projectId:'project',images:[],videoUrl:'https://storage.example/storage/v1/object/public/images/source.mp4',retake:{start:24.05,end:30.05,endFrame:{imageUrl:ending}},script:'Transition to Image 2 and hold it.',videoModel:'fal-h3-max'});
  expect(result.success).toBe(true);
  const submitted=stubs.provider.mock.calls[0][0];
  expect(submitted.h3RetakeBoundaryFrames).toMatchObject({endUrl:ending,lockEndpoints:true});
  expect(submitted.images).toHaveLength(2);
  expect(submitted.images[1]).toBe(ending);
  expect(submitted.videoUrl).toBeUndefined();
  expect(submitted.h3RetakeBoundaryFrames.middle).toBeUndefined();
  expect(retakeVideoMeta(stubs.jobs[0])).toMatchObject({sourceUrls:expect.arrayContaining([ending]),retake:{inputDuration:0}});
});
it('rejects replacing an internal join with a final image before submitting or creating a job',async()=>{
  const result=await createVideoRetake({userId:'owner',projectId:'project',images:[],videoUrl:'https://storage.example/storage/v1/object/public/images/source.mp4',retake:{start:18,end:21,endFrame:{imageUrl:'https://image.example/homepage.jpg'}},script:'Finish on Image 2.',videoModel:'fal-h3-max'});
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/end of the source video/);
  expect(stubs.provider).not.toHaveBeenCalled();
  expect(stubs.jobs).toHaveLength(0);
});
