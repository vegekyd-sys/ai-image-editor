import fs from 'node:fs';
import path from 'node:path';
import {config} from 'dotenv';
import {transcribeWithVolcengineAsr} from '../../src/lib/volcengine-asr';
config({path:'/Users/tianyicai/ai-image-editor/.env.local',quiet:true});
async function main(){
 const root='artifacts/core-prompt/acceptance/video-outputs';
 const records=[];
 for(const file of fs.readdirSync(root).filter(f=>f.startsWith('accept-video-dialogue-')&&f.endsWith('.mp4'))){
  const out=path.join(root,file.replace('.mp4','-speech.json'));
  let transcript:any;
  if(fs.existsSync(out))transcript=JSON.parse(fs.readFileSync(out,'utf8'));
  else{transcript=await transcribeWithVolcengineAsr({mediaUrl:'https://local-test.invalid/'+file,localMediaPath:path.resolve(root,file),language:'zh-CN'});fs.writeFileSync(out,JSON.stringify(transcript,null,2));}
  const normalized=transcript.text.replace(/[\s\p{P}]/gu,'');
  records.push({file,text:transcript.text,exact:normalized==='今天也要开心',durationMs:transcript.durationMs});
 }
 fs.writeFileSync(path.join(root,'speech-check.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
