import fs from 'node:fs';
import vm from 'node:vm';
import { config } from 'dotenv';
import { generateText } from 'ai';
import { createAgentModelRuntime,getAgentProviderOptions } from '../../src/lib/agent-model-runtime';
import { validateDesign } from '../../src/lib/design-harness';
import { bundleAgentPrompt } from '../../src/lib/agent-prompt-bundles';
config({path:'/Users/tianyicai/ai-image-editor/.env.local',quiet:true});
async function main(){
 if(!process.argv.includes('--live'))throw new Error('Pass --live');
 const runtime=createAgentModelRuntime('gpt-5.6-terra','prompt-code-repair','azure-openai');
 const baseline=JSON.parse(fs.readFileSync('benchmarks/core-prompt/baseline.json','utf8'));
 const rows=[];
 for(const variant of ['baseline','candidate']){
  const source=fs.readFileSync(`artifacts/core-prompt/code/coding-remotion-${variant}.jsx.txt`,'utf8');
  let originalError='';try{new vm.Script(`(async()=>{${source}})()`)}catch(e){originalError=String(e);}
  if(!originalError)throw new Error('Expected to reproduce actual legacy executor error');
  const guides=['agent-coding','remotion-composition'].map(name=>{const p=`prompts/${name}.md`;const body=fs.readFileSync('src/lib/'+p,'utf8');return variant==='candidate'?bundleAgentPrompt(p,body):body}).join('\n\n');
  const core=variant==='candidate'?fs.readFileSync('src/lib/prompts/agent.md','utf8'):baseline.agent+'\n'+baseline.toolDescriptions.coding;
  let sourceNext=source,result:any=null;const attempts: Array<{passed:boolean;usage?:unknown;error?:string}>=[];
  for(let attempt=0;attempt<3;attempt++){
   const r=await generateText({model:runtime.model,system:core+'\n'+guides,providerOptions:getAgentProviderOptions(runtime),prompt:`Repair this same saved Remotion program after the real legacy outer executor failed: ${attempts.at(-1)?.error||originalError}. The outer executor uses plain JavaScript vm.Script and does not compile JSX. Keep every visual component, exact props, layout, animation, dimensions and duration. Put the complete Remotion component source in the render object's code STRING; do not evaluate JSX in the outer executor or use function.toString(). Return only the complete executable JavaScript body ending in return {type:'render',code,width,height,props,animation}, without Markdown fences.\n\n${sourceNext}`,abortSignal:AbortSignal.timeout(180_000)});
   sourceNext=r.text.trim().replace(/^```(?:javascript|js)?\n/,'').replace(/\n```$/,'');
   try{result=await new vm.Script(`(async()=>{${sourceNext}})()`).runInNewContext({}, {timeout:1000});const error=validateDesign(result);if(error)throw new Error(error);attempts.push({usage:r.usage,passed:true});break;}catch(e){attempts.push({usage:r.usage,passed:false,error:String(e)});result=null;}
  }
  const row={variant,originalError,attempts,passed:!!result};rows.push(row);
  fs.writeFileSync(`artifacts/core-prompt/code/coding-remotion-${variant}-repaired.js.txt`,sourceNext);
  if(result)fs.writeFileSync(`artifacts/core-prompt/code/composition-${variant}.json`,JSON.stringify(result,null,2));
  fs.writeFileSync('artifacts/core-prompt/code/repair-results.json',JSON.stringify({gate:'controlled syntax repair using same Agent model and unchanged creative guides; not hosted end-to-end acceptance',rows},null,2));console.log(JSON.stringify(row));
 }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
