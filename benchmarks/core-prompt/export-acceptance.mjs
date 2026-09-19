// Export saved QA compositions through the real CLI/Lambda path; preserve attempts.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
if(!process.argv.includes('--live'))throw new Error('Export requires --live');
const root=path.resolve('artifacts/core-prompt/acceptance');
const output=path.join(root,'composition-outputs');fs.mkdirSync(output,{recursive:true});
const journal=path.join(output,'manifest.json');
const records=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):[];
const save=()=>fs.writeFileSync(journal,JSON.stringify(records,null,2));
const jobs=[];
for(const scenario of ['remotion','splice'])for(const row of JSON.parse(fs.readFileSync(path.join(root,'workflow-'+scenario+'.json'),'utf8'))){
 if(row.status==='completed')jobs.push({...row,scenario});
}
async function one(job){
 const key=`${job.scenario}-${job.variant}-${job.repeat}`;
 const previous=records.find(r=>r.key===key);
 if(previous&&!(previous.error==='Error: No saved design'&&!previous.mediaIndex))return;
 const rec=previous||{key,scenario:job.scenario,variant:job.variant,repeat:job.repeat,projectId:job.projectId,status:'attempting'};
 if(previous){rec.priorHarnessError=previous.error;delete rec.error;rec.status='attempting';}else records.push(rec);save();
 const env={...process.env,MAKARON_URL:'http://localhost:'+(job.variant==='baseline'?'4353':'4352')};
 try{
  const media=JSON.parse((await exec('makaron',['project','media',job.projectId,'--json'],{env,timeout:120000,maxBuffer:12e6})).stdout);
  const designs=media.media.filter(m=>m.type==='composition'||m.type==='design');const selected=designs.at(-1);
  if(!selected)throw new Error('No saved design');
  rec.mediaIndex=selected.index;save();
  const result=JSON.parse((await exec('makaron',['composition','export','--project',job.projectId,'--media',String(selected.index),'--wait','--json'],{env,timeout:900000,maxBuffer:12e6})).stdout);
  fs.writeFileSync(path.join(output,key+'-export.json'),JSON.stringify(result,null,2));
  const url=result.outputUrl||result.videoUrl||result.url||result.export?.outputUrl||result.result?.url;
  if(!url){rec.status='export-returned';save();return;}
  const res=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!res.ok)throw new Error('HTTP '+res.status);
  rec.path=key+'.mp4';const local=path.join(output,rec.path);fs.writeFileSync(local,Buffer.from(await res.arrayBuffer()));
  const probe=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',local])).stdout);const v=probe.streams.find(s=>s.codec_type==='video');
  await exec('ffmpeg',['-v','error','-i',local,'-f','null','-'],{timeout:120000});
  rec.probe={duration:Number(probe.format.duration),width:v.width,height:v.height,audio:probe.streams.some(s=>s.codec_type==='audio'),fullyDecoded:true};rec.status='completed';
 }catch(e){rec.status='failed-or-unknown';rec.error=String(e);}
 save();console.log(JSON.stringify({key,status:rec.status,probe:rec.probe,error:rec.error}));
}
for(let i=0;i<jobs.length;i+=2){const outcomes=await Promise.allSettled(jobs.slice(i,i+2).map(one));for(const o of outcomes)if(o.status==='rejected')throw o.reason;}
