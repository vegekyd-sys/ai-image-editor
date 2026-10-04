"""Build a private, local same-source benchmark viewer; no API calls."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'test-results/seedance25-mascot-ab'
OUT = ROOT / 'upscale-options'
MODELS = [
    ('lanczos', '普通缩放 Lanczos', 'lanczos.mp4', '免费基准；不增加 AI 细节'),
    ('lanczos-sharp', '普通缩放 + 轻锐化', 'lanczos-sharp.mp4', '免费基准；只做轻锐化'),
    ('flashvsr', 'FlashVSR Regular（上次）', '../seedance25-flashvsr-1080p.mp4', '建筑更清楚，但像素眼睛被改圆'),
    ('topaz-proteus', 'Topaz Proteus', 'topaz-proteus.mp4', '轮廓更清楚，保留方块表情；较平衡'),
    ('topaz-gaia-cg', 'Topaz Gaia CG', 'topaz-gaia-cg.mp4', '较柔和，增益有限'),
    ('bytedance-fast', 'ByteDance Fast', 'bytedance-fast.mp4', '更锐利，保留表情；注意高光与边缘光晕'),
]
entries = []
for ident, label, file, note in MODELS:
    if ident == 'flashvsr':
        metrics = dict(providerSeconds=161.352, readySeconds=None, costUsdEstimate=.253817344)
    else:
        metrics = json.loads((OUT / f'{ident}.metrics.json').read_text())
    poster = f'{ident}-poster.jpg'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '7.2', '-i', str(OUT / file), '-frames:v', '1', '-q:v', '2', str(OUT / poster)], check=True)
    entries.append(dict(id=ident, label=label, file=file, poster=poster, note=note,
                        providerSeconds=metrics['providerSeconds'], readySeconds=metrics['readySeconds'],
                        costUsdEstimate=metrics['costUsdEstimate']))

html = r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Makaron · 同源超分对比</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#101017;color:#eee}body{margin:0}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:28px;margin:0 0 12px}.muted{color:#a7a7ba;line-height:1.65}.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0}button,select,a.button{background:#252433;border:1px solid #504568;border-radius:8px;color:#eee;padding:10px 14px;font-size:14px;cursor:pointer}button:hover{background:#45315f}a{color:#cbaaff}input[type=range]{flex:1;min-width:180px;accent-color:#be87ff}.panes{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pane{background:#191923;border:1px solid #333142;border-radius:12px;overflow:hidden}.head{padding:14px}.head select{width:100%}.meta{font-size:13px;color:#b8b4c6;margin-top:10px;min-height:36px}video{width:100%;display:block;background:black;aspect-ratio:16/9}.detail{padding:14px;text-align:center;border-top:1px solid #333142}.detail canvas{width:430px;max-width:100%;height:auto;background:black}.detail p{font-size:13px;color:#a7a7ba}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}td,th{padding:12px 8px;text-align:left;border-bottom:1px solid #35313e}th{color:#c6b7da}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.gallery img{width:100%;border-radius:8px}.gallery p{font-size:13px}.small{font-size:13px}#error{color:#ffafa0}#clock{font-variant-numeric:tabular-nums;min-width:110px}@media(max-width:800px){main{padding:14px}.panes{grid-template-columns:1fr}.gallery{grid-template-columns:repeat(2,1fr)}table{font-size:12px}td,th{padding:10px 4px}}
</style><main>
<h1>同一条 480p，哪种超分值得用？</h1>
<p class="muted">复用之前的 10 秒 Pixel Wizard 视频，没有新增 Seedance 生成。所有输出统一为 1920×1080 / 24fps / 241 帧，并保留原音轨。默认停在 7.2 秒：先看方块表情，再看玻璃楼宇。</p>
<div class="bar"><button id="play">同步播放</button><button id="restart">从头播放</button><button id="prev">前一帧</button><button id="next">后一帧</button><label><input type="checkbox" id="sound"> 原片声音</label><label>速度 <select id="speed"><option value="1">1×</option><option value="0.5">0.5×</option></select></label></div>
<div class="bar"><input id="time" aria-label="时间" type="range" min="0" max="10" step="0.041666667" value="7.2"><span id="clock">7.200 / 10.04 s</span><button data-time="1">1 秒</button><button data-time="3">3 秒</button><button data-time="5">5 秒</button><button data-time="7.2">7.2 秒</button><button data-time="8.5">8.5 秒</button></div>
<div class="bar"><label>局部原尺寸对比 <select id="region"><option value="face">吉祥物表情（7.2 秒）</option><option value="building">玻璃楼宇（7.2 秒）</option></select></label><button id="baseline">普通缩放 vs ByteDance</button><button id="oldnew">FlashVSR vs ByteDance</button><button id="topazbyte">Proteus vs ByteDance</button></div>
<div class="panes">
<section class="pane"><div class="head"><select id="left" aria-label="左侧方案"></select><div class="meta" id="left-meta"></div></div><video id="lv" playsinline preload="auto" muted></video><div class="detail"><canvas id="lc" width="430" height="430"></canvas><p>从当前视频帧截取 · 430×430 · 桌面原尺寸</p><a id="left-link" target="_blank">单独查看 / 下载</a></div></section>
<section class="pane"><div class="head"><select id="right" aria-label="右侧方案"></select><div class="meta" id="right-meta"></div></div><video id="rv" playsinline preload="auto" muted></video><div class="detail"><canvas id="rc" width="430" height="430"></canvas><p>从当前视频帧截取 · 430×430 · 桌面原尺寸</p><a id="right-link" target="_blank">单独查看 / 下载</a></div></section>
</div><p id="error" role="status"></p>
<p class="muted small">局部窗口固定在同一坐标，适合暂停到 7.2 秒比较；播放时可看边缘稳定性。下方时间是本次单样本实测，包含轮询间隔，不能代表长期延迟。FlashVSR 为上次测试；其完整流水线还包含 720p 导出，下载就绪时间与本轮不可直接比较。</p>
<table><thead><tr><th>方案</th><th>供应商返回</th><th>本地文件就绪</th><th>10 秒超分估价</th><th>这一条片子的观察</th></tr></thead><tbody id="rows"></tbody></table>
<p class="muted small">本轮三次 AI 超分公开价合计约 $0.48，尚未核对账单。Topaz 采用 1080p / 30fps 标价估算，实际信用点舍入以账单为准；ByteDance 同样按 30fps 标价估算。普通缩放与轻锐化没有 AI 调用费用。本轮没有新生成视频。</p>
<p><a href="../compare.html">之前：480p + FlashVSR vs 原生 1080p</a> · <a href="../mascot-480p.mp4" target="_blank">原始 480p 视频</a></p>
<h2>7.2 秒完整画面</h2><div class="gallery" id="gallery"></div>
</main><script>
const models=__MODELS__;
const $=id=>document.getElementById(id), lv=$('lv'), rv=$('rv'), videos=[lv,rv];let desiredTime=7.2, playing=false;
function pause(){playing=false;videos.forEach(v=>v.pause());$('play').textContent='同步播放'}
function setTime(t){pause();desiredTime=Math.max(0,Math.min(10,t));videos.forEach(v=>{if(v.readyState>=1)v.currentTime=desiredTime});$('time').value=desiredTime;draw();}
function draw(){const box=$('region').value==='face'?[1030,600]:[370,240];videos.forEach((v,i)=>{if(v.readyState>=2&&!v.seeking)$(i?'rc':'lc').getContext('2d').drawImage(v,box[0],box[1],430,430,0,0,430,430)});$('clock').textContent=`${(playing?lv.currentTime:desiredTime).toFixed(3)} / 10.04 s`;}
async function play(){if(videos.some(v=>v.readyState<2))return;$('error').textContent='';if(lv.currentTime>=10)setTime(0);rv.currentTime=lv.currentTime;try{await Promise.all(videos.map(v=>v.play()));playing=true;$('play').textContent='暂停对比'}catch(e){pause();$('error').textContent='播放未成功，请再点一次播放：'+e.message}}
function select(side){pause();const v=side==='left'?lv:rv,m=models.find(m=>m.id===$(side).value);v.poster=m.poster;v.src=m.file;v.load();$(side+'-meta').textContent=m.note;$(side+'-link').href=m.file;}
for(const side of ['left','right']){$(side).innerHTML=models.map(m=>`<option value="${m.id}">${m.label}</option>`).join('');$(side).value=side==='left'?'topaz-proteus':'bytedance-fast';$(side).onchange=()=>select(side);select(side)}
videos.forEach(v=>{v.addEventListener('loadedmetadata',()=>{v.currentTime=desiredTime});v.addEventListener('seeked',draw);v.addEventListener('loadeddata',draw);v.addEventListener('error',()=>{pause();$('error').textContent='视频加载失败，请刷新或使用单独查看链接。'});});
lv.addEventListener('ended',()=>{desiredTime=lv.currentTime;pause();draw()});
$('play').onclick=()=>playing?(desiredTime=lv.currentTime,pause(),setTime(desiredTime)):play();$('restart').onclick=()=>{setTime(0);const start=()=>{lv.removeEventListener('seeked',start);play()};if(lv.seeking)lv.addEventListener('seeked',start,{once:true});else play()};
$('prev').onclick=()=>setTime(Math.round((playing?lv.currentTime:desiredTime)*24)/24-1/24);$('next').onclick=()=>setTime(Math.round((playing?lv.currentTime:desiredTime)*24)/24+1/24);$('time').oninput=e=>setTime(Number(e.target.value));document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>setTime(Number(b.dataset.time)));
$('sound').onchange=e=>lv.muted=!e.target.checked;$('speed').onchange=e=>videos.forEach(v=>v.playbackRate=Number(e.target.value));$('region').onchange=()=>setTime(7.2);
function pair(l,r){$('left').value=l;$('right').value=r;setTime(7.2);select('left');select('right')}$('baseline').onclick=()=>pair('lanczos','bytedance-fast');$('oldnew').onclick=()=>pair('flashvsr','bytedance-fast');$('topazbyte').onclick=()=>pair('topaz-proteus','bytedance-fast');
function tick(){if(playing){if(rv.paused&&!rv.ended)rv.play().catch(()=>pause());if(!rv.seeking&&Math.abs(rv.currentTime-lv.currentTime)>.065)rv.currentTime=lv.currentTime;$('time').value=lv.currentTime;}draw();requestAnimationFrame(tick)}requestAnimationFrame(tick);
$('rows').innerHTML=models.map(m=>`<tr><td>${m.label}</td><td>${m.providerSeconds?m.providerSeconds.toFixed(1)+' 秒':'本机缩放'}</td><td>${m.readySeconds==null?'—':m.readySeconds.toFixed(1)+' 秒'}</td><td>${m.costUsdEstimate?'约 $'+m.costUsdEstimate.toFixed(3):'$0'}</td><td>${m.note}</td></tr>`).join('');
$('gallery').innerHTML=models.map(m=>`<div><a href="${m.poster}" target="_blank"><img src="${m.poster}" alt="${m.label} 7.2 秒画面" loading="lazy"></a><p>${m.label} · 点击看原尺寸</p></div>`).join('');
</script></html>'''
(OUT / 'index.html').write_text(html.replace('__MODELS__', json.dumps(entries, ensure_ascii=False)))
(OUT / 'public-metrics.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2))
old = ROOT / 'compare.html'
if old.exists():
    content = old.read_text()
    if 'id="same-source-upscale-link"' not in content:
        banner = '<div id="same-source-upscale-link" style="padding:16px;background:#38224f;color:white;text-align:center"><a href="upscale-options/index.html" style="color:white;font-weight:600">新增：同一条 480p 的六种超分 / 缩放对比 → ByteDance、Proteus、Gaia CG、FlashVSR</a></div>'
        import re
        if re.search(r'<body\b', content):
            content = re.sub(r'(<body\b[^>]*>)', lambda m: m.group(1) + banner, content, count=1)
        else:
            # The original experiment page omits the optional body opening tag.
            content = re.sub(r'(<main\b[^>]*>)', lambda m: m.group(1) + banner, content, count=1)
        if 'id="same-source-upscale-link"' not in content:
            raise RuntimeError('Could not insert the new comparison link into the original viewer')
        old.write_text(content)
print('Built local viewer:', OUT / 'index.html')
