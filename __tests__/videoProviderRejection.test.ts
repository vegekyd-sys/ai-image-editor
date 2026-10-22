// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest'
import {createVideo} from '@/lib/skills/create-video'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it.each([400,401,403,404,422,429])('treats a confirmed Google HTTP %s as rejected, not unknown acceptance',async status=>{
 vi.stubEnv('GOOGLE_API_KEY','test');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'Rejected'}}),{status})));
 expect(await createVideo({script:'A red cube',images:[],duration:3,videoModel:'google-omni',videoResolution:'720p'})).toMatchObject({success:false,submissionUncertain:false,errorCode:'PROVIDER_REJECTED'});
})
it.each([408,500,504])('preserves uncertainty on Google HTTP %s',async status=>{
 vi.stubEnv('GOOGLE_API_KEY','test');vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status})));
 expect(await createVideo({script:'A red cube',images:[],duration:3,videoModel:'google-omni',videoResolution:'720p'})).toMatchObject({success:false,submissionUncertain:true});
})
