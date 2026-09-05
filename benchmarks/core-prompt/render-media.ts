import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
config({path:'/Users/tianyicai/ai-image-editor/.env.local',quiet:true});
const arg=(name:string,fallback='')=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]};
async function main(){
 if(!process.argv.includes('--live'))throw new Error('Pass --live to generate paid test media');
 const input=JSON.parse(fs.readFileSync(arg('--input'),'utf8'));
 const rows=input.rows.filter((r:any)=>r.case===arg('--case')&&r.passed);
 if(rows.length<2)throw new Error('Need both passing baseline and candidate captures');
 const dir=arg('--output','artifacts/core-prompt/media');fs.mkdirSync(dir,{recursive:true});
 const {editImage}=await import('../../src/lib/skills/edit-image');
 const {createVideo}=await import('../../src/lib/skills/create-video');
 const {getVideoStatus}=await import('../../src/lib/skills/get-video-status');
 const journal=path.join(dir,'manifest.json');
 const results=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):[];
 for(const row of rows){
  const key=`${row.case}-${row.variant}-${row.repeat}`;
  if(results.some((x:any)=>x.key===key)){console.log('Already attempted '+key);continue;}
  const call=row.calls.find((c:any)=>['generate_image','generate_animation'].includes(c.name));if(!call)throw new Error('No media call');
  const entry:any={key,case:row.case,variant:row.variant,captured:call.input,captureFile:arg('--input'),systemSha256:input.inventory?.[row.variant]?.systemSha256,imageProvider:process.env.AI_PROVIDER || 'google',imageModel:process.env.IMAGE_MODEL,startedAt:new Date().toISOString(),status:'attempting'};results.push(entry);
  const save=()=>fs.writeFileSync(journal,JSON.stringify(results,null,2));save();const start=Date.now();
  try{
   if(call.name==='generate_image'){
    const fixture=arg('--fixture');
    const currentImage=fixture?'data:image/webp;base64,'+fs.readFileSync(fixture).toString('base64'):'';
    const result=await editImage({...call.input,preferredModel:call.input.model},{currentImage,projectId:'prompt-media-local'} as any);
    entry.success=result.success;entry.comparable=!(call.input.model && result.usedModel!==call.input.model);entry.model=result.usedModel;entry.provider=result.provider;entry.usage=result.usage;entry.message=result.message;
    if(result.image){const m=result.image.match(/^data:([^;]+);base64,(.*)$/s);if(!m)throw new Error('Expected image data URL');entry.path=key+(m[1].includes('png')?'.png':'.jpg');fs.writeFileSync(path.join(dir,entry.path),Buffer.from(m[2],'base64'));}
   }else{
    const v=call.input;
    const result=await createVideo({script:v.story_prompt,images:[],duration:v.duration,aspectRatio:v.aspect_ratio,videoModel:v.model||'seedance-fast',videoResolution:v.video_resolution||'720p',generateAudio:v.generate_audio});
    Object.assign(entry,{submission:result,taskId:result.taskId});save();
    if(!result.success)throw new Error(result.message);
    let url=result.videoUrl;
    while(!url&&Date.now()-start<20*60_000){
     await new Promise(r=>setTimeout(r,12000));
     const status=await getVideoStatus({taskId:result.taskId!});entry.lastStatus=status;save();
     if(status.status==='failed')throw new Error(status.message);
     if(status.status==='completed')url=status.videoUrl;
     console.log(key+': '+status.status);
    }
    if(!url)throw new Error('Generation still pending; resume polling recorded taskId, never resubmit');
    const response=await fetch(url);if(!response.ok)throw new Error('Download HTTP '+response.status);
    entry.path=key+'.mp4';fs.writeFileSync(path.join(dir,entry.path),Buffer.from(await response.arrayBuffer()));entry.success=true;
   }
   entry.status=entry.success?'completed':'failed';
  }catch(e){entry.status='failed-or-unknown';entry.error=e instanceof Error?e.message:String(e);}
  entry.elapsedMs=Date.now()-start;save();console.log(JSON.stringify({key,status:entry.status,elapsedMs:entry.elapsedMs,error:entry.error}));
 }
 if(results.some((r:any)=>r.status!=='completed'))process.exitCode=1;
}
main().then(()=>process.exit(process.exitCode||0)).catch(e=>{console.error(e.message);process.exit(1)});
