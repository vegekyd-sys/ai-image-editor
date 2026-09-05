"""Build an owner-private, mobile blind gallery from local QA artifacts only.
No logs, signed provider URLs, credentials, or project identifiers are published.
"""
import hashlib, json, pathlib, shutil, sys

root = pathlib.Path('artifacts/core-prompt/acceptance').resolve()
site = pathlib.Path(sys.argv[1]).resolve()
out = site / 'out'
media = out / 'acceptance'
media.mkdir(parents=True, exist_ok=True)
if not (out / 'architecture.html').exists():
    shutil.copy2(out / 'index.html', out / 'architecture.html')

def read(p, fallback=None):
    return json.loads(p.read_text()) if p.exists() else fallback

def asset(p):
    if not p.exists(): return None
    # Content hash avoids disclosing baseline/candidate in media filenames.
    name = hashlib.sha256(p.read_bytes()).hexdigest()[:20] + p.suffix
    shutil.copy2(p, media / name)
    return 'acceptance/' + name

sources = {p.name: asset(p) for p in (root / 'inputs').iterdir() if p.suffix in ['.jpg','.webp','.mp4']}
meta = {
 'accept-image-local': ('图片','领结局部改色','只将黄色改红色，黑色条纹、狗狗与房间不变。','dog.webp'),
 'accept-image-identity': ('图片','海报袖口改色','只改粉色袖口，脸、文字、照片、构图和边框保持不变。','poster.jpg'),
 'accept-image-enhance': ('图片','专业增强','看光影、通透感与质感，同时保持狗狗身份和房间。','dog.webp'),
 'accept-image-creative': ('图片','趣味创意','新增内容要与原图有因果关系，狗狗与领结保真。','dog.webp'),
 'accept-image-wild': ('图片','夸张变形','仅夸张已有坐垫，保留狗狗、领结；不要新增文字。','dog.webp'),
 'accept-image-caption': ('图片','准确中文','添加「今天也要开心」，其他画面不变。','dog.webp'),
 'accept-image-cutout': ('图片','透明抠图','真实透明背景、毛发边缘、原始主体形状与位置不变。','dog.webp'),
 'accept-image-restore': ('图片','人像身份恢复','用原始人像恢复海报中的脸，其他海报内容不变。','poster.jpg'),
 'accept-video-t2v': ('视频','溪流文生视频','5秒森林溪流、镜头前进、水声与鸟声，无字幕。',None),
 'accept-video-action': ('视频','连续动作','10秒：猫从地板走近窗台、跳上去、趴下休息。',None),
 'accept-video-i2v': ('视频','横屏图生 · 修复前','方图生成5秒横屏狗狗歪头；检查实际画幅。','dog.webp'),
 'accept-video-dialogue': ('视频','原生中文对白','5秒咖啡馆人物说「今天也要开心」，不加字幕和音乐。',None),
 'multi': ('视频','多图先合首帧','狗狗放入粉色球场，H3 Max生成5秒1:1视频；主体、领结保真。','dog.webp'),
 'i2v-canvas-fix': ('视频','横屏图生 · 修复后','先准备横版首帧再用H3 Max生成；看比例和身份。','dog.webp'),
 'replicate': ('视频','严格视频复刻','把橘猫换成黑白猫，镜头、动作时点、房间、光线不变。','cat-source.mp4'),
 'long-followup': ('视频','30秒故事 · 补发继续后','三段故事的角色、房间、动作接缝与完整收束。首次运行未自动拼接。','dog.webp'),
 'repair-followup': ('视频','局部修复 · 补发继续后','仅2–3秒加蓝围巾，窗口外画面与全程原声不变。首次运行只返回补丁。','cat-source.mp4'),
 'remotion': ('编码','可编辑标题动画','5秒9:16奶油白、深绿字、粉色花瓣，标题和副标题完整清晰。',None),
 'splice': ('编码','可编辑视频拼接','两个完整5秒素材按顺序拼接，总长10秒，16:9且保留原声。','cat-source.mp4'),
 'title-patched': ('编码','保存改字后的导出','两版均改成「春日开场」。旧版经Agent修改、候选经编辑器修改，操作路径不同，仅检查结果。',None),
}
groups = {}
def add(case, variant, repeat, p, kind, probe=None, model=None):
    if case not in meta:
        if case.startswith('accept-video-') and 'edit' in case:
            meta[case]=('视频','Grok源视频编辑','橘猫加蓝色围巾，保持源片动作、房间和5秒时长。','cat-source.mp4')
        else: return
    key=f'{case}-{repeat}'
    group,title,criteria,source=meta[case]
    row=groups.setdefault(key,dict(id=key,case=case,group=group,title=title,criteria=criteria,repeat=repeat,source=sources.get(source),reference=sources.get('reference-face.jpg') if case=='accept-image-restore' else None,items={}))
    row['items'][variant]={'src':asset(p) if p else None,'kind':kind,'probe':probe,'model':model}

