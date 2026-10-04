// Real CLI -> Agent -> tools -> saved project. Each case has a separate test project.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const arg=(k,d='')=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1]};
const root=path.resolve('artifacts/core-prompt/acceptance');
const which=arg('--case');
const stage=arg('--stage','');
const baseUrl=arg('--baseline-url','http://localhost:4353');
const candidateUrl=arg('--candidate-url','http://localhost:4352');
const cases={
 i2v:{prompt:'让 @1 的狗狗轻轻歪头，保持同一只狗和黄黑条纹领结，房间不变，生成5秒16:9横屏视频。用 MiniMax H3 Max 480p，直接生成无需确认。',files:['--image',path.join(root,'inputs/dog.webp')]},
 remotion:{prompt:'用 Remotion 做一个5秒、9:16、1080x1920的春季新品标题动画，标题「春日上新」，副标题「轻盈出发」，奶油白背景、深绿色文字、少量粉色花瓣，文字必须可编辑。直接制作，检查预览并发布到当前项目，不用确认。',files:[]},
 multi:{prompt:'把 @1 的狗狗放进 @2 的粉色球场环境，保持同一只狗狗、卷毛和黄黑条纹领结，做5秒狗狗轻轻歪头的视频。用 MiniMax H3 Max 480p，1:1。可以先制作所需首帧。直接完成首帧和视频生成，不用确认，不要用其他视频模型。',files:['--image',path.join(root,'inputs/dog.webp'),'--image',path.join(root,'inputs/poster.jpg')]},
 replicate:{prompt:'严格复刻 @1 的镜头、动作发生时间和节奏，将橘猫替换成黑白奶牛猫，房间和光线不变，成片保持5秒。用 SeeDance Mini 480p（seedance-mini）。先分析源视频并按复刻工作流完成，直接执行无需确认。',files:['--video',path.join(root,'inputs/cat-source.mp4')]},
 repair:{prompt:'只修改 @1 视频第2秒到第3秒这个局部片段：给橘猫加一条蓝色围巾。片段外的原视频和声音不变，整片仍5秒，最终拼回可播放的完整 MP4。走局部视频修复工作流，视频编辑用 Grok 480p，直接执行不用确认。',files:['--video',path.join(root,'inputs/cat-source.mp4')]},
 long:{prompt:'制作30秒完整故事：一只黄黑条纹领结的黑色卷毛狗在清晨房间里发现一个红色小球，追着球来到窗边，最后抱着球趴在蓝绿色坐垫上。使用 @1 保持角色一致。视频用 MiniMax H3 Max 480p，1:1，每段10秒，共三段，必须有连续动作衔接和统一房间。按长视频导演工作流完成锚点、分镜、三段视频并拼成30秒完整MP4。我明确授权全部阶段直接执行，不用逐步确认。',files:['--image',path.join(root,'inputs/dog.webp')]},
 ffmpeg:{prompt:'把 @1 原视频精确分割成前2秒和后3秒两个独立 MP4，保持原画幅和声音。必须实际执行、检查每段时长并发布两个文件到当前项目。直接做。',files:['--video',path.join(root,'inputs/cat-source.mp4')]},
 splice:{prompt:'把 @1 和 @2 剪在一起，做成可编辑时间线，先 @1 后 @2，每段保留完整5秒及原声音，总长10秒，保持16:9。检查预览并发布可编辑作品，直接做。',files:['--video',path.join(root,'inputs/cat-source.mp4'),'--video',path.join(root,'inputs/cat-source.mp4')]},
};
if(!cases[which])throw new Error('Select --case '+Object.keys(cases));
if(!process.argv.includes('--live'))throw new Error('Requires --live');
const prefix='workflow-'+which+(stage?'-'+stage:'');
const journal=path.join(root,prefix+'.json');
const records=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):[];
const save=()=>{fs.writeFileSync(journal+'.tmp',JSON.stringify(records,null,2));fs.renameSync(journal+'.tmp',journal)};
async function cli(args,variant){return (await exec('makaron',args,{env:{...process.env,MAKARON_URL:variant==='baseline'?baseUrl:candidateUrl},timeout:120_000,maxBuffer:12*1024*1024})).stdout;}
async function one(variant,repeat){
 let rec=records.find(r=>r.variant===variant&&r.repeat===repeat);
 if(rec?.status==='completed')return;
 if(!rec){rec={variant,repeat,case:which,stage,endpoint:variant==='baseline'?baseUrl:candidateUrl,startedAt:new Date().toISOString()};records.push(rec);save();}
 if(!rec.projectId){const out=await cli(['create','--title',`QA Core acceptance ${which} ${variant} ${repeat}`],variant);rec.projectId=out.match(/ID: ([a-f0-9-]+)/)?.[1];if(!rec.projectId)throw new Error('Project creation outcome unknown');save();}
 if(!rec.runId){if(rec.submitting)throw new Error('Submission unknown; inspect this project instead of duplicating');rec.submitting=true;save();
  const out=JSON.parse(await cli(['chat','--project',rec.projectId,'--agent-model','gpt-5.6-terra','--json','-b',...cases[which].files,cases[which].prompt],variant));rec.runId=out.runId;rec.submitting=false;save();}
 const deadline=Date.now()+40*60_000;
 while(Date.now()<deadline){
  const d=JSON.parse(await cli(['responses','get',rec.runId,'--json'],variant));
  fs.writeFileSync(path.join(root,`${prefix}-${variant}-${repeat}-result.json`),JSON.stringify(d,null,2));
  rec.status=d.status;rec.incomplete=d.incomplete;rec.completedAt=d.completed_at;save();
  if(['completed','failed','cancelled','aborted','incomplete'].includes(d.status)){console.log(JSON.stringify({case:which,variant,repeat,status:rec.status,runId:rec.runId}));return;}
  await new Promise(r=>setTimeout(r,15000));
 }
 rec.pollTimeout=true;save();
}
for(let repeat=0;repeat<Number(arg('--repeats','1'));repeat++){
 const results=await Promise.allSettled(['baseline','candidate'].map(v=>one(v,repeat)));
 for(const result of results)if(result.status==='rejected')throw result.reason;
}
if(records.some(r=>r.status!=='completed'))process.exitCode=1;
