/** Controlled first-action A/B. Only read_file executes; all media/code tools
 * stop at captured arguments. This gate measures routing, NOT rendered quality.
 * Usage: node --import tsx --require ./md-loader.cjs benchmarks/core-prompt/evaluate.ts --live --filter video-direct --repeats 3
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import { streamText, stepCountIs, jsonSchema } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt } from '../../src/lib/agent';
import { createTools } from '../../src/lib/agent-tools';
import { createAgentModelRuntime, getAgentProviderOptions } from '../../src/lib/agent-model-runtime';
import { bundleAgentPrompt } from '../../src/lib/agent-prompt-bundles';
import type { AgentModelPreference } from '../../src/lib/agent-models';

const read = (p: string) => fs.readFileSync(p, 'utf8');
const baseline = JSON.parse(read('benchmarks/core-prompt/baseline.json'));
const arg = (name: string, fallback = '') => { const i=process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i+1]; };
const cases = JSON.parse(read(arg('--cases', 'benchmarks/core-prompt/cases.json')));
config({path: arg('--env', '/Users/tianyicai/ai-image-editor/.env.local'), quiet: true});
const outputDir = arg('--output', 'artifacts/core-prompt');
fs.mkdirSync(outputDir, {recursive:true});

async function main() {
 const runtime = createAgentModelRuntime(arg('--model', 'gpt-5.6-terra') as AgentModelPreference, 'prompt-refactor-ab', 'azure-openai');
 const ctx: any={currentImage:'',projectId:'prompt-refactor-ab',snapshotImages:[],explicitMediaIndices:[],currentSnapshotIndex:0};
 const actualTools=createTools(ctx,runtime);
 const schemas=Object.fromEntries(Object.entries(actualTools).map(([name,t]:[string,any])=>[name,z.toJSONSchema(t.inputSchema)]));
 const candidateSystem=await buildSystemPrompt();
 const candidateCore=read('src/lib/prompts/agent.md');
 const candidateAuthoring='Before coding, read `prompts/agent-coding.md` once. Before creating a reusable skill, read `skills/SKILL_README.md` and an existing skill (for example `skills/makaron-mascot/SKILL.md`). Skills must work across projects; describe a style, technique, or character, not one photo.';
 if(!candidateSystem.includes(candidateAuthoring))throw new Error('Cannot reconstruct frozen baseline workspace');
 const baselineSystem=candidateSystem.replace(candidateCore,baseline.agent).replace(candidateAuthoring,baseline.workspaceAuthoring);
 const systems={baseline:baselineSystem,candidate:candidateSystem};
 const toolDescriptions=(variant:string)=>Object.fromEntries(Object.entries(actualTools).map(([name,t]:[string,any])=>[name,variant==='baseline'&&name==='generate_animation'?baseline.toolDescriptions.video:variant==='baseline'&&name==='run_code'?baseline.toolDescriptions.coding:t.description]));
 const inventory=Object.fromEntries(Object.entries(systems).map(([variant,system])=>[variant,{systemChars:system.length,toolChars:JSON.stringify(Object.entries(schemas).map(([name,schema])=>({name,description:toolDescriptions(variant)[name],schema}))).length,systemSha256:createHash('sha256').update(system).digest('hex')}]));
 fs.writeFileSync(path.join(outputDir,'inventory.json'),JSON.stringify({baseRevision:baseline.revision,host:os.hostname(),model:runtime.spec,inventory},null,2));
 console.log(JSON.stringify(inventory));
 if(!process.argv.includes('--live'))return;
 const selected=cases.filter((c:any)=>!arg('--filter')||new RegExp(arg('--filter')).test(c.id));
 const repeats=Number(arg('--repeats','1'));const rows:any[]=[];
 const file=path.join(outputDir,`routing-${Date.now()}.json`);
 for(let repeat=0;repeat<repeats;repeat++)for(const scenario of selected)for(const variant of (repeat%2?['candidate','baseline']:['baseline','candidate']) as Array<keyof typeof systems>){
  const start=performance.now();let firstTextMs:number|null=null,firstActionMs:number|null=null,fullText='',error:string|undefined;const calls:any[]=[];
  const descriptions=toolDescriptions(variant);
  const tools=Object.fromEntries(Object.entries(actualTools).map(([name])=>[name,{description:descriptions[name],inputSchema:jsonSchema(schemas[name] as any),execute:async(input:any)=>{
   calls.push({name,input,ms:Math.round(performance.now()-start)});
   if(name!=='read_file'){firstActionMs??=Math.round(performance.now()-start);return {captured:true};}
   const p=String(input.path); const local=p.startsWith('prompts/')?path.join(process.cwd(),'src/lib',p):p.startsWith('skills/')?path.join(process.cwd(),'src',p):null;
   if(!local || !fs.existsSync(local))return {error:'File not found: '+p};
   const content=read(local);return {path:p,content:variant==='candidate'?bundleAgentPrompt(p,content):content};
  }}]));
  let usage:any=null;
  try{
   const media=scenario.mediaDescription?'[Media Index]\n'+scenario.mediaDescription:scenario.noMedia?'[Media Index]\nNo media.':scenario.video?'[Media Index]\n<<<media_1>>> video: person walking, duration 10s, 720x1280.\n<<<media_2>>> video: street, duration 10s, 720x1280.':'[Media Index]\n<<<media_1>>> current original photo: person seated with a white coffee cup.\n<<<media_2>>> photo: person wearing a blue coat.\nCurrent selection: media_1.';
   const fixtures: string[] = scenario.fixtures || (scenario.fixture ? [scenario.fixture] : []);
   const response=streamText({model:runtime.model,system:systems[variant],messages:[{role:'user',content:[{type:'text',text:media+'\n\n'+scenario.prompt},...fixtures.map(f=>({type:'file' as const,data:fs.readFileSync(f),mediaType:f.endsWith('.webp')?'image/webp':f.endsWith('.png')?'image/png':'image/jpeg'}))]}],tools:tools as any,providerOptions:getAgentProviderOptions(runtime),stopWhen:[stepCountIs(10),()=>calls.some(c=>c.name!=='read_file')],abortSignal:AbortSignal.timeout(180_000),maxRetries:0});
   for await(const part of response.fullStream){if(part.type==='text-delta'){if(part.text.trim())firstTextMs??=Math.round(performance.now()-start);fullText+=part.text;}if(part.type==='error')throw part.error;}
   usage=await response.totalUsage;
  }catch(e){error=e instanceof Error?e.message:String(e);}
  const failures:string[]=[]; const terminal=calls.find(c=>c.name!=='read_file');
  if(error)failures.push(error);
  if(scenario.noTools&&calls.length)failures.push('unexpected tools');
  if(scenario.terminal&&terminal?.name!==scenario.terminal)failures.push('expected terminal '+scenario.terminal+', got '+terminal?.name);
  for(const name of scenario.forbid||[])if(calls.some(c=>c.name===name))failures.push('forbidden '+name);
  for(const p of scenario.reads||[])if(!calls.some(c=>c.name==='read_file'&&c.input.path===p))failures.push('missing read '+p);
  for(const [k,v]of Object.entries(scenario.args||{}))if(terminal?.input[k]!==v)failures.push('wrong '+k);
  for(const [k,v]of Object.entries(scenario.includes||{}))if(!terminal?.input[k]?.includes(v))failures.push('missing '+k+' member');
  for(const k of scenario.absent||[])if(terminal?.input[k]!=null&&terminal.input[k]!=='')failures.push('unexpected '+k);
  for(const s of scenario.textIncludes||[])if(!fullText.includes(s))failures.push('missing output '+s);
  for(const s of scenario.codeIncludes||[])if(!JSON.stringify(terminal?.input).includes(s))failures.push('missing code '+s);
  if(!fullText.trim())failures.push('no user-visible text');
  const row={scenario,case:scenario.id,domain:scenario.domain,variant,repeat,firstTextMs,firstActionMs,totalMs:Math.round(performance.now()-start),usage,calls,text:fullText,failures,passed:!failures.length}; rows.push(row);
  fs.writeFileSync(file,JSON.stringify({gate:'first-action only; no media generated or code executed',host:os.hostname(),model:runtime.spec,inventory,rows},null,2));
  console.log(JSON.stringify({case:row.case,variant,repeat,firstTextMs,firstActionMs,passed:row.passed,failures}));
 }
 console.log('Saved '+file);
 if(rows.some(r=>!r.passed))process.exitCode=1;
}
main().then(()=>process.exit(process.exitCode || 0)).catch(e=>{console.error(e.message);process.exit(1);});
