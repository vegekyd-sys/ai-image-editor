/** Executes captured A/B calls with the app's real provider clients. No project DB writes.
 * Journal before submission; resume known video tasks, never resubmit unknown outcomes. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
config({path:'/Users/tianyicai/ai-image-editor/.env.local',quiet:true});
const arg=(k:string,d='')=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1]};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const root=arg('--root','artifacts/core-prompt/acceptance');
const kind=arg('--kind','image');
const captureDir=arg('--captures',path.join(root,kind+'-captures'));
const output=arg('--output',path.join(root,kind+'-outputs'));
fs.mkdirSync(output,{recursive:true});
const journal=path.join(output,'manifest.json');
const records:any[]=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):[];
const save=()=>{fs.writeFileSync(journal+'.tmp',JSON.stringify(records,null,2));fs.renameSync(journal+'.tmp',journal)};
const mime=(f:string)=>f.endsWith('.webp')?'image/webp':f.endsWith('.png')?'image/png':'image/jpeg';
const data=(f:string)=>'data:'+mime(f)+';base64,'+fs.readFileSync(f).toString('base64');
function probe(file:string){
 const p=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],{encoding:'utf8'}));
 const v=p.streams.find((s:any)=>s.codec_type==='video');
 execFileSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{timeout:120_000});
 return {duration:Number(p.format.duration),videoDuration:Number(v.duration),width:v.width,height:v.height,codec:v.codec_name,audio:p.streams.some((s:any)=>s.codec_type==='audio'),fullyDecoded:true};
}
async function run(row:any,capture:any,file:string){
 const key=`${row.case}-${row.variant}-${row.repeat}`;
 if(records.some(r=>r.key===key))return;
 const entry:any={key,case:row.case,variant:row.variant,repeat:row.repeat,scenario:row.scenario,capture:file,systemSha256:capture.inventory[row.variant].systemSha256,startedAt:new Date().toISOString(),status:'attempting',routingPassed:row.passed};
 records.push(entry);save();
 if(!row.passed){entry.status='routing-failed';entry.error=row.failures;save();return;}
 const call=row.calls.find((c:any)=>c.name=== (kind==='image'?'generate_image':'generate_animation'));
 if(!call){entry.status='missing-call';save();return;}
 entry.input=call.input;save();const start=Date.now();
 try{
  if(kind==='image'){
   const {editImage}=await import('../../src/lib/skills/edit-image');
   const fixtures=row.scenario.fixtures||(row.scenario.fixture?[row.scenario.fixture]:[]);
   const n=call.input.media_index||1;
   const refs=(call.input.reference_media_indices||[]).filter((i:number)=>i!==n).map((i:number)=>data(fixtures[i-1]));
   const result=await editImage({...call.input,preferredModel:call.input.model},{currentImage:fixtures[n-1]?data(fixtures[n-1]):'',referenceImages:refs,projectId:'prompt-acceptance-local'} as any);
   Object.assign(entry,{model:result.usedModel,provider:result.provider,message:result.message,usage:result.usage,comparable:result.usedModel===call.input.model});
   if(!result.success||!result.image)throw new Error(result.message);
   const m=result.image.match(/^data:([^;]+);base64,(.*)$/s);if(!m)throw new Error('Expected image data URL');
   entry.path=key+(m[1].includes('png')?'.png':'.jpg');fs.writeFileSync(path.join(output,entry.path),Buffer.from(m[2],'base64'));
   const sharp=(await import('sharp')).default;const image=sharp(path.join(output,entry.path));const meta=await image.metadata();
   entry.probe={width:meta.width,height:meta.height,format:meta.format,hasAlpha:meta.hasAlpha};
   if(call.input.background==='transparent'){
    const {data:pixels,info}=await sharp(path.join(output,entry.path)).ensureAlpha().raw().toBuffer({resolveWithObject:true});let transparent=0,partial=0;
    for(let i=3;i<pixels.length;i+=info.channels){if(pixels[i]===0)transparent++;else if(pixels[i]<255)partial++;}
    entry.probe.transparentFraction=transparent/(info.width*info.height);entry.probe.partialAlphaFraction=partial/(info.width*info.height);
    const source=await sharp(fixtures[n-1]).metadata();entry.hardChecks={alpha:transparent>0,canvas:source.width===meta.width&&source.height===meta.height};
   }
  }else{
   const {createVideo}=await import('../../src/lib/skills/create-video');
   const v=call.input;
   const imageUrl=row.scenario.fixture?fs.readFileSync(path.join(root,'upload-dog.json'),'utf8').match(/https:\/\/\S+/)?.[0]:undefined;
   const urls=row.scenario.videoUrls||[];
   const result=await createVideo({script:v.story_prompt,images:imageUrl?[imageUrl]:[],duration:v.duration,aspectRatio:v.aspect_ratio,videoModel:v.model,videoResolution:v.video_resolution,generateAudio:v.generate_audio,videoUrls:urls,videoOperation:v.video_operation,referenceVideoMetas:row.scenario.referenceVideoMetas});
   Object.assign(entry,{submission:result,taskId:result.taskId,model:result.videoModel,provider:result.provider,comparable:result.videoModel===v.model});save();
   if(!result.success)throw new Error(result.message);
   entry.status='polling';save();
   await finishVideo(entry,result.videoUrl);
  }
  entry.status='completed';
 }catch(e){entry.status=entry.taskId?'pending-or-failed':'failed-or-unknown';entry.error=e instanceof Error?e.message:String(e);}
 entry.elapsedMs=Date.now()-start;save();console.log(JSON.stringify({key,status:entry.status,comparable:entry.comparable,error:entry.error,elapsedMs:entry.elapsedMs}));
}
async function finishVideo(entry:any,url?:string){
 const {getVideoStatus}=await import('../../src/lib/skills/get-video-status');
 const deadline=Date.now()+20*60_000;
 while(!url&&Date.now()<deadline){await sleep(5000);const s=await getVideoStatus({taskId:entry.taskId});entry.lastStatus=s;save();if(s.status==='failed')throw new Error(s.message);if(s.status==='completed')url=s.videoUrl;}
 if(!url)throw new Error('Still pending; resume taskId without resubmission');
 const res=await fetch(url);if(!res.ok)throw new Error('Download HTTP '+res.status);
 entry.path=entry.key+'.mp4';fs.writeFileSync(path.join(output,entry.path),Buffer.from(await res.arrayBuffer()));entry.probe=probe(path.join(output,entry.path));
 const expectedDuration=entry.input.duration ?? entry.scenario.referenceVideoMetas?.[0]?.durationSec;
 const ratio=String(entry.input.aspect_ratio||'').split(':').map(Number);
 const aspect=ratio.length===2&&ratio.every(n=>n>0)?Math.abs(entry.probe.width/entry.probe.height-ratio[0]/ratio[1])/(ratio[0]/ratio[1])<0.02:undefined;
 entry.hardChecks={...(expectedDuration==null?{}:{duration:Math.abs(entry.probe.videoDuration-expectedDuration)<0.25}),...(aspect===undefined?{}:{aspect}),decode:entry.probe.fullyDecoded,audio:entry.probe.audio};entry.videoUrl=url;
}
async function main(){
 if(!process.argv.includes('--live'))throw new Error('Paid generation requires --live');
 for(const entry of records.filter(r=>r.taskId&&['polling','pending-or-failed'].includes(r.status))){try{await finishVideo(entry);entry.status='completed';delete entry.error;}catch(e){entry.error=String(e);}save();}
 const expected=Number(arg('--expected',kind==='image'?'48':'24'));const deadline=Date.now()+45*60_000;
 while(records.length<expected&&Date.now()<deadline){
  const pending:any[]=[];
  if(fs.existsSync(captureDir))for(const file of fs.readdirSync(captureDir).filter(f=>f.endsWith('.json'))){let c:any;try{c=JSON.parse(fs.readFileSync(path.join(captureDir,file),'utf8'));}catch{continue;}
   for(const row of c.rows||[])if(!records.some(r=>r.key===`${row.case}-${row.variant}-${row.repeat}`))pending.push({row,c,file:path.join(captureDir,file)});
  }
  if(!pending.length){await sleep(5000);continue;}
  const outcomes=await Promise.allSettled(pending.slice(0,2).map(p=>run(p.row,p.c,p.file)));for(const o of outcomes)if(o.status==='rejected')throw o.reason;
 }
 console.log(JSON.stringify({completed:records.filter(r=>r.status==='completed').length,total:records.length,expected}));
 if(records.length!==expected||records.some(r=>r.status!=='completed'||!r.comparable||Object.values(r.hardChecks||{}).some(v=>!v)))process.exitCode=1;
}
main().then(()=>process.exit(process.exitCode||0)).catch(e=>{console.error(e);process.exit(1)});
