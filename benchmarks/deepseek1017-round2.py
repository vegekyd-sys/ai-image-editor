"""Second paired trial: all creation through Makaron Chat, retrieval through Scene CLI."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/deepseek1017-round2'
OUT.mkdir(exist_ok=True)
ORIGIN = 'http://127.0.0.1:3117'
ENV = {**os.environ, 'MAKARON_URL': ORIGIN, 'DAM_API_TIMEOUT_SECONDS': '300'}
OBSERVATION_ENV = {**ENV, 'MAKARON_URL': 'https://www.makaron.app'}
MODELS = ['deepseek-flash', 'gpt-6-luna-codex-subscription']
REFERENCE = Path('/Users/tianyicai/.codex/skills/makaron-mascot-spark/assets/makaron-spark-pixel-wizard-concepts.png')
CASES = [
    dict(id='06', name='杭州天易成', kind='tiktok', project='prj_c5810d06d6734cb1bb802a9dac6fc731', theme='工厂里的意外解压瞬间：跟随真实产品从制造到成品', reserve=130),
    dict(id='07', name='浙江易田', kind='tiktok', project='prj_2d6c4a4d405144dab789bc3f075aeeea', theme='你每天见到的东西，原来这样制造：真实生产的反差与细节', reserve=130),
    dict(id='08', name='义乌康豪', kind='tiktok', project='prj_808f330afbe9405399a5448db3041c51', theme='从不起眼的原料到整齐成品：令人停不下来的工厂节奏', reserve=130),
    dict(id='09', name='广东盛优家居', kind='tiktok', project='prj_bf35071d2f624e6b9d742f4247d5b46c', theme='家居幕后的一分钟：藏在熟悉物件里的工艺与惊喜', reserve=130),
    dict(id='10', name='安吉仟源', kind='tiktok', project='prj_09beda57da7e4fb883b17ce242e96057', theme='工厂ASMR加一个反转：从生产细节认识真实产品', reserve=130),
    dict(id='V1', name='Spark 把灵感拉成现实', kind='video', theme='一个空白创作界面的聊天气泡迸出洋红青色Spark。Pixel Wizard自信地伸出身体抓住能量带，却被拉着穿过创意门户，帽子飞起、表情惊讶；Spark把灰暗的素材变成绚丽的真实创意世界，最后小家伙稳住帽子偷偷得意。三个清晰喜剧节拍，动作连续，有完整结尾。', reserve=260),
    dict(id='V2', name='胆小向导的大胆一剪', kind='video', theme='微缩创作工作台上的视频时间线展开，洋红青色Spark作为真实剪辑轨迹划过素材。Pixel Wizard探头察看，被突然打开的before/after门户吓得缩成一团，随后鼓起勇气用整个身体推动Spark，让静止的城市场景变成有生命力的梦幻世界；最后害羞地向创作结果鞠躬，帽檐轻颤。温暖幽默、明确前后变化。', reserve=260),
    dict(id='I1', name='灵感冲出聊天框', kind='image', theme='9:16竖版产品品牌海报：精致手机创作界面为主角，Spark从一条聊天气泡流出，变成充满材质细节的异想世界。Pixel Wizard抓住能量丝带被轻轻提起，帽子歪了、嘴硬又害怕。画面留白适合营销，主标题精确为 MAKE IT REAL，次级品牌名 Makaron。', reserve=40),
    dict(id='I2', name='一笔打开新世界', kind='image', theme='1:1方形品牌插画：一条洋红青色Spark编辑轨迹打开before/after门户，朴素灰色创作素材在门户另一侧成为充满光线的迷你花园。Pixel Wizard从门户边缘偷偷探头，半眯眼得意又好奇，身体与能量带有真实接触和受力。精致3D、鲜明轮廓、克制构图，无额外文字。', reserve=40),
    dict(id='I3', name='创作成功后的偷偷得意', kind='image', theme='16:9横版品牌主视觉：创作界面里的生成预览为主要物体，Spark从产品生成按钮流向完成的艺术作品，形成优雅能量弧线。Pixel Wizard在界面角落抱着Spark，压低帽檐偷偷得意，轻轻悬浮，能量光真实照亮半透明紫色身体。暖白与深紫平衡、有设计感和呼吸感，文字仅精确 Makaron。', reserve=40),
]
BRAND = '''以附带的Makaron Spark + Pixel Wizard官方参考表作为品牌身份依据，参考表不是最终画面，不要复制多宫格。Pixel Wizard是紫色软糯半透明泡泡幽灵，像素边缘、方眼和像素嘴、大号软塌深紫巫师帽，霓虹洋红/青边光；顽皮、自信却容易受惊，会漂浮和挤压伸展。Spark是从产品UI、聊天气泡、编辑轨迹或预览中产生的洋红青色创作能量，必须推动实际创意变化。小家伙是引导者和配角，约占画面10–25%，用整个身体追逐、拉扯、骑乘、躲避或抱住Spark，与场景的透视和光照一致。不要把Spark简化成魔杖光，不要使用魔杖，不要仅把吉祥物贴在界面旁边。'''

def stamp(): return dt.datetime.now(dt.timezone.utc).isoformat()
def save(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix+'.tmp'); tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2)); tmp.replace(path)
def read(path): return json.loads(path.read_text()) if path.exists() else {}
def cli(args, timeout=420):
    env=OBSERVATION_ENV if args[0]=='makaron' and args[1] in ('responses','usage') else ENV
    if args[0]=='makaron': args=['node',str(ROOT/'packages/makaron-cli/bin/makaron.mjs'),*args[1:]]
    p=subprocess.run(args,cwd=ROOT,env=env,capture_output=True,text=True,timeout=timeout)
    try: value=json.loads(p.stdout)
    except ValueError: raise RuntimeError(f'CLI {args[:3]} exit={p.returncode}: {p.stderr[-800:]}')
    if p.returncode and value.get('status') not in ('failed','aborted'): raise RuntimeError(f'CLI failed: {str(value)[:400]}')
    return value

def prompt(c):
    if c['kind']=='tiktok':
        body=f'''为客户「{c['name']}」制作一条60秒（59–61秒）9:16英文TikTok成片，主题：{c['theme']}。Scene已检索并通过Media Manifest导入真实客户素材，source_url/start/end/description是来源证据。自己决定有趣的创意、镜头选择、推进、反转和结尾；前3秒有钩子，手机可读的大字幕，英文旁白与字幕真实对齐，配乐衬托。用画面讲故事，不编造认证、销量、效果，不靠重复循环或大卡片凑时长，不生成图片视频替代实拍。允许剪辑原始素材，但不要把suggested范围外不存在的内容当作证据。'''
    elif c['kind']=='video':
        body=f'''生成一条真正由视频生成模型制作的15秒（允许14.5–15.5秒）9:16 Makaron mascot品牌短片，至少720p、有完整动作与叙事，不用Remotion动画/静态幻灯片替代生成视频。创意：{c['theme']}\n{BRAND}\n如参考模型需要单张起始图，可先生成一张品牌一致的起始图，再生成一条15秒视频；不生成多候选，15秒单次任务优先。根据实际能力/价格选择合适模型。有适宜的音效或音乐，不强求口播。不要把参考表作为多宫格直接动起来。'''
    else:
        body=f'''生成一张完整可下载的Makaron mascot品牌图片，创意：{c['theme']}\n{BRAND}\n使用真正的图片生成/编辑模型，不能用代码拼图代替。自行选择适合的模型与分辨率，目标至少1024px一边，优先清晰品牌还原、构图、接触光与指定文字。只生成一张，不生成多候选。'''
    return body+f'''\n全程通过本次Makaron Chat内部工具完成。已授权你自行审核脚本、分镜、图片或视频预览并直接推进交付，不要停下来等确认。仔细读取适用的内部Skill并检查实际生成结果；视频需要实际可播放MP4（TikTok还需可编辑项目），图片需实际可查看原图。最终告诉用户实际使用的生成模型与成品链接。\n本条总成本目标上限{c['reserve']} Makaron Credits（目录价值${c['reserve']/100:.2f}），包括Agent与媒体。选择模型时检查预算，复用已有成功资产、查询已有任务，不重复提交同一任务。每种媒体最多一次成功生成，失败先检查已完成/运行中状态，必要重试仍须在此预算内；无法完成时诚实报告，不把计划或预览宣称为成品。最终完成后及时收尾。'''

def retrieve(c):
    if c['kind']!='tiktok': return
    folder=OUT/c['id'];folder.mkdir(exist_ok=True)
    if (folder/'manifest.json').exists(): return
    brief=f"为{c['name']}找到真实产品、制造流程、人物操作、机器动作与成品结果中最有趣的画面，做1套适合60秒9:16英文TikTok的source-backed素材计划。主题：{c['theme']}。先依据项目真实内容选故事，不要根据公司名猜测产品；优先竖屏和不重复镜头，约70–85秒范围留剪辑余量，保留source_url/start/end/description，不下载不导出，明确缺口。"
    save(folder/'retrieval-request.json',{'started_at':stamp(),'brief':brief,'project':c['project']})
    start=time.monotonic(); plan=cli(['scene','agent',brief,'--project',c['project'],'--sets','1','--json'])
    save(folder/'scene-plan.json',plan)
    clips=plan.get('clips') or (plan.get('sets') or [{}])[0].get('clips')
    clips=[{**x,'type':'video'} for x in clips or [] if x.get('type',x.get('media_type','video'))=='video']
    if not clips: raise RuntimeError(f"Scene {c['id']} has no clips")
    save(folder/'manifest.json',{'clips':clips})
    save(folder/'retrieval-timing.json',{'completed_at':stamp(),'seconds':time.monotonic()-start,'clip_count':len(clips),'source_seconds':sum(x['end']-x['start'] for x in clips),'manifest_sha256':hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest()})
    print(f"Scene {c['id']} {c['name']}: {len(clips)} clips",flush=True)

def budget():
    used=0;reserved=0
    for p in OUT.glob('*/**/submission.json'):
        sub=read(p);v=read(p.with_name('latest.json'));settled=max(v.get('usage',{}).get('credits_net',0) or 0,read(p.with_name('usage-live.json')).get('summary',{}).get('credits_net',0) or 0)
        used+=settled
        if not v or v.get('status') in ('in_progress','running','queued'):
            reserved+=max(0,sub['reserve']-settled)
    return {'observed_at':stamp(),'credits_settled':used,'credits_reserved':reserved,'cap_credits':3000,'catalog_usd':used/100,'prior_round_catalog_usd':9.50,'note':'User approved incremental $30 cap; credits are catalog equivalent, Scene cost unavailable.'}

def submit(c,model):
    folder=OUT/c['id']/model;folder.mkdir(parents=True,exist_ok=True)
    if (folder/'submission.json').exists(): return
    b=budget()
    if b['credits_settled']+b['credits_reserved']+c['reserve']>3000: raise RuntimeError(f'Budget guard {b}')
    args=['makaron','chat','--project','auto','--agent-model',model,'--json','-b']
    if c['kind']=='tiktok': args+=['--skill','tiktok-video','--media-manifest',str(OUT/c['id']/'manifest.json')]
    else: args+=['--image',str(REFERENCE)]
    brief=prompt(c);(OUT/c['id']/'prompt.txt').write_text(brief)
    start=stamp();clock=time.monotonic()
    # Persist intent before submission; ambiguous errors must be reconciled, never blindly retried.
    save(folder/'intent.json',{'case':c['id'],'model':model,'started_at':start,'origin':ORIGIN})
    if (folder/'submission-error.json').exists(): raise RuntimeError('Submission error needs manual reconciliation')
    try: result=cli([*args,brief])
    except Exception as exc:
        save(folder/'submission-error.json',{'at':stamp(),'error':str(exc)[:1000]});raise
    save(folder/'submission.json',{'case':c['id'],'kind':c['kind'],'requested_model':model,'reserve':c['reserve'],'submitted_at':start,'submit_finished_at':stamp(),'submit_seconds':time.monotonic()-clock,'origin':ORIGIN,**result})
    print(f"submit {c['id']} {model} {result.get('runId')}",flush=True)

def poll(c,model):
    folder=OUT/c['id']/model;sub=read(folder/'submission.json')
    if not sub: return
    value=cli(['makaron','responses','get',sub['runId'],'--json'])
    save(folder/'latest.json',value)
    elapsed=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(sub['submitted_at'])).total_seconds()
    kind='image' if c['kind']=='image' else 'video'
    outputs=[x for x in value.get('output',[]) if x.get('type')==kind and x.get('status')=='completed' and x.get('url')]
    # Attached reference is input, not a generated deliverable.
    with (folder/'observations.jsonl').open('a') as f: f.write(json.dumps({'observed_at':stamp(),'status':value.get('status'),'elapsed':elapsed,'usage':value.get('usage'),'progress':value.get('progress')},ensure_ascii=False)+'\n')
    if outputs and not (folder/'first-artifact.json').exists():
        save(folder/'first-artifact.json',{'observed_at':stamp(),'client_elapsed_seconds':elapsed,'outputs':outputs,'timing_note':'First observed completed output; polling upper bound; generated-output provenance checked separately.'})
    if value.get('status') not in ('in_progress','running','queued') and not (folder/'terminal.json').exists():
        save(folder/'terminal.json',{'observed_at':stamp(),'client_elapsed_seconds':elapsed,'has_output':bool(outputs),'status':value.get('status')})
    print(f"{c['id']} {model}: {value.get('status')} {value.get('usage',{}).get('credits_net')}cr output={len(outputs)}",flush=True)

if __name__=='__main__':
    mode=sys.argv[1];selected=[c for c in CASES if len(sys.argv)<3 or c['id'] in sys.argv[2].split(',')]
    save(OUT/'experiment.json',{'cases':CASES,'models':MODELS,'origin':ORIGIN,'budget_cap_credits':3000,'approval':'User approved incremental $30 for 5 TikTok pairs, 2 generated-video pairs and 3 image pairs on 2026-10-17.','candidate_commit':'68982da4','notes':'New source sets; DeepSeek tool-vision fix enabled; explicit Luna Codex route preserves baseline when candidate default changes.'})
    if mode=='retrieve':
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: list(pool.map(retrieve,selected))
    elif mode=='submit':
        for i,c in enumerate(selected):
            for model in MODELS if i%2==0 else MODELS[::-1]: submit(c,model)
    elif mode in ('poll','monitor'):
        for iteration in range(180 if mode=='monitor' else 1):
            jobs=[(c,str(p.parent.relative_to(OUT/c['id']))) for c in selected for p in (OUT/c['id']).glob('**/submission.json') if mode=='poll' or not p.with_name('terminal.json').exists()]
            if not jobs: break
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                fs=[pool.submit(poll,*j) for j in jobs]
                for f in fs:
                    try:f.result()
                    except Exception as exc:print('poll error',str(exc)[:300],flush=True)
            save(OUT/'budget.json',budget())
            subprocess.run([sys.executable,str(ROOT/'benchmarks/deepseek1017-round2-report.py')],cwd=ROOT,check=True,capture_output=True)
            if mode=='monitor':time.sleep(35)
    elif mode=='budget':
        save(OUT/'budget.json',budget());print(json.dumps(budget(),ensure_ascii=False))
