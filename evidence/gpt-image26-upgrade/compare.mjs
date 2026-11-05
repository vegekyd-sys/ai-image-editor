import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const dir=path.dirname(new URL(import.meta.url).pathname);
const ref='/Users/tianyicai/.codex/skills/makaron-mascot-spark/assets/makaron-spark-pixel-wizard-concepts.png';
const poster='生成一张精致的中文创意软件发布海报，正方形。米白底，紫色和青色点缀。标题必须逐字准确：「灵感，一触即发」。副标题：「用 Makaron，把想法变成作品」。中央一个真实感半透明紫色玻璃立方体，立方体左侧恰好三枚小青色球，右侧恰好两枚小粉色球，不能增减。底部三列文字，顺序从左到右：「图片」「视频」「音乐」。右下角小字「2026 · 创作无界」。排版有清楚层级和充足留白，不要多余文字，不要水印。';
const mascot="Use the Makaron Spark + Pixel Wizard reference sheet for brand identity. Spark is Makaron's creative source and editing signature: magenta/cyan energy that emerges from the product UI and shows transformation. Pixel Wizard is Makaron's small purple bubble-ghost mascot and the mischievous, slightly scared guide/personification of Spark. Pixel Wizard must actively interact with Spark using his whole squishy body, not simply hold a magic wand. Avoid making Spark just a wand glow. The mascot is a sidekick, not the protagonist. Create ONE polished square advertising scene, not a contact sheet. Cream background, central smartphone showing a landscape photo editing interface; a magenta/cyan Spark ribbon emerges from the phone and transforms a gray photo into a colorful forest. Pixel Wizard, 20% of the composition, clings nervously to this ribbon with his whole squishy body; preserve the exact purple translucent ghost shape, pixel face and floppy dark-purple hat from the sheet. Soft studio lighting, integrated shadows, premium 3D material. Heading at top: MAKARON. No other text.";
const specs=[];
function add(id,version,variant,quality,reasoning,kind='poster',format='png') {specs.push({id,version,variant,quality,reasoning,kind,format});}
add('25-flare-low','2.5','flare','low');
add('26-flare-low-low','2.6','flare','low','low');
add('26-flare-low-high','2.6','flare','low','high');
for(const q of ['low','medium','high']) for(const r of ['low','medium','high','xhigh','max']) if(!specs.some(s=>s.id===`26-flare-${q}-${r}`)) add(`26-flare-${q}-${r}`,'2.6','flare',q,r);
for(const q of ['medium','high']) add(`25-flare-${q}`,'2.5','flare',q);
add('25-sunburst-low','2.5','sunburst','low');
for(const q of ['low','medium','high']) add(`26-sunburst-${q}-high`,'2.6','sunburst',q,'high');
for(const [v,f,q,r] of [['2.5','flare','low',undefined],['2.6','flare','low','high'],['2.6','flare','medium','high'],['2.6','sunburst','medium','high']]) add(`${v.replace('.','')}-${f}-${q}-mascot`,v,f,q,r,'mascot');
add('26-flare-gif','2.6','flare','medium','high','animation','gif');
add('26-flare-svg','2.6','flare','medium','high','vector','svg');
add('26-sunburst-gif-mascot','2.6','sunburst','medium','high','mascot-animation','gif');
add('26-sunburst-svg','2.6','sunburst','medium','high','vector','svg');
add('26-flare-svg-minimal','2.6','flare','low',undefined,'vector-minimal','svg');
for(const n of [2,3]){add(`25-flare-low-repeat-${n}`,'2.5','flare','low');add(`26-flare-low-high-repeat-${n}`,'2.6','flare','low','high');}
add('26-flare-auto-high','2.6','flare','auto','high');
const write=(p,o)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(o,null,2));fs.renameSync(p+'.tmp',p);};
write(path.join(dir,'manifest.json'),{created_at:new Date().toISOString(),reference:{path:ref,sha256:crypto.createHash('sha256').update(fs.readFileSync(ref)).digest('hex')},prompts:{poster,mascot,animation:'Create a seamless animated GIF of a purple rounded creative spark that gently pulses and traces a cyan circle on a cream background. Fixed camera, one clean object, smooth visible continuous motion. No text.',vector:'Create a clean editable SVG vector logo: a purple rounded cloud with three cyan diamond sparks orbiting its upper right. Cream background, crisp simple geometric paths, no raster embedded image, no text.'},estimated_usd:6.5,cap_usd:10,reserve_for_product_acceptance_usd:1.5,comparison_notes:['2.5 reasoning not exposed by this fal adapter; no reasoning_effort sent.','Same prompt/canvas/seed availability; no seed field available. One sample per tier is exploratory, not statistical quality/latency proof.','Provider total includes queue; first observed in-progress and completed times are sampled.'],specs});
const limit=Number(process.argv.find(x=>x.startsWith('--limit='))?.split('=')[1]??specs.length);
for(const s of specs.slice(0,limit)) {
 const sd=path.join(dir,s.id);fs.mkdirSync(sd,{recursive:true});const receipt=path.join(sd,'receipt.json');
 let state=fs.existsSync(receipt)?JSON.parse(fs.readFileSync(receipt)):null;
 if(!state && ['xhigh','max'].includes(s.reasoning) && s.quality!=='low') {write(receipt,{sample:s,stage:'filtered',reason:'Same exact endpoint rejected xhigh/max at low quality; do not repeat known-unsupported requests',cost_usd:0});continue;}
 if(state?.stage==='filtered')continue;
 if(state?.stage==='complete'||state?.stage==='rejected'){console.log(s.id,state.stage);continue;}
 if(state&&!state.request_id) throw new Error(`Unknown submission outcome ${s.id}; no re-POST`);
 const all=specs.map(x=>path.join(dir,x.id,'receipt.json')).filter(fs.existsSync).map(p=>JSON.parse(fs.readFileSync(p)));
 const spent=all.reduce((n,x)=>n+(x.cost_usd??0),0);
 if(!state&&spent>7.8) throw new Error('Trial reserve reached; stop before next generation.');
 const refMode=s.kind.startsWith('mascot');const endpoint=`openai/gpt-image-${s.version}/${s.variant}/${refMode?'edit':'text-to-image'}`;
 const prompt=refMode?mascot+(s.format==='gif'?' Animate the Spark ribbon flowing from the screen; Pixel Wizard wobbles nervously while clinging to it. Fixed camera, seamless loop, no contact sheet.':''):s.kind==='poster'?poster:s.kind==='animation'?'Create a seamless animated GIF of a purple rounded creative spark that gently pulses and traces a cyan circle on a cream background. Fixed camera, one clean object, smooth visible continuous motion. No text.':'Create a clean editable SVG vector logo: a purple rounded cloud with three cyan diamond sparks orbiting its upper right. Cream background, crisp simple geometric paths, no raster embedded image, no text.';
 const body={prompt,image_size:s.format==='gif'?{width:832,height:832}:{width:1024,height:1024},quality:s.quality,...(s.reasoning?{reasoning_effort:s.reasoning}:{}),background:'opaque',output_format:s.format,num_images:1,sync_mode:false,...(s.format==='gif'?{frame_count:9,frame_duration_ms:160}:{}),...(refMode?{image_urls:[`data:image/png;base64,${fs.readFileSync(ref).toString('base64')}`]}:{})};
 if(s.kind==='vector-minimal'){for(const k of ['image_size','quality','background','sync_mode'])delete body[k];}
 const headers={Authorization:`Key ${process.env.FAL_KEY}`,'Content-Type':'application/json'};
 if(!state){
  state={sample:s,endpoint,stage:'submitting',started_at:new Date().toISOString(),started_ms:Date.now(),request:{...body,...(refMode?{image_urls:['local-owned-reference:sha256-in-manifest']}:{})},submission_count:1};write(receipt,state);
  try{
   const r=await fetch(`https://queue.fal.run/${endpoint}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});const t=await r.json();
   if(!r.ok){state.stage='rejected';state.http_status=r.status;state.error=t;write(receipt,state);console.log(s.id,'rejected',r.status);continue;}
   if(!t.request_id)throw new Error('No task ID');
   const u=new URL(t.response_url??`https://queue.fal.run/${endpoint}/requests/${t.request_id}`);if(u.protocol!=='https:'||u.hostname!=='queue.fal.run'||u.search||u.username)throw new Error('Unexpected result URL');
   state.request_id=t.request_id;state.result_url=u.href;state.stage='accepted';state.accepted_ms=Date.now();write(receipt,state);
  }catch(e){state.stage='unknown';state.error_type=e.name;write(receipt,state);throw e;}
 }
 const start=Date.now();let completed=false;
 while(Date.now()-start<900000){
  try{const r=await fetch(`${state.result_url}/status`,{headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`status ${r.status}`);const t=await r.json();
   if(t.status==='IN_PROGRESS'&&!state.in_progress_ms){state.in_progress_ms=Date.now();write(receipt,state);}
   if(t.status==='COMPLETED'){state.completed_ms=Date.now();completed=true;write(receipt,state);break;}
   if(!['IN_QUEUE','IN_PROGRESS'].includes(t.status))throw new Error(`Task ${t.status}`);
  }catch(e){state.last_poll_error=e.name;write(receipt,state);}
  await new Promise(r=>setTimeout(r,2000));
 }
 if(!completed)throw new Error(`Accepted task still unresolved: ${s.id}`);
 const r=await fetch(state.result_url,{headers,signal:AbortSignal.timeout(30000)});const t=await r.json();if(!r.ok){state.stage='rejected';state.http_status=r.status;state.error=t;state.cost_usd=null;write(receipt,state);console.log(s.id,'result rejected',r.status);if(r.status===422)continue;throw new Error(`result ${r.status}`);}
 const cost=Number(r.headers.get('x-fal-billable-units'));if(!Number.isFinite(cost)||cost<=0)throw new Error('Missing billable units; stop before more spend');
 state.cost_usd=cost;state.result_received_ms=Date.now();state.provider_metrics=t.timings??t.metrics??null;write(receipt,state);
 const url=t.images?.[0]?.url;if(!url)throw new Error('No output');const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.fal.media'))throw new Error('Unexpected media host');
 const out=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!out.ok)throw new Error(`download ${out.status}`);const buf=Buffer.from(await out.arrayBuffer());fs.writeFileSync(path.join(sd,`output.${s.format}`),buf);
 state.output_sha256=crypto.createHash('sha256').update(buf).digest('hex');state.output_bytes=buf.length;state.content_type=out.headers.get('content-type');
 if(s.format!=='svg') {const m=await sharp(buf,{animated:s.format==='gif'}).metadata();state.media={format:m.format,width:m.width,height:m.pageHeight??m.height,frames:m.pages??1,delay_ms:m.delay};}
 else {const svg=buf.toString();state.media={svg:svg.includes('<svg'),embedded_raster:/<image\b|data:image/i.test(svg),paths:(svg.match(/<path\b/g)||[]).length};}
 state.total_ms=Date.now()-state.started_ms;state.stage='complete';write(receipt,state);console.log(s.id,'complete',state.total_ms+'ms','$'+cost,'cumulative $'+(spent+cost).toFixed(4));
}
