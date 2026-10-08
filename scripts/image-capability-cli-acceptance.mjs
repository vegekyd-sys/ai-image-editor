#!/usr/bin/env node
/** Real CLI Chat acceptance. Never calls an image adapter directly. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const dir = path.join(root, 'test-results/image-capability-cli');
fs.mkdirSync(dir, { recursive: true });
const values = { ...dotenv.parse(fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.vercel-prod')), ...dotenv.parse(fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.local')) };
const env = { ...process.env, ...Object.fromEntries(Object.entries(values).map(([k,v]) => [k, v.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()])), MAKARON_URL: process.env.MAKARON_URL || 'http://127.0.0.1:3047' };
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const flare = 'gpt-image-2.5-flare', nb = 'gemini-2.1', spicy = 'qwen-spicy';
const cases = [
  ['C01','R01','默认文生图',flare,'一只冰蓝色陶瓷茶壶，黄色圆点点缀，白色摄影棚背景，方形 1:1，自动选择图片模型。'],
  ['C02','R01,R15','单图编辑',flare,'编辑上传的茶壶图片：保留茶壶形状和黄色圆点，只将背景改为浅紫色摄影棚。','C01'],
  ['C03','R01,R15','多图参考',flare,'结合两张上传参考图，保留第一张茶壶主体和第二张的浅紫色背景，生成一张新商品照。请实际使用这两张输入。',['C01','C02']],
  ['C04','R01','文字排版',flare,'生成一张方形茶壶商品海报，蓝色茶壶，奶白背景，清晰中文标题“慢下来 喝杯茶”，精致简洁排版，自动选择模型。'],
  ['C05','R02','8:1 横幅',nb,'生成冰蓝茶壶广告横幅，茶壶在左侧四分之一，右侧留白，画幅比例 8:1，必须将 aspectRatio 设为 8:1。'],
  ['C06','R02','1:8 竖图',nb,'生成从上至下的春日茶文化窄幅挂画，画幅比例 1:8，aspectRatio=1:8。'],
  ['C07','R02','4:1 横图',nb,'生成冰蓝茶壶与樱花横幅，画幅比例 4:1，aspectRatio=4:1。'],
  ['C08','R02','1:4 竖图',nb,'生成竖向陶瓷茶壶海报，比例 1:4，aspectRatio=1:4。'],
  ['C09','R03','2K',nb,'生成一张方形蓝色陶瓷茶壶图片，要求 2K 档位，请传 imageResolution=2K。'],
  ['C10','R03','4K',nb,'生成一张方形樱花树摄影作品，要求 4K 档位，请传 imageResolution=4K。'],
  ['C11','R03','显式 1K',nb,'生成一张方形茶壶摄影图，要求 1K 档位，请传 imageResolution=1K。'],
  ['C12','R08','透明文生图',flare,'生成独立的冰蓝茶壶 PNG 素材，真实透明背景，保留 alpha 通道，background=transparent，方形 1:1。'],
  ['C13','R08,R15','源图抠图',flare,'将上传的茶壶图片去背景抠图，保留原茶壶和完整画布，输出真实透明 alpha PNG，background=transparent。','C01'],
  ['C14','R09','透明与 8:1 冲突',nb,'生成茶壶广告横幅，请求 8:1 和透明背景。同时传 aspectRatio=8:1、background=transparent。这两个要求冲突时允许放宽透明，优先得到 8:1 图片，并说明实际取舍。'],
  ['C15','R05','未知模型 ID',flare,'生成一张蓝色茶壶图片。本次回归输入的 model 字符串是 obsolete-image-v999，请原样传入 generate_image.model，让能力规划处理这个未知 ID，不要在调用前替换字符串。'],
  ['C16','R05','openai 旧别名',flare,'生成蓝色茶壶图片，显式 model=openai（旧别名），将字符串原样传入工具。'],
  ['C17','R05','qwen 旧别名',spicy,'生成红色丝绸抽象纹理，显式 model=qwen（旧别名），将字符串原样传入工具。'],
  ['C18','R05','退役 pony',flare,'生成蓝色茶壶图片，model=pony 是历史偏好，请原样传入工具，让当前能力规划自动处理。'],
  ['C19','R04','显式 Sunburst','gpt-image-2.5-sunburst','使用 GPT Image 2.5 Sunburst，model=gpt-image-2.5-sunburst，生成蓝色茶壶图片。'],
  ['C20','R04','显式 Nano Banana 2.1',nb,'使用 Nano Banana 2.1，model=gemini-2.1，生成蓝色茶壶图片。'],
  ['C21','R04','显式经典 Nano Banana 2','gemini','使用经典 Nano Banana 2（不是 2.1），model=gemini，生成蓝色茶壶图片。'],
  ['C22','R04','显式 Lite','gemini-lite','使用 Nano Banana 2 Lite，model=gemini-lite，生成蓝色茶壶图片。'],
  ['C23','R04','显式 Wan','wan2.7-image','使用 Wan 2.7 Image，model=wan2.7-image，生成蓝色茶壶图片。'],
  ['C24','R06,R12','NSFW 文生图',spicy,'这是 NSFW/Spicy 路由验收，内容为安全的红色丝绸抽象纹理，没有人物。请使用 generate_image 并传 isNsfw=true，生成 1:1 图片。'],
  ['C25','R07,R12','NSFW 尺寸透明冲突',spicy,'这是 NSFW 路由验收，生成红色丝绸抽象纹理，没有人物。请传 isNsfw=true、aspectRatio=8:1、imageResolution=4K、background=transparent。尺寸和透明允许按能力放宽，必须得到 Spicy 图片。'],
  ['C26','R06,R12,R15','NSFW 图片编辑',spicy,'这是 NSFW 路由验收，编辑上传的安全茶壶图片，将背景换为红色丝绸，保留茶壶；传 isNsfw=true。','C01'],
  ['C27','R07,R12','NSFW 编辑尺寸冲突',spicy,'这是 NSFW 路由验收，编辑上传茶壶，红色丝绸背景，传 isNsfw=true、aspectRatio=8:1、imageResolution=4K、background=transparent。尺寸不重要，必须使用 Spicy 完成图片编辑。','C01'],
  ['C28','R06','显式 NSFW 跨轮',spicy,'沿用上一轮 NSFW/Spicy 模式，再将刚生成图片中的茶壶改成绿色，其他不变。','C26','C26'],
  ['C29','R11','Flare 3:1 边界',flare,'生成蓝色茶壶横幅，aspectRatio=3:1，自动选择图片模型。'],
  ['C30','R11','Flare 1:3 边界',flare,'生成蓝色茶壶竖向海报，aspectRatio=1:3，自动选择图片模型。'],
  ['C31','R13','显式 Flare 与 8:1 冲突',nb,'生成茶壶超宽横幅。本次请求 model=gpt-image-2.5-flare、aspectRatio=8:1，请原样传入，允许能力规划在提交前选择合适模型。'],
  ['C32','R11','非法比例放宽',flare,'生成蓝色茶壶图片。历史偏好 aspectRatio=0:1，请将这个字符串传入工具以验证放宽逻辑，允许按模型可用画布生成。'],
  ['C33','R11,R13','8K 偏好放宽',flare,'生成蓝色茶壶图片，本次历史偏好 imageResolution=8K，请将 8K 原样传入工具，允许放宽到模型原生输出。'],
  ['C34','R10','Spicy 四输入截断',spicy,'NSFW 路由测试。将上传图片的第一张作为底图，其余三张作为参考。必须传 isNsfw=true、media_index=1、reference_media_indices=[2,3,4]。生成红色背景蓝色茶壶，允许按 Spicy 输入上限保留前三张并说明取舍。',4],
  ['C35','R10','Flare 十六输入边界',flare,'将第1张上传图作为底图，第2至16张全部作为参考；generate_image 中传 media_index=1、reference_media_indices=[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]。生成一张茶壶商品照，保留参考色彩。',16],
  ['C36','R10','十七输入冲突放宽',flare,'将第1张上传图作为底图，第2至17张全部作为参考；generate_image 传 media_index=1、reference_media_indices=[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]。生成一张茶壶商品照，允许能力规划保留底图和最多可用参考，并说明取舍。',17],
  ['C37','R10,R13','NB 十五输入切 Flare',flare,'上传15张参考，底图 media_index=1，reference_media_indices=[2,3,4,5,6,7,8,9,10,11,12,13,14,15]，model=gemini-2.1，aspectRatio=8:1，请原样传工具；优先保留参考内容，允许放宽画幅。生成茶壶商品照。',15],
  ['C38','R09,R10','透明超宽与参考冲突',flare,'上传15张参考，media_index=1，reference_media_indices=[2,3,4,5,6,7,8,9,10,11,12,13,14,15]，请求 aspectRatio=8:1、background=transparent，请原样传工具，优先保留参考内容，允许放宽比例。生成独立茶壶透明素材。',15],
  ['C39','R10','Wan 十输入切 Flare',flare,'上传10张参考，media_index=1，reference_media_indices=[2,3,4,5,6,7,8,9,10]，model=wan2.7-image，请原样传工具；优先保留参考输入，允许提交前改变模型。生成茶壶商品照。',10],
  ['C40','R06','成人语义判断',spicy,'生成一张时尚摄影：一位明确30岁的成年女模特，穿着不透明的红色蕾丝内衣套装，全身服装覆盖，无裸露、无性行为，优雅站姿。此图属于 NSFW 成人内衣题材，请自行判断并直接用对应图片模型。'],
  ['C41','R04,R08','Sunburst 透明','gpt-image-2.5-sunburst','使用 GPT Image 2.5 Sunburst，model=gpt-image-2.5-sunburst，生成独立蓝色茶壶，background=transparent，真实透明 PNG。'],
  ['C42','R06','隐式 NSFW 跨轮',spicy,'将刚才那只茶壶改成深绿色，继续编辑同一张图，保留其他内容。',undefined,'C26'],
  ['C43','R10','NB 十四输入边界',nb,'上传14张参考，media_index=1，reference_media_indices=[2,3,4,5,6,7,8,9,10,11,12,13,14]，model=gemini-2.1、aspectRatio=8:1，原样传入。生成一张茶壶广告横幅。',14],
  ['C44','R10','Wan 九输入边界','wan2.7-image','上传9张参考，media_index=1，reference_media_indices=[2,3,4,5,6,7,8,9]，model=wan2.7-image，原样传入。生成一张茶壶商品照。',9],
  ['C45','R10','Spicy 三输入边界',spicy,'NSFW/Spicy 路由回归，安全茶壶商品图。上传3张参考，media_index=1，reference_media_indices=[2,3]、isNsfw=true，生成蓝色茶壶红色丝绸背景图片。',3],
  ['C46','R11,R12','Spicy 6:1 边界',spicy,'NSFW/Spicy 文生图路由回归，安全红色丝绸抽象纹理，无人物。isNsfw=true、aspectRatio=6:1，请原样传入。'],
  ['C47','R05','退役 wai',flare,'生成蓝色茶壶图片，model=wai 是历史偏好，请原样传入工具，让当前能力规划自动处理。'],
  ['C48','R07','Spicy 原始冲突参数',spicy,'上游历史请求兼容性回归：安全的红色丝绸抽象纹理，无人物，isNsfw=true、aspectRatio=8:1、imageResolution=4K、background=transparent。请不要提前把参数转换成 6:1 或 opaque，也不要省略 4K；原样传入 generate_image，让共享能力规划统一放宽。'],
  ['C49','R02,R15','原项目 V 8:1 复现',nb,'用上传参考图里的 V 生成一张超宽横幅，比例 8:1，用作付款二维码卡片顶部的横条。角色与参考图一致，V 在最左侧 1/4，右边 3/4 是浅蓝到白色柔和渐变留白。不要文字、字母、数字、水印或品牌 logo。比例严格 8:1，请用供应商原生画幅直接生成。','original-1'],
  ['C50','R01,R15','人脸增强默认路由',flare,'增强上传的 V 角色头像图片，保留银白长发、冰蓝衣服和橙色龙虾 pin，保持人物身份与五官。只提升脸部、发丝、材质的清晰度，不改布局，不换人，自动选择图片模型。','original-1'],
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

for(let i=1;i<=17;i++){
  const file=path.join(dir,`reference-${i}.png`);if(!fs.existsSync(file)){
    const color=['#87ceeb','#d8b4fe','#fde68a','#fecaca','#bbf7d0'][i%5];
    await sharp(Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="${color}"/><ellipse cx="230" cy="290" rx="120" ry="100" fill="#63acd7"/><path d="M330 230 Q460 200 350 325" fill="none" stroke="#63acd7" stroke-width="35"/><path d="M105 230 L30 160 L120 290" fill="#63acd7"/><ellipse cx="230" cy="198" rx="100" ry="18" fill="#3385b5"/><text x="30" y="70" font-size="40" fill="#334155">REF ${i}</text></svg>`)).png().toFile(file);
  }
  if(i<=9&&!fs.existsSync(path.join(dir,`opaque-reference-${i}.png`)))await sharp(file).removeAlpha().png().toFile(path.join(dir,`opaque-reference-${i}.png`));
}
const selected=process.argv.slice(2).filter(x=>/^C\d+$/.test(x));
const queue=manifest.filter(c=>!selected.length||selected.includes(c.id));
const results=[];
// Dependencies first. Remaining projects are independent; at most three paid runs at a time.
for(const id of ['C01','C02','C26'])if(queue.some(c=>c.id===id)||queue.some(c=>c.images===id||Array.isArray(c.images)&&c.images.includes(id)||c.projectFrom===id))results.push(await run(manifest.find(c=>c.id===id)));
let index=0;
await Promise.all(Array.from({length:3},async()=>{while(index<queue.length){const c=queue[index++];if(results.some(r=>r.id===c.id))continue;try{results.push(await run(c));}catch(e){console.log(JSON.stringify({id:c.id,error:e.message}));fs.writeFileSync(path.join(dir,`${c.id}-error.json`),JSON.stringify({id:c.id,error:e.message},null,2));}}}));
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(results.sort((a,b)=>a.id.localeCompare(b.id)),null,2));
console.log(JSON.stringify({done:results.length,passed:results.filter(r=>r.technicalPass).length,failed:results.filter(r=>!r.technicalPass).map(r=>r.id)}));
process.exit(results.length===queue.length&&results.every(r=>r.technicalPass)?0:1);
