import {describe,expect,it,vi} from 'vitest';
import {createStudioRun,parseStudioRun} from '@/lib/studio-run';
import {isStudioResumeRequest,resumePersistedStudioRun} from '@/lib/studio-run/resume';
function fixture(previousStatus='completed',previousOwner='u',activeIds=['new']){
 const run=createStudioRun({id:'studio',agentRunId:'old',projectId:'p',recipe:'explainer-video',title:'Saved work',approvalPolicy:'guided',deliveryPromise:{durationSeconds:15,width:1080,height:1920,fps:30,renderRuntime:'remotion',compositionMode:'editable',audioRequired:false,subtitlesRequired:false}});
 run.stages.brief.artifactVersion=2;run.artifacts.brief={stage:'brief',version:2,sha256:'a'.repeat(64),path:'p/studio-runs/studio/artifacts/brief.v2.json',createdAt:new Date().toISOString()} as any;
 const store={loadRun:vi.fn(async()=>run),saveRun:vi.fn(async()=>''),listRuns:vi.fn(async()=>[run]),saveArtifact:vi.fn()};
 const query:any={select:()=>query,eq:()=>query,
  in:async()=>({data:[{id:'old',user_id:previousOwner,project_id:'p',status:previousStatus},{id:'new',user_id:'u',project_id:'p',status:'running'}],error:null}),
  then:(resolve:any)=>resolve({data:activeIds.map(id=>({id})),error:null})};
 return {run,store,supabase:{from:()=>query} as any,agentRunId:'new',projectId:'p',userId:'u',authorized:true};
}
describe('explicit Studio continuation',()=>{
 it('preserves artifacts, stage versions and approval policy when transferring a stopped same-owner run',async()=>{
  const input=fixture();const next=await resumePersistedStudioRun(input);
  expect(next.agentRunId).toBe('new');expect(next.artifacts).toEqual(input.run.artifacts);expect(next.stages).toEqual(input.run.stages);expect(next.approvalPolicy).toBe('guided');
  expect(parseStudioRun(JSON.stringify(next)).agentRunId).toBe('new');expect(input.store.saveRun).toHaveBeenCalledTimes(1);
 });
 it('refuses to adopt an active run or another owner',async()=>{
  for(const input of [fixture('running'),fixture('completed','other'),fixture('completed','u',['new','second'])]){
   await expect(resumePersistedStudioRun(input)).rejects.toThrow();expect(input.store.saveRun).not.toHaveBeenCalled();
  }
 });
 it('does not let a model authorize its own takeover',async()=>{
  const input=fixture();input.authorized=false;await expect(resumePersistedStudioRun(input)).rejects.toThrow('explicit');expect(input.store.saveRun).not.toHaveBeenCalled();
 });
 it('recognizes confirmation and continuation, but leaves unrelated briefs alone',()=>{
  for(const s of ['确认，请继续出片','请继续之前的 Studio Run','Confirmo el guion','Approved, continue','請繼續之前的工作','再開してください'])expect(isStudioResumeRequest(s)).toBe(true);
  for(const s of ['[Active skill: tiktok-video] 新任务','Make a new unrelated video','确认，不要接管旧流程，从零建立新的时间线','Please continue from scratch'])expect(isStudioResumeRequest(s)).toBe(false);
 });
});
