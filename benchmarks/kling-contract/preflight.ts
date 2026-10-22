/** Live Agent contract check. Only local prompt/skill reads execute; all other
 * tools are intercepted. No provider media calls, uploads or project writes. */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { streamText, stepCountIs } from 'ai';
import { buildSystemPrompt } from '../../src/lib/agent';
import { createTools } from '../../src/lib/agent-tools';
import { createAgentModelRuntime, getAgentProviderOptions } from '../../src/lib/agent-model-runtime';
import { bundleAgentPrompt } from '../../src/lib/agent-prompt-bundles';
const envIndex=process.argv.indexOf('--env');
if(envIndex>=0) config({path:process.argv[envIndex+1],quiet:true});
const outIndex=process.argv.indexOf('--out');
const root=process.cwd();
async function main() {
 const runtime=createAgentModelRuntime('deepseek-flash','kling-contract-preflight');
 const system=await buildSystemPrompt();
 const scenarios=[
  {id:'explicit-30s-single-take',prompt:'我要 Kling 4，30 秒，1080p，9:16，一个完整长镜头，不拆分、不拼接、不降级、不换模型。脚本已确认：糖果魔法世界里，一只原创小精灵从花朵变成云鲸再变成星星，镜头连续跟随，原生可爱英文旁白与梦幻音乐。直接提交。如果当前接口真的不支持30秒，说明真实限制并停止。',retired:false},
  {id:'correct-stale-history',prompt:'上一条助手说「Kling 4 单条最多15秒」，我怀疑它引用了旧模型限制。请以当前工具和指南核对。现在明确用 Kling 4，30秒，720p，16:9，一条完整长镜头，禁止拆分或换模型。脚本确认：一颗纸星在梦幻花园中连续变身为蝴蝶、云鲸和小魔法师。直接提交。',retired:false},
  {id:'retired-o3',prompt:'用旧 Kling O3（model=kling）生成5秒视频，不要换成Kling4或其他模型。脚本已确认：一颗星星闪烁。直接提交；如果已经下架就停止。',retired:true},
 ];
 const rows=[];
 for(const scenario of scenarios){
  const originals=createTools({currentImage:'',projectId:'kling-contract-preflight',snapshotImages:[],explicitMediaIndices:[],currentSnapshotIndex:0} as any,runtime);
  const calls:any[]=[];
  const intercepted=Object.fromEntries(Object.entries(originals).filter(([,t]:[string,any])=>t.inputSchema).map(([name,t]:[string,any])=>[name,{description:t.description,inputSchema:t.inputSchema,execute:async(input:any)=>{
   if(name!=='read_file'){calls.push({name,input,executed:false});return {blocked:true,message:'Acceptance intercepted this tool; nothing was submitted.'};}
   const p=String(input.path), base=p.startsWith('prompts/')?path.join(root,'src/lib'):p.startsWith('skills/')?path.join(root,'src'):null;
   const file=base?path.resolve(base,p):null;
   if(!base||!file||!file.startsWith(base+path.sep)||!fs.existsSync(file)){calls.push({name,path:p,executed:false});return {error:'not found'};}
   calls.push({name,path:p,executed:true});return {path:p,content:bundleAgentPrompt(p,fs.readFileSync(file,'utf8'))};
  }}]));
  let text=''; const start=Date.now();
  const response=streamText({model:runtime.model,system,prompt:scenario.prompt,tools:intercepted as any,providerOptions:getAgentProviderOptions(runtime),stopWhen:[stepCountIs(6),()=>calls.some(c=>c.name!=='read_file')],maxRetries:0,maxOutputTokens:2200,abortSignal:AbortSignal.timeout(120000)});
  for await(const part of response.fullStream){if(part.type==='text-delta')text+=part.text;if(part.type==='error')throw part.error;}
  const submits=calls.filter(c=>c.name!=='read_file');
  const passed=scenario.retired?submits.length===0&&/下架|retired|不可用/.test(text):submits.length===1&&submits[0].name==='generate_animation'&&submits[0].input.model==='kling-4'&&submits[0].input.duration===30;
  const row={id:scenario.id,passed,calls,text,usage:await response.totalUsage,durationMs:Date.now()-start};rows.push(row);
  console.log(JSON.stringify({id:row.id,passed,calls:calls.map(c=>({name:c.name,path:c.path,model:c.input?.model,duration:c.input?.duration})),durationMs:row.durationMs}));
 }
 const report={kind:'live-agent-intercepted-submission',model:runtime.spec.id,mediaOperationsExecuted:0,projectWrites:0,rows};
 if(outIndex>=0)fs.writeFileSync(process.argv[outIndex+1],JSON.stringify(report,null,2)+'\n');
 if(rows.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.name:'preflight failed');process.exitCode=1;});
