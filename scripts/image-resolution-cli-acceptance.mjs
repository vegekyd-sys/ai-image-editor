#!/usr/bin/env node
/** Real CLI Chat acceptance. Never calls an image adapter directly. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const dir = path.join(root, 'test-results/image-resolution-cli');
fs.mkdirSync(dir, { recursive: true });
const values = { ...dotenv.parse(fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.vercel-prod')), ...dotenv.parse(fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.local')) };
const env = { ...process.env, ...Object.fromEntries(Object.entries(values).map(([k,v]) => [k, v.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()])), MAKARON_URL: process.env.MAKARON_URL || 'http://127.0.0.1:3047' };
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const flare = 'gpt-image-2.5-flare', nb = 'gemini-2.1', spicy = 'qwen-spicy';
const cases = [
 ['D01','RES','Nano Banana 2.1 2K',nb,'生成一张蓝色陶瓷茶壶图片，方形1:1。明确使用model=gemini-2.1、aspectRatio=1:1、imageResolution=2K。'],
 ['D02','RES','Nano Banana 2.1 4K',nb,'生成一张樱花树摄影作品，方形1:1。明确使用model=gemini-2.1、aspectRatio=1:1、imageResolution=4K。'],
 ['F01','RES','Auto Flare 2K',flare,'生成一张冰蓝色陶瓷茶壶方形商品摄影，自动选择模型。请传aspectRatio=1:1、imageResolution=2K。'],
 ['F02','RES','Flare 4K 横图',flare,'用GPT Image 2.5 Flare生成蓝色茶壶和樱花横向摄影，model=gpt-image-2.5-flare、aspectRatio=16:9、imageResolution=4K。'],
 ['F03','RES','Flare 4K 竖图',flare,'用GPT Image 2.5 Flare生成春日樱花树竖向摄影，model=gpt-image-2.5-flare、aspectRatio=9:16、imageResolution=4K。'],
 ['F04','RES','Sunburst 2K','gpt-image-2.5-sunburst','用GPT Image 2.5 Sunburst生成冰蓝茶壶商品照，model=gpt-image-2.5-sunburst、aspectRatio=1:1、imageResolution=2K。'],
 ['F05','RES','Flare 透明编辑 2K',flare,'上传茶壶图片去背景抠图，保留主体，输出2K真实透明PNG。传imageResolution=2K、background=transparent、aspectRatio=auto，分辨率优先，不要缩回源图尺寸。','source'],
 ['F06','RES','Auto 方形 4K',nb,'生成方形樱花树摄影，自动选择能完成原生4K方图的模型。请传aspectRatio=1:1、imageResolution=4K，不要先选择不支持的模型而后处理放大。'],
];
const manifest = cases.map(([id,contract,label,model,prompt,images,projectFrom]) => ({id,contract,label,model,prompt,images,projectFrom}));
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),route:'installed makaron chat -> candidate local Next -> real Agent -> real provider -> project persistence -> CLI responses and project media',cases:manifest},null,2));

function cli(args, name) {
  return new Promise((resolve,reject) => {
    const out=fs.openSync(path.join(dir,`${name}.json`),'w'),err=fs.openSync(path.join(dir,`${name}.log`),'w');
    const child=spawn('makaron',args,{env,cwd:root,stdio:['ignore',out,err]});
    child.once('error',reject);child.once('exit',code=>{fs.closeSync(out);fs.closeSync(err);let data;try{data=JSON.parse(fs.readFileSync(path.join(dir,`${name}.json`),'utf8'));}catch{}resolve({code,data});});
  });
}
function read(name) { const p=path.join(dir,name);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):undefined; }
async function evidence(c) {
  const submit=read(`${c.id}-submit.json`);if(!submit?.runId)throw new Error(`${c.id}: no known run ID; do not resubmit automatically`);
  let result=read(`${c.id}-result.json`);
  if(!result||result.incomplete||!['completed','failed','aborted'].includes(result.status)) result=(await cli(['responses','get',submit.runId,'--wait','--json'],`${c.id}-result`)).data;
  const [events,tools,usage,snapshots]=await Promise.all([
    db.from('agent_events').select('seq,type,data,created_at').eq('run_id',submit.runId).order('seq'),
    db.from('agent_tool_history').select('tool_name,input,output,created_at').eq('run_id',submit.runId).order('created_at'),
    db.from('usage_logs').select('tool_name,model_used,credits_charged,source,run_id,project_id').eq('run_id',submit.runId),
    db.from('snapshots').select('id,image_url,metadata').eq('project_id',submit.projectId)
  ]);
  for(const r of [events,tools,usage,snapshots])if(r.error)throw new Error(`${c.id}: ${r.error.message}`);
  fs.writeFileSync(path.join(dir,`${c.id}-evidence.json`),JSON.stringify({result,events:events.data,tools:tools.data,usage:usage.data,snapshots:snapshots.data},null,2));
  const media=(await cli(['project','media',submit.projectId,'--json'],`${c.id}-media`)).data;
  const artifacts=(result?.output||[]).filter(x=>x.type==='image');const decoded=[];
  for(let i=0;i<artifacts.length;i++){
    const a=artifacts[i];const bytes=Buffer.from(await (await fetch(a.url)).arrayBuffer());
    const m=await sharp(bytes).metadata();await sharp(bytes).raw().toBuffer();
    const file=path.join(dir,`${c.id}${i?`-${i+1}`:''}.png`);await sharp(bytes).png().toFile(file);
    let transparentPixels=0;if(m.hasAlpha){const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(let j=3;j<data.length;j+=info.channels)if(data[j]<255)transparentPixels++;}
    decoded.push({snapshotId:a.snapshot_id,url:a.url,file,width:m.width,height:m.height,format:m.format,hasAlpha:m.hasAlpha,transparentPixels,persisted:snapshots.data.some(s=>s.id===a.snapshot_id&&s.image_url===a.url),reopened:JSON.stringify(media).includes(a.snapshot_id)});
  }
  const actualModels=events.data.filter(x=>x.type==='image').map(x=>x.data.usedModel);
  const imageUsage=usage.data.filter(x=>x.tool_name!=='agent');
  const billedAliases={ 'gemini-2.1':['gemini-2.1','google/gemini-nano-banana-2.1'], gemini:['gemini','gemini-3-pro-image-preview','google/gemini-3-pro-image','google/gemini-3.1-flash-image-preview'], 'gemini-lite':['gemini-lite','google/gemini-2.5-flash-image','google/gemini-3.1-flash-image-preview','google/gemini-3.1-flash-lite-image'] };
  const r={...c,runId:submit.runId,projectId:submit.projectId,projectUrl:submit.projectUrl,status:result?.status,actualModels,images:decoded,toolCalls:tools.data.filter(x=>x.tool_name==='generate_image').map(x=>({input:x.input,output:x.output})),imageUsage,usage:result?.usage,text:result?.result?.text,technicalPass:result?.status==='completed'&&decoded.length===1&&actualModels.length===1&&actualModels[0]===c.model&&decoded.every(x=>x.persisted&&x.reopened)&&imageUsage.length===1&&imageUsage.every(x=>x.source==='cli'&&(billedAliases[c.model]||[c.model]).includes(x.model_used))};
  fs.writeFileSync(path.join(dir,`${c.id}-receipt.json`),JSON.stringify(r,null,2));
  console.log(JSON.stringify({id:c.id,label:c.label,status:r.status,models:actualModels,dimensions:decoded.map(x=>`${x.width}x${x.height}`),alpha:decoded.map(x=>x.transparentPixels),pass:r.technicalPass}));return r;
}
async function run(c){
  if(fs.existsSync(path.join(dir,`${c.id}-receipt.json`)))return process.argv.includes('--refresh')?evidence(c):read(`${c.id}-receipt.json`);
  if(!fs.existsSync(path.join(dir,`${c.id}-submit.json`))){
    const args=['chat','--project',c.projectFrom?read(`${c.projectFrom}-submit.json`).projectId:'auto','--agent-model','gpt-6-luna','-b','--json'];
    const inputs=typeof c.images==='number'?Array.from({length:c.images},(_,i)=>path.join(dir,`${c.id==='C44'?'opaque-reference':'reference'}-${i+1}.png`)):Array.isArray(c.images)?c.images.map(id=>path.join(dir,`${id}.png`)):c.images?[path.join(dir,`${c.images}.png`)]:[];
    for(const file of inputs)args.push('--image',file);
    args.push(`图片能力回归 ${c.id}。${c.prompt} 请直接执行生成，仅生成一张图片，不要视频、design 或 run_code，不要为了达到尺寸用后处理或拼背景。无额外文字或水印（有标题要求的 case 除外）。若已提交供应商后失败，报告原因并停止，不要重发或换模型。`);
    const submitted=await cli(args,`${c.id}-submit`);if(!submitted.data?.runId)throw new Error(`${c.id}: submission failed, check log; do not duplicate unknown submission`);
  }
  return evidence(c);
}

const selected=process.argv.slice(2).filter(x=>/^[DF]\d+$/.test(x));
const queue=manifest.filter(c=>!selected.length||selected.includes(c.id));
const results=[];
// Dependencies first. Remaining projects are independent; at most three paid runs at a time.
for(const id of ['C01','C02','C26'])if(queue.some(c=>c.id===id)||queue.some(c=>c.images===id||Array.isArray(c.images)&&c.images.includes(id)||c.projectFrom===id))results.push(await run(manifest.find(c=>c.id===id)));
let index=0;
await Promise.all(Array.from({length:3},async()=>{while(index<queue.length){const c=queue[index++];if(results.some(r=>r.id===c.id))continue;try{results.push(await run(c));}catch(e){console.log(JSON.stringify({id:c.id,error:e.message}));fs.writeFileSync(path.join(dir,`${c.id}-error.json`),JSON.stringify({id:c.id,error:e.message},null,2));}}}));
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(results.sort((a,b)=>a.id.localeCompare(b.id)),null,2));
console.log(JSON.stringify({done:results.length,passed:results.filter(r=>r.technicalPass).length,failed:results.filter(r=>!r.technicalPass).map(r=>r.id)}));
process.exit(results.length===queue.length&&results.every(r=>r.technicalPass)?0:1);
