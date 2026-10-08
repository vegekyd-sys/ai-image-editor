#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const dir=path.join(process.cwd(),'test-results/image-capability-cli');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=fs.readdirSync(dir).filter(f=>/^C\d+-receipt\.json$/.test(f)).sort().map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
const negatives=fs.readdirSync(dir).filter(f=>/^N\d+-receipt\.json$/.test(f)).sort().map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
const visualFile=path.join(dir,'visual-review.json');const visual=fs.existsSync(visualFile)?JSON.parse(fs.readFileSync(visualFile)):{};
const alphaIds=['C12','C13','C38','C41'];
const aspect={C05:8,C06:1/8,C07:4,C08:1/4,C14:8,C29:3,C30:1/3,C31:8,C43:8,C46:6,C49:8};
for(const r of rows){
  r.acceptanceIssues=[];
  r.coverageNotes=[];
  if(!r.technicalPass)r.acceptanceIssues.push('技术链路未通过');
  if(alphaIds.includes(r.id)&&!r.images.some(x=>x.transparentPixels>0))r.acceptanceIssues.push('缺少真实透明像素');
  if(aspect[r.id]&&r.images.some(x=>Math.abs((x.width/x.height)/aspect[r.id]-1)>.06))r.acceptanceIssues.push('画布比例偏差超出供应商预设容差');
  if(r.id==='C09'&&r.images.some(x=>Math.max(x.width,x.height)<2000))r.acceptanceIssues.push('未达到2K');
  if(r.id==='C10'&&r.images.some(x=>Math.max(x.width,x.height)<4000))r.acceptanceIssues.push('未达到4K');
  const input=r.toolCalls[0]?.input||{};
  const requests={C15:{model:'obsolete-image-v999'},C18:{model:'pony'},C47:{model:'wai'},C27:{isNsfw:true,aspectRatio:'8:1',imageResolution:'4K',background:'transparent'},C48:{isNsfw:true,aspectRatio:'8:1',imageResolution:'4K',background:'transparent'},C32:{aspectRatio:'0:1'},C33:{imageResolution:'8K'}};
  if(requests[r.id])for(const [k,v]of Object.entries(requests[r.id]))if(input[k]!==v)r.coverageNotes.push(`原始参数 ${k}=${v} 未到工具入口（Agent提前调整）；实际输出仍按需求单独验收`);
  const inputCounts={C34:4,C35:16,C36:17,C37:15,C38:15,C39:10,C43:14,C44:9,C45:3};
  if(inputCounts[r.id]&&(input.media_index!==1||input.reference_media_indices?.length!==inputCounts[r.id]-1))r.coverageNotes.push('Agent在工具入口前调整了参考数量；共享规划的原始输入边界不是本条实测证据');
  r.visual=visual[r.id]||{status:'pending',note:'尚未人工查看'};
  r.acceptancePass=r.acceptanceIssues.length===0&&r.visual.status==='pass';
}
fs.writeFileSync(path.join(dir,'acceptance-results.json'),JSON.stringify({route:'Makaron CLI Chat',cases:rows,negativeCases:negatives},null,2));
const cards=[];
for(const r of rows){
  const pics=[];for(const [i,img]of r.images.entries()){
    const thumb=path.join(dir,`${r.id}-thumb-${i}.png`);await sharp(img.file).resize(480,300,{fit:'inside',withoutEnlargement:true}).png().toFile(thumb);
    const data=fs.readFileSync(thumb).toString('base64');pics.push(`<a href="${esc(img.file)}"><img src="data:image/png;base64,${data}" alt="${esc(r.label)}"></a><p>${img.width}×${img.height} · alpha ${img.transparentPixels} · 保存 ${img.persisted?'✓':'×'} / 重新读取 ${img.reopened?'✓':'×'}</p>`);
  }
  cards.push(`<article class="${r.acceptancePass?'pass':r.acceptanceIssues.length||r.visual.status==='warning'?'fail':'pending'}" data-state="${r.acceptancePass?'pass':r.acceptanceIssues.length||r.visual.status==='warning'?'fail':'pending'}"><h2>${r.id} ${esc(r.label)}</h2><p>${esc(r.contract)} · ${esc(r.actualModels.join(', ')||'无图片')} · ${r.usage?.credits_net??0} credits</p><div class="image">${pics.join('')||'<p>未交付最终图片</p>'}</div><p>${esc(r.acceptanceIssues.join('；')||r.visual.note)}</p><details><summary>请求与执行记录</summary><pre>${esc(JSON.stringify({prompt:r.prompt,toolCalls:r.toolCalls,coverageNotes:r.coverageNotes,visual:r.visual},null,2))}</pre></details><p><a href="${esc(r.projectUrl)}">项目</a> · <a href="${esc(path.join(dir,`${r.id}-receipt.json`))}">验收记录</a></p></article>`);
}
const fixtureReceipt=path.join(dir,'C44-initial-invalid-fixture/C44-receipt.json');
const fixtureCredits=fs.existsSync(fixtureReceipt)?JSON.parse(fs.readFileSync(fixtureReceipt)).usage?.credits_net||0:0;
const count={tested:rows.length,delivered:rows.filter(r=>r.images.length).length,technicalPass:rows.filter(r=>r.technicalPass).length,acceptancePass:rows.filter(r=>r.acceptancePass).length,negativeTested:negatives.length,negativePass:negatives.filter(r=>r.technicalPass).length,credits:rows.reduce((s,r)=>s+(r.usage?.credits_net||0),0)+negatives.reduce((s,r)=>s+r.usage.reduce((a,u)=>a+u.credits_charged,0),0)+fixtureCredits,fixtureCorrectionCredits:fixtureCredits};
const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><title>Makaron 图片能力 CLI Chat 实图验收</title><style>body{margin:0;background:#f2f3f5;color:#19222d;font:15px system-ui;padding:30px}header{max-width:1100px;margin:0 auto 24px}h1{font-size:30px}button{padding:10px;margin:6px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:20px}article{padding:18px;background:white;border:2px solid #e0b559;border-radius:12px}article.pass{border-color:#68a890}article.fail{border-color:#d27676}h2{font-size:19px;margin:0 0 8px}.image{background:repeating-conic-gradient(#e1e4e8 0% 25%,#f5f6f7 0% 50%) 50%/20px 20px;min-height:170px;padding:10px;text-align:center}.image img{max-width:100%;max-height:300px;object-fit:contain}pre{white-space:pre-wrap;font-size:12px;overflow-wrap:anywhere}a{color:#336d9f}</style><header><h1>Makaron 图片能力：CLI Chat 最终图片验收</h1><p>${new Date().toISOString()} · 候选本地服务；未上线。正向全部为真实 CLI Chat / Agent / 供应商 / 保存 / 重新读取。</p><p>测试 ${count.tested} · 交付图片 ${count.delivered} · 技术通过 ${count.technicalPass} · 完整验收通过 ${count.acceptancePass} · 总计 ${count.credits} credits</p><p>负向故障注入 ${count.negativeTested} 项、通过 ${count.negativePass}。GUI/Tips 与结构合同使用自动化测试，未冒充 CLI 端到端覆盖。</p><button onclick="filter('all')">全部</button><button onclick="filter('pass')">通过</button><button onclick="filter('fail')">失败/覆盖不足</button><button onclick="filter('pending')">待视觉确认</button></header><main class="grid">${cards.join('')}</main><script>function filter(s){document.querySelectorAll('article').forEach(a=>a.hidden=s!=='all'&&a.dataset.state!==s)}</script></html>`;
fs.writeFileSync(path.join(dir,'report.html'),html);fs.writeFileSync(path.join(dir,'counts.json'),JSON.stringify(count,null,2));
// Render contact sheets with final artifacts on a checkerboard, preserving aspect ratios.
const tileW=420,tileH=340,cols=3;
for(let start=0;start<rows.length;start+=12){const group=rows.slice(start,start+12),height=Math.ceil(group.length/cols)*tileH;const layers=[];
  const bg=Buffer.from(`<svg width="${tileW*cols}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#f4f5f7"/><path d="M0 0h10v10H0zM10 10h10v10H10z" fill="#dddfe4"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`);
  for(const [idx,r]of group.entries()){const left=(idx%cols)*tileW,top=Math.floor(idx/cols)*tileH;
    const label=Buffer.from(`<svg width="420" height="60" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="60" fill="${r.acceptanceIssues.length?'#fbe6e6':'#edf4f0'}"/><text x="12" y="25" font-size="18" font-family="Arial">${esc(r.id+' '+r.label)}</text><text x="12" y="47" font-size="13" font-family="Arial">${esc(r.actualModels.join(', ')||'NO IMAGE')} ${r.images[0]?r.images[0].width+'x'+r.images[0].height:''}</text></svg>`);layers.push({input:label,left,top});
    if(r.images[0]){const {data,info}=await sharp(r.images[0].file).resize(tileW-20,tileH-80,{fit:'inside'}).png().toBuffer({resolveWithObject:true});layers.push({input:data,left:left+Math.round((tileW-info.width)/2),top:top+60+Math.round((tileH-60-info.height)/2)});}
  }
  await sharp(bg).composite(layers).png().toFile(path.join(dir,`contact-sheet-${Math.floor(start/12)+1}.png`));
}
console.log(JSON.stringify(count));
