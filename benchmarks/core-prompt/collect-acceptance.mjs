import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve('artifacts/core-prompt/acceptance');const out=path.join(root,'workflow-outputs');fs.mkdirSync(out,{recursive:true});
const index=[];
for(const file of fs.readdirSync(root)){
 const match=file.match(/^workflow-(.+)-(baseline|candidate)-(\d+)-result.json$/)||file.match(/^followup-(.+)-(baseline|candidate)-result.json$/)?.map((v,i)=>i===1?v+'-followup':v).concat('0');if(!match)continue;
 const [,scenario,variant,repeat]=match;const d=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
 if(d.status!=='completed')continue;
 for(const [type,items]of Object.entries({image:d.result?.images||[],video:d.result?.videos||[]}))for(let i=0;i<items.length;i++){
  const item=items[i];const url=item.videoUrl||item.imageUrl||item.url;if(!url)continue;
  const name=`${scenario}-${variant}-${repeat}-${type}-${i}`;const ext=type==='video'?'.mp4':'.jpg';const local=path.join(out,name+ext);
  const rec={scenario,variant,repeat:Number(repeat),type,path:path.relative(root,local),taskId:item.taskId,projectId:d.projectId||d.project_id};
  try{
   if(!fs.existsSync(local)){const res=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!res.ok)throw new Error('HTTP '+res.status);fs.writeFileSync(local,Buffer.from(await res.arrayBuffer()));}
   if(type==='video'){
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',local],{encoding:'utf8'}));const v=probe.streams.find(s=>s.codec_type==='video');
    execFileSync('ffmpeg',['-v','error','-i',local,'-f','null','-'],{timeout:120000});
    rec.probe={duration:Number(probe.format.duration),videoDuration:Number(v.duration),fps:v.r_frame_rate,width:v.width,height:v.height,audio:probe.streams.some(s=>s.codec_type==='audio'),fullyDecoded:true};
    if(!fs.existsSync(path.join(out,name+'-sheet.jpg')))execFileSync('ffmpeg',['-y','-v','error','-i',local,'-vf',`fps=6/${rec.probe.duration},scale=320:-1,tile=3x2`,'-frames:v','1',path.join(out,name+'-sheet.jpg')]);
   }
  }catch(e){rec.error=String(e);}
  index.push(rec);
 }
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(index,null,2));console.log(JSON.stringify(index.filter(i=>i.type==='video').map(({scenario,variant,repeat,probe,error})=>({scenario,variant,repeat,probe,error}))));
