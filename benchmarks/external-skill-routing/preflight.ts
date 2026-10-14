/** Routing-only live check. Every non-read_file tool is intercepted; no media,
 * code, exports, uploads or project/database writes execute. Run from the owning
 * worktree with its existing tsx runtime and markdown loader. */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { streamText, stepCountIs } from 'ai';
import { buildSystemPrompt } from '../../src/lib/agent';
import { createTools } from '../../src/lib/agent-tools';
import { createAgentModelRuntime, getAgentProviderOptions } from '../../src/lib/agent-model-runtime';
import { bundleAgentPrompt } from '../../src/lib/agent-prompt-bundles';

config({path:'/Users/tianyicai/ai-image-editor/.env.local',quiet:true});
const root=process.cwd();
const out=path.join(root,'docs/research/external-skill-workflow-contract/natural-routing-results.json');
const stopInstruction='本轮只选择适用的内部 Skill、说明理由并给出简短制作计划。在任何图片、视频或音频生成前停下来；不要分析媒体、上传、导出、运行代码或写入项目。可读取所需 Skill 文件。';
const cases=[
 {id:'natural-long-narrative',expected:'long-video-director',media:'<<<media_1>>> 人物甲参考图；<<<media_2>>> 人物乙参考图。当前只提供素材元信息用于规划。',prompt:'用这两张人物参考图做一支60秒故事短片，分段保持人物、造型与场景一致，包含完整导演规划、人物锚点和逐段分镜。'},
 {id:'natural-reference-replication',expected:'video-edit',media:'<<<media_1>>> 12秒参考视频；<<<media_2>>> 替换人物参考图。当前只提供素材元信息用于规划。',prompt:'把这支参考片复刻成新的品牌版本，用参考图替换人物，保留原片镜头顺序、时长、构图、运镜、动作和节拍。'},
 {id:'natural-product-explainer',expected:'explainer-video',media:'No media.',prompt:'做一支30秒中文产品讲解视频，面向第一次使用的用户，有旁白和字幕，讲清这个产品如何工作。'},
];

async function main(){
 const runtime=createAgentModelRuntime(undefined,'external-skill-natural-preflight');
 const system=await buildSystemPrompt();
 const context:any={currentImage:'',projectId:'external-skill-natural-preflight',snapshotImages:[],explicitMediaIndices:[],currentSnapshotIndex:0};
 const discovered=createTools(context,runtime);
 // Provider-executed tools have no client execute/schema to intercept. Disable
 // them entirely rather than risking a paid provider side effect.
 const originals=Object.fromEntries(Object.entries(discovered).filter(([,t]:[string,any])=>t.inputSchema));
 const disabledProviderTools=Object.keys(discovered).filter(name=>!(name in originals));
 const schemas=Object.fromEntries(Object.entries(originals).map(([name,t]:[string,any])=>[name,t.inputSchema]));
 const summary:any={kind:'controlled-live-natural-language-routing',model:runtime.spec.id,provider:runtime.spec.provider,guard:'Only local read_file executes. All other tools are intercepted and end the case. No real media was supplied.',disabledProviderTools,maxCases:cases.length,maxStepsPerCase:5,maxRetries:0,mediaOperationsExecuted:0,rows:[]};
 if(!process.argv.includes('--live')){console.log(JSON.stringify({model:runtime.spec.id,tools:Object.keys(schemas).length,systemChars:system.length,caseCount:cases.length,live:false}));return;}
 for(const scenario of cases){
  const calls:any[]=[];let text='',error:string|undefined;
  const tools=Object.fromEntries(Object.entries(originals).map(([name,t]:[string,any])=>[name,{description:t.description,inputSchema:schemas[name],execute:async(input:any)=>{
   if(name!=='read_file'){calls.push({name,input,executed:false,blocked:true});return {blocked:true,reason:'Routing-only preflight: production and media tools never execute.'};}
   const p=String(input.path);
   const base=p.startsWith('prompts/')?path.join(root,'src/lib'):p.startsWith('skills/')?path.join(root,'src'):null;
   const file=base?path.resolve(base,p):null;
   if(!base||!file||!file.startsWith(base+path.sep)||!fs.existsSync(file)){calls.push({name,path:p,executed:false,error:'not-found'});return {error:'File not found'};}
   calls.push({name,path:p,executed:true});
   return {path:p,content:bundleAgentPrompt(p,fs.readFileSync(file,'utf8'))};
  }}]));
  console.log(JSON.stringify({case:scenario.id,state:'started'}));
  let usage:any=null;const start=Date.now();
  try{
   const response=streamText({model:runtime.model,system,messages:[{role:'user',content:`[Media Index]\n${scenario.media}\n\n${scenario.prompt}\n\n${stopInstruction}`}],tools:tools as any,providerOptions:getAgentProviderOptions(runtime),stopWhen:[stepCountIs(5),()=>calls.some(c=>c.blocked)],maxOutputTokens:1600,maxRetries:0,abortSignal:AbortSignal.timeout(120000)});
   for await(const part of response.fullStream){if(part.type==='text-delta')text+=part.text;if(part.type==='error')throw part.error;}
   usage=await response.totalUsage;
  }catch(e){error=e instanceof Error?e.message:String(e);}
  const selectedFile=`skills/${scenario.expected}/SKILL.md`;
  const selected=calls.some(c=>c.name==='read_file'&&c.path===selectedFile&&c.executed);
  const stoppedBeforeProduction=!calls.some(c=>c.blocked);
  const row={id:scenario.id,prompt:scenario.prompt,stopInstruction,expected:scenario.expected,selected,stoppedBeforeProduction,passed:selected&&stoppedBeforeProduction&&!error,calls,text,usage,durationMs:Date.now()-start,...(error?{error}: {})};
  summary.rows.push(row);fs.writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({case:row.id,selected,stoppedBeforeProduction,passed:row.passed,readFiles:calls.filter(c=>c.name==='read_file').map(c=>c.path),blockedCalls:calls.filter(c=>c.blocked).map(c=>c.name),usage,durationMs:row.durationMs,...(error?{error}: {})}));
 }
 console.log(JSON.stringify({passed:summary.rows.filter((r:any)=>r.passed).length,total:cases.length,mediaOperationsExecuted:0,report:out}));
 if(summary.rows.some((r:any)=>!r.passed))process.exitCode=1;
}
main().then(()=>process.exit(process.exitCode||0)).catch(e=>{
 let message=e instanceof Error?e.message:String(e);
 for(const [name,value]of Object.entries(process.env))if(value&&/(KEY|TOKEN|PASSWORD|SECRET|URL)/i.test(name))message=message.split(value).join('[redacted]');
 console.error('Preflight setup failed; no media tool can execute. '+message.slice(0,500));process.exit(1);
});
