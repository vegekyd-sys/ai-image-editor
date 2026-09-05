import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createTools } from '../../src/lib/agent-tools';
import { bundleAgentPrompt, AGENT_PROMPT_BUNDLES } from '../../src/lib/agent-prompt-bundles';

async function main() {
 const read=(p:string)=>fs.readFileSync(p,'utf8');
 const baseline=JSON.parse(read('benchmarks/core-prompt/baseline.json'));
 const core=read('src/lib/prompts/agent.md');
 const video=bundleAgentPrompt('prompts/animate.md',read('src/lib/prompts/animate.md'));
 const coding=bundleAgentPrompt('prompts/agent-coding.md',read('src/lib/prompts/agent-coding.md'));
 const effective=[core,video,coding].join('\n\n');
 const paragraphs=baseline.agent.split(/\n\s*\n/).filter((s:string)=>s.trim());
 const coverage=paragraphs.map((text:string,index:number)=>({id:`core-${index+1}`,text,owner:core.includes(text)?'core':video.includes(text)?'video':coding.includes(text)?'coding':null}));
 assert.deepEqual(coverage.filter((x:any)=>!x.owner),[], 'Every original core paragraph needs an exact owner');
 assert.ok(video.includes(baseline.toolDescriptions.video));
 assert.ok(coding.includes(baseline.toolDescriptions.coding));
 assert.ok(coding.includes(baseline.workspaceAuthoring));
 for(const [p,hash]of Object.entries(baseline.protectedFiles))assert.equal(createHash('sha256').update(read(p)).digest('hex'),hash,`Creative contract changed: ${p}`);
 assert.equal(bundleAgentPrompt('skills/custom/SKILL.md','user content'),'user content');
 assert.equal(bundleAgentPrompt('prompts/image.md','image content'),'image content');
 assert.ok(!core.includes('Reference video size:'));
 assert.ok(core.includes("read_file('prompts/animate.md')"));
 assert.ok(core.includes('Before writing or executing code, read `prompts/agent-coding.md`'));
 assert.ok(!core.includes('Return exactly one supported shape'));
 assert.ok(!video.includes('[Bundled contract: prompts/coding'));
 const ctx:any={currentImage:'',projectId:'prompt-contract-check',snapshotImages:[],explicitMediaIndices:[],currentSnapshotIndex:0};
 const runtime:any={spec:{supportsImageInput:true},model:{}};
 const tools=createTools(ctx,runtime);
 for(const guide of Object.keys(AGENT_PROMPT_BUNDLES)){
  const result:any=await tools.read_file.execute!({path:guide},{} as any);
  assert.ok(!result.error,result.error);
  for(const part of AGENT_PROMPT_BUNDLES[guide])assert.ok(result.content.includes(part.content),`Missing ${part.path} from real read_file`);
  const modelOutput:any=await tools.read_file.toModelOutput!({output:result} as any);
  for(const part of AGENT_PROMPT_BUNDLES[guide])assert.ok(JSON.stringify(modelOutput).includes(JSON.stringify(part.content).slice(1,-1)),`Missing ${part.path} in model output`);
 }
 assert.ok(!String(tools.generate_animation.description).includes(baseline.toolDescriptions.video));
 assert.ok(!String(tools.run_code.description).includes(baseline.toolDescriptions.coding));
 assert.ok(effective.includes('Do not shorten narration, scenes, animation, or visual detail'));
 fs.mkdirSync('docs/core-prompt-refactor',{recursive:true});
 fs.writeFileSync('docs/core-prompt-refactor/rule-ownership.json',JSON.stringify({baseline:baseline.revision,coverage,protectedFiles:baseline.protectedFiles},null,2)+'\n');
 console.log(JSON.stringify({passed:true,coreParagraphs:coverage.length,protectedCreativeFiles:Object.keys(baseline.protectedFiles).length,actualReadFileBundles:2}));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