for folder in ['image-outputs','video-outputs','edit-outputs']:
    for r in read(root/folder/'manifest.json',[]):
        add(r['case'],r['variant'],r['repeat'],root/folder/r['path'] if r.get('path') else None,'image' if folder=='image-outputs' else 'video',r.get('probe'),r.get('model'))
for r in read(root/'workflow-outputs/manifest.json',[]):
    if r['type']=='video' and r['scenario'] in meta:
        add(r['scenario'],r['variant'],r['repeat'],root/r['path'],'video',r.get('probe'))
for r in read(root/'composition-outputs/manifest.json',[]):
    if r.get('path'):add(r['scenario'],r['variant'],r['repeat'],root/'composition-outputs'/r['path'],'video',r.get('probe'))
for v in ['baseline','candidate']:
    p=root/'coding-outputs'/('composition-baseline-patched.mp4' if v=='baseline' else 'composition-candidate.mp4')
    if p.exists():add('title-patched',v,0,p,'video')
pairs=[]
for row in groups.values():
    order=['baseline','candidate']
    if int(hashlib.sha256(row['id'].encode()).hexdigest()[:2],16)%2:order.reverse()
    row['items']=[dict(row['items'].get(v,{'src':None,'kind':'image'}),version=v)for v in order]
    pairs.append(row)
pairs.sort(key=lambda r:(['图片','视频','编码'].index(r['group']),list(meta).index(r['case']),r['repeat']))
(out/'acceptance-data.json').write_text(json.dumps({'pairs':pairs},ensure_ascii=False))
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Core Prompt · 实物验收</title>
<style>:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24352e;background:#f3f3ed;line-height:1.65}*{box-sizing:border-box}body{margin:0}main{max-width:1040px;margin:auto;padding:32px 20px 90px}h1{font-size:clamp(30px,6vw,48px);line-height:1.18;letter-spacing:-1.5px;margin:18px 0}h2{font-size:23px;margin:10px 0}p{color:#52635a}a{color:#32664d}header small,.eyebrow{letter-spacing:2px;font-size:12px;font-weight:700}section{background:#fff;border:1px solid #dbe2d8;border-radius:20px;padding:24px;margin:20px 0}.status{background:#fff2d7;border:1px solid #e7cb90;padding:14px 18px;border-radius:12px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metrics div{padding:16px 0}.metrics b{display:block;font-size:26px}.metrics span{font-size:13px;color:#65776b}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img,video{width:100%;max-height:570px;object-fit:contain;border-radius:12px;background:repeating-conic-gradient(#e3e6df 0% 25%,#f5f6f2 0% 50%) 0/20px 20px}figcaption{font-weight:700;margin:8px 0}video{background:#17221b}button,select{font:inherit;border:1px solid #c7d3c9;border-radius:10px;padding:10px 14px;background:#fff;color:#244333;cursor:pointer;min-height:46px}button:hover,button[aria-pressed=true]{background:#244f3c;color:white}button:disabled{opacity:.4;cursor:default}.controls,.votes,.filters{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.votes button{flex:1}select{max-width:100%}.muted{font-size:13px;color:#6a776e}.missing{padding:70px 20px;background:#f5eee1;border-radius:12px}details{margin:15px 0}summary{cursor:pointer;min-height:38px;padding:6px 0}.source{max-width:420px}.notice{color:#754b19}textarea{width:100%;min-height:120px;padding:12px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px;text-align:left;border-bottom:1px solid #e2e6e0}#result{min-height:24px}nav{display:flex;gap:20px;margin:18px 0}footer{font-size:13px;color:#65766a}@media(max-width:650px){.pair{grid-template-columns:1fr}.metrics b{font-size:22px}section{padding:18px}main{padding:24px 14px 70px}.votes button{padding:10px 7px}.metrics{gap:6px}video{max-height:430px}}
</style><main><header><small>MAKARON / CORE PROMPT</small><h1>结构减负，<br>用实际作品验收。</h1><p>同一请求、同一素材、同一模型，交错运行新旧两版。图片与主要短视频各做三轮，失败样本保留。</p><div class="status"><b>验收尚未通过。</b> 已完成多组真实输出与导出检查；严格图片保真、异步任务收尾和局部修复仍有失败，不能据此上线或承诺全场景无损。</div><nav><a href="#review">开始盲看</a><a href="#evidence">查看检查结果</a><a href="architecture.html">前一阶段报告</a></nav></header>
<section><div class="metrics"><div><b>−37.2%</b><span>Core 字符 11,875 → 7,455</span></div><div><b>−22.4%</b><span>system + tools 102,578 → 79,576</span></div><div><b>54 / 12</b><span>54段规则可追溯 / 12份创作文件未改</span></div></div><p class="muted">这里是提示词体积变化，不等于速度提升比例。第一轮媒体来自结构候选；“横屏图生·修复后”来自补强画幅与多图读取规则的候选。完整产品未合并、未部署。</p></section>
<section id="review"><span class="eyebrow">BLIND REVIEW</span><h2>先看作品，再揭晓版本</h2><p>每组 A/B 位置已打乱。手机上按上下顺序观看；视频请开启声音。评分仅保存在当前浏览器，完成后可复制给我。</p><div class="filters"><select id="category" aria-label="选择类别"><option>全部</option><option>图片</option><option>视频</option><option>编码</option></select><select id="case" aria-label="选择案例"></select></div><div id="content"></div><div class="votes"><button data-vote="A">A 更好</button><button data-vote="equal">差不多</button><button data-vote="B">B 更好</button><button data-vote="both_bad">都没达标</button></div><div id="result" role="status"></div><div class="controls"><button id="prev">上一组</button><button id="next">下一组</button><button id="copy">复制评分</button><button id="download">下载评分</button></div><p id="progress" class="muted"></p><textarea id="export" hidden readonly aria-label="评分结果，可手动复制"></textarea></section>
<section id="evidence"><h2>实际检查结果</h2><table><tr><th>范围</th><th>结果与限制</th></tr><tr><td>图片</td><td>48次捕获，47张真实输出；候选一次漏读指南，补强后3/3复测通过。局部改色、增强可对照；海报、身份恢复、文字叠加、抠图仍有未请求变化。Wild有一次模型在明确禁止文字的请求下添字。</td></tr><tr><td>H3 Max</td><td>480p实测。动作6段完成顺序；对白6段ASR均匹配「今天也要开心」。画幅修复前两版均有失败；修复后候选3/3输出864×480，旧版3/3仍为480×480。864×480是模型尺寸对齐，非数学精确16:9。</td></tr><tr><td>多图视频</td><td>6次完整首帧→H3出片；原候选1次、旧版1次画幅错误，单靠传参不能验收。</td></tr><tr><td>视频编辑</td><td>Grok源编辑6段均约4.71秒，未保住源片5秒。局部修复首次双方仅返回补丁；补发继续后虽有整片，候选视频流仅4.68秒、容器靠音频达到5秒；旧版约4.96秒。窗口外帧相似度和音频也未通过严格保留。</td></tr><tr><td>长视频</td><td>双方各生成3段H3，但首次均未自动拼接。补发继续后得到30秒方形成片。因首轮已发现阻断，暂未继续付费做第2、3轮；不能计作自动完成通过。</td></tr><tr><td>编码</td><td>6份Remotion标题动画已实际执行、发布、导出、完整解码；3组可编辑双视频拼接另行检查导出。原始作品1080×1920，当前默认导出档为720×1280，不能声称已验证1080p导出。</td></tr><tr><td>保存与改字</td><td>候选在真实编辑器改为「春日开场」，刷新后仍显示新标题并完成导出。旧版经Agent改字、重开编辑器也显示新标题，但形成新快照；这两条修改路径不同，不作为速度A/B。</td></tr><tr><td>精确分割</td><td>6次工作流共12段文件，均实际执行并得到2秒和3秒MP4，1280×720、有音轨、完整解码。</td></tr></table><p>画面审阅采用原图对照与抽帧，音频包含ASR和轨道检查。最终审美偏好、全帧动作自然度、口型同步仍需播放盲看，未使用模型自评分宣称全面无损。</p><details><summary>模型与比较边界</summary><p>生成使用 MiniMax H3 Max 480p；源码视频编辑使用 Grok；严格复刻使用可接收原视频的 SeeDance Mini 480p。Grok局部修复实际走现有订阅通道，直接源编辑走API，两类单独比较。长视频旧版一次图片生成发生OpenAI→Gemini回退，该素材步骤不计同模型胜负。</p><p>当前Makaron的H3接入支持文生及单首帧图生；多图先合成首帧。模型网站上的其他接口能力不等于当前产品已经接入。</p><p><a href="https://fal.ai/models/minimax/h3-max-turbo/text-to-video">H3 Max 模型页</a> · <a href="https://docs.x.ai/developers/models/grok-imagine-video">Grok 官方接口说明</a></p></details></section>
<section><h2>验收门槛</h2><p>硬约束逐项通过，关键场景没有已知退化，失败恢复能走到最终交付，再讨论上线。三轮小样本能暴露问题，不能证明所有未来任务都无损；不能用平均美观分抵消一次身份、画幅或时长失败。</p><p id="speed-note">普通请求速度复测正在独立汇总；不把媒体供应商渲染时间算作提示词加速。</p></section><footer>2026-09-05 · 独立测试项目 · 仅本人可见的报告 · 原始凭据、日志、签名下载链接未发布</footer></main>
<script>
let pairs=[],visible=[],current=0;let votes={};try{votes=JSON.parse(localStorage.getItem('core-acceptance-v2')||'{}')}catch{}
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const media=x=>!x.src?'<div class="missing">本轮无可比输出：路由未通过或只完成了前置步骤。未用其他样本替补。</div>':x.kind==='video'?`<video controls playsinline preload="none" src="${esc(x.src)}"></video>`:`<a href="${esc(x.src)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(x.src)}" alt="本轮生成结果，点击看原图"></a>`;
function render(){const r=visible[current];if(!r)return;$('#case').value=r.id;history.replaceState(null,'','#review-'+r.id);$('#content').innerHTML=`<h2>${esc(r.title)} · 第${r.repeat+1}轮</h2><p>${esc(r.criteria)}</p>${r.source?`<details><summary>查看原始素材</summary><div class="source">${media({src:r.source,kind:r.source.endsWith('.mp4')?'video':'image'})}${r.reference?media({src:r.reference,kind:'image'}):''}</div></details>`:''}<div class="pair">${r.items.map((x,i)=>`<figure><figcaption>${i?'B':'A'}</figcaption>${media(x)}</figure>`).join('')}</div><details><summary>揭晓本组版本与文件信息</summary>${r.items.map((x,i)=>`<p>${i?'B':'A'} = ${x.version==='candidate'?'重构候选':'旧版'}${x.model?' · '+esc(x.model):''}${x.probe?' · '+esc(x.probe.width)+'×'+esc(x.probe.height)+(x.probe.duration?' · '+esc(x.probe.duration)+'秒':''):''}</p>`).join('')}</details>`;$('#prev').disabled=current===0;$('#next').disabled=current===visible.length-1;$('#result').textContent=votes[r.id]?'已保存：'+({A:'A 更好',B:'B 更好',equal:'差不多',both_bad:'都没达标'}[votes[r.id]]):'尚未评分';document.querySelectorAll('[data-vote]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.vote===votes[r.id])));$('#progress').textContent=`当前类别 ${current+1}/${visible.length} 组 · 全部已评 ${Object.keys(votes).length}/${pairs.length} 组`}
function filter(){visible=pairs.filter(r=>$('#category').value==='全部'||r.group===$('#category').value);$('#case').innerHTML=visible.map(r=>`<option value="${esc(r.id)}">${esc(r.title)} · ${r.repeat+1}</option>`).join('');current=0;render()}
$('#category').onchange=filter;$('#case').onchange=()=>{current=visible.findIndex(r=>r.id===$('#case').value);render()};$('#prev').onclick=()=>{current--;render()};$('#next').onclick=()=>{current++;render();$('#review').scrollIntoView({behavior:'smooth'})};document.querySelectorAll('[data-vote]').forEach(b=>b.onclick=()=>{votes[visible[current].id]=b.dataset.vote;try{localStorage.setItem('core-acceptance-v2',JSON.stringify(votes))}catch{}render()});
const exported=()=>JSON.stringify({report:'Core Prompt acceptance 2026-09-05',ratings:votes},null,2);$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(exported());$('#result').textContent='评分已复制，可以粘贴给我。'}catch{$('#export').hidden=false;$('#export').value=exported();$('#export').select();$('#result').textContent='请从下方文本框手动复制。'}};$('#download').onclick=()=>{const u=URL.createObjectURL(new Blob([exported()],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='core-prompt-ratings.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
fetch('acceptance-data.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{const wanted=location.hash.replace('#review-','');pairs=d.pairs;filter();const i=visible.findIndex(r=>r.id===wanted);if(i>=0){current=i;render()}}).catch(()=>$('#content').textContent='报告数据加载失败，请刷新重试。');
</script></html>'''
speed=read(pathlib.Path('docs/core-prompt-refactor/acceptance-speed.json'),{})
if speed:
    names={'chat-greeting':'问候','chat-rewrite':'简短改写','image-direct':'直接编辑','image-enhance':'专业增强'}
    rows=[]
    for case,title in names.items():
        a=next(r for r in speed['rows'] if r['case']==case and r['variant']=='baseline')
        b=next(r for r in speed['rows'] if r['case']==case and r['variant']=='candidate')
        fmt=lambda r,key: '—' if not r[key] else f"{r[key]['p50']/1000:.2f} / {r[key]['p90']/1000:.2f}"
        rows.append(f"<tr><td>{title}</td><td>{fmt(a,'firstTextMs')} → {fmt(b,'firstTextMs')}</td><td>{fmt(a,'firstActionMs')} → {fmt(b,'firstActionMs')}</td></tr>")
    speed_html='<p>10轮交错A/B，共80次模型调用。下表为 p50 / p90，单位秒；首次动作止于媒体提交，不包含生成等待。</p><table><tr><th>场景</th><th>首字：旧→新</th><th>首次动作：旧→新</th></tr>'+''.join(rows)+'</table><p>问候首字更快，直接编辑接近；简短改写反而略慢，增强的尾部首字也更慢。不能宣称普通场景全部加速。缓存以命中为主（两版各39/40次有缓存读取），并非强制冷启动；本机其他QA与构建有部分重叠，不作严格性能因果结论。</p>'
    html=html.replace('<p id="speed-note">普通请求速度复测正在独立汇总；不把媒体供应商渲染时间算作提示词加速。</p>',speed_html)
html=html.replace('3组可编辑双视频拼接另行检查导出','3组可编辑双视频拼接共6份也完成真实导出与解码，未检出黑帧或连续静音')
(out/'index.html').write_text(html)
print(json.dumps({'pairs':len(pairs),'assets':len(list(media.iterdir())),'mediaBytes':sum(p.stat().st_size for p in media.iterdir())}))
