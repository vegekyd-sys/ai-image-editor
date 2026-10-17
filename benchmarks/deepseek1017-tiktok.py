"""Reproducible paired TikTok experiment; creation uses Makaron Chat CLI only."""
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/deepseek1017-luna'
OUT.mkdir(parents=True, exist_ok=True)
ENV = {**os.environ, 'MAKARON_URL': 'https://www.makaron.app', 'DAM_API_TIMEOUT_SECONDS': '300'}
CASES = [
    ('01', '振丰玩具', 'prj_f0d21315a7c64043beb7f0013e13ad97', '玩具工厂的反差与解压：小玩具如何诞生'),
    ('02', '富阳云绒', 'prj_29c37974645d4d18988cb44477040e79', '从一团纱到一块布：让人停不下来的织造过程'),
    ('03', '广州市帛卉化妆品有限公司', 'prj_72c418e4b6ed43bba3cf69d86199e530', '护肤品工厂幕后：瓶子如何整齐地被装满'),
    ('04', '云南互祺食品', 'prj_a511747a5e104d20bb737b6dbe6e13d3', '食品工厂的满足感：原料到包装的奇妙旅程'),
    ('05', '亦馨家居竖屏', 'prj_c1a887f7efbc483b81850d7616bd8034', '家居好物是怎么做出来的：工厂里的小惊喜'),
]

def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def save(path, value):
    path = pathlib.Path(path)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    tmp.replace(path)

def cli(args, timeout=360):
    if args[0] == 'makaron':
        args = ['node', str(ROOT/'packages/makaron-cli/bin/makaron.mjs'), *args[1:]]
    p = subprocess.run(args, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        try:
            failure = json.loads(p.stdout)
            if failure.get('status') in ('failed','aborted'):
                return failure
        except (ValueError, AttributeError):
            pass
        raise RuntimeError(f'{args[:3]} exited {p.returncode}: {p.stderr[-1200:]} {p.stdout[-500:]}')
    return json.loads(p.stdout)

def retrieve(case):
    num, name, project, theme = case
    folder = OUT / num
    folder.mkdir(exist_ok=True)
    if (folder / 'manifest.json').exists():
        return num
    started = stamp()
    clock = time.monotonic()
    brief = f'为{name}检索一套用于有趣的60秒英文TikTok竖屏视频的真实客户素材，主题：{theme}。需要约60至75秒可用视频范围，覆盖最吸引眼球的产品、动作、制造细节、人物或结果。选择具体、视觉上有趣的镜头，优先竖屏。不要虚构品牌能力，不要下载或导出。返回一套source-backed素材计划，标注覆盖不足。'
    save(folder / 'retrieval-request.json', {'started_at': started, 'project': project, 'brief': brief})
    plan = cli(['scene', 'agent', brief, '--project', project, '--sets', '1', '--json'])
    save(folder / 'scene-plan.json', plan)
    clips = plan.get('clips') or ((plan.get('sets') or [{}])[0].get('clips'))
    if not clips:
        raise RuntimeError(f'{num}: unexpected Scene shape {list(plan)}')
    if any(c.get('type', 'video') != 'video' for c in clips):
        clips = [c for c in clips if c.get('type', 'video') == 'video']
    manifest = {'clips': [{**c, 'type': 'video'} for c in clips]}
    save(folder / 'manifest.json', manifest)
    save(folder / 'retrieval-timing.json', {'started_at': started, 'completed_at': stamp(), 'seconds': time.monotonic()-clock, 'clip_count': len(clips), 'source_seconds': sum(c['end']-c['start'] for c in clips), 'manifest_sha256': hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest()})
    print(f'retrieval {num} {name}: {len(clips)} clips', flush=True)
    return num

def prompt(case):
    num, name, _, theme = case
    return f'''为客户「{name}」制作1条60秒（允许59–61秒）的9:16英文TikTok视频。主题：{theme}。
素材已由Scene检索并以Media Manifest导入；source_url、start/end、description是原始来源证据。请在这些素材中自主选镜头，做有趣、吸引人、适合手机观看的真正成片，前3秒有钩子，中间有推进和惊喜，结尾有自然收束。用真实画面说话，不编造未经证明的认证、销量或效果。
你自行决定创意、结构、节奏、字幕样式、旁白与音乐。默认英文VO+BGM，字幕与真实声音对齐。不能靠循环一小段凑满60秒或用大段卡片遮盖素材。不要生成新的视频/图片替代客户实拍。
本轮已授权你自行审阅中间Script、Storyboard、Composition和预览，直接推进至最终可播放MP4；不要等用户确认。读取并遵守TikTok相关Skill，完成预览检查、音频检查、最终导出并交付MP4和可编辑项目。所有制作和导出均由本次Makaron Chat及其内部工具完成。
本条成本目标不超过80 Makaron Credits（约0.80美元目录价值），媒体预算只用于一条60秒音轨及必要ASR/渲染，不做多候选生成。复用已成功生成的资产，失败时先检查已有结果再重试；不足时明确报告真实状态，不把计划、预览、静音或未导出的composition宣称为成片。'''

def submit(case, model):
    num = case[0]
    folder = OUT / num / model
    folder.mkdir(exist_ok=True)
    if (folder / 'submission.json').exists():
        return json.loads((folder/'submission.json').read_text())
    spent = 3
    pending_reserve = 0
    for record in OUT.glob('[0-9][0-9]/*/submission.json'):
        latest = record.with_name('latest.json')
        if latest.exists():
            value = json.loads(latest.read_text())
            used = value.get('usage',{}).get('credits_net',0)
            spent += used
            if value.get('status') in ('running','in_progress','queued'):
                pending_reserve += max(80-used,0)
        else:
            pending_reserve += 80
    if spent + pending_reserve + 80 > 1000:
        raise RuntimeError(f'Combined budget guard: spent={spent}, reserved={pending_reserve}; inspect before another submission')
    brief = prompt(case)
    (OUT / num / 'prompt.txt').write_text(brief)
    start = stamp()
    clock = time.monotonic()
    result = cli(['makaron', 'chat', '--project', 'auto', '--agent-model', model, '--skill', 'tiktok-video', '--media-manifest', str(OUT/num/'manifest.json'), '--json', '-b', brief])
    value = {'case': num, 'requested_model': model, 'submitted_at': start, 'submit_finished_at': stamp(), 'submit_seconds': time.monotonic()-clock, **result}
    save(folder / 'submission.json', value)
    print(f'submit {num} {model} {value["runId"]}', flush=True)
    return value

def poll(case, model):
    folder = OUT / case[0] / model
    sub = json.loads((folder/'submission.json').read_text())
    result = cli(['makaron', 'responses', 'get', sub['runId'], '--json'])
    save(folder / 'latest.json', result)
    row = {'observed_at': stamp(), 'status': result['status'], 'progress': result.get('progress'), 'usage': result.get('usage')}
    with (folder/'observations.jsonl').open('a') as f:
        f.write(json.dumps(row,ensure_ascii=False)+'\n')
    videos = [x for x in result.get('output',[]) if x.get('type')=='video' and x.get('url') and x.get('status')=='completed']
    if videos and not (folder/'first-mp4.json').exists():
        prior=json.loads((folder/'terminal.json').read_text()) if (folder/'terminal.json').exists() else None
        save(folder/'first-mp4.json',{'observed_at':prior['observed_at'] if prior else stamp(),'client_elapsed_seconds':prior['client_elapsed_seconds'] if prior else (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(sub['submitted_at'])).total_seconds(),'videos':videos,'timing_note':'First observed completed MP4, independent from Agent terminal status; polling upper bound.'})
    if result['status'] not in ('in_progress','running','queued'):
        elapsed=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(sub['submitted_at'])).total_seconds()
        if not (folder/'terminal.json').exists():
            save(folder/'terminal.json', {'observed_at':stamp(),'client_elapsed_seconds':elapsed,'first_pass_mp4':bool(videos),'videos':videos,'response':result,'timing_note':'First terminal observation; MP4 completion observation is an upper bound with approximately 35s polling uncertainty. Agent completed_at is separate from final artifact readiness.'})
    print(f'{case[0]} {model}: {result["status"]}; credits={result.get("usage",{}).get("credits_net")}; {result.get("progress",{})}',flush=True)
    return result

def usage(case, model):
    folder=OUT/case[0]/model
    sub=json.loads((folder/'submission.json').read_text())
    value=cli(['makaron','usage','--run',sub['runId'],'--json'])
    save(folder/'usage.json',value)
    return value.get('summary',{}).get('credits_net',0)

def all_jobs(selected):
    jobs=[]
    for case in selected:
        for record in (OUT/case[0]).glob('**/submission.json'):
            jobs.append((case,str(record.parent.relative_to(OUT/case[0]))))
    return jobs

if __name__ == '__main__':
    mode = sys.argv[1]
    selected = [c for c in CASES if len(sys.argv)<3 or c[0] in sys.argv[2].split(',')]
    if mode == 'retrieve':
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(retrieve, selected))
    elif mode == 'submit':
        for c in selected:
            models = ['deepseek-flash','auto'] if int(c[0])%2 else ['auto','deepseek-flash']
            for m in models:
                submit(c,m)
    elif mode == 'poll':
        jobs=[(c,m) for c in selected for m in ['deepseek-flash','auto'] if (OUT/c[0]/m/'submission.json').exists()]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda args: poll(*args),jobs))
    elif mode == 'monitor':
        for _ in range(100):
            jobs=[(c,m) for c,m in all_jobs(selected) if not (OUT/c[0]/m/'terminal.json').exists()]
            if not jobs:
                break
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                futures=[pool.submit(poll,*args) for args in jobs]
                for f in futures:
                    try:
                        f.result()
                    except Exception as e:
                        print(f'poll error: {str(e)[:300]}',flush=True)
            subprocess.run([sys.executable,str(ROOT/'benchmarks/deepseek1017-report.py')],cwd=ROOT,check=True)
            time.sleep(35)
    elif mode == 'usage':
        jobs=all_jobs(selected)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            spent=sum(pool.map(lambda args:usage(*args),jobs))+3
        for name in ['candidate-vision-latest.json','candidate-vision-retest-latest.json']:
            if (OUT/name).exists():
                spent+=json.loads((OUT/name).read_text()).get('usage',{}).get('credits_net',0)
        save(OUT/'budget.json',{'observed_at':stamp(),'credits_settled':spent,'catalog_usd':spent/100,'cap_catalog_usd':10,'note':'Active Agent token charges may settle at run end; Scene provider cost not returned by CLI'})
        print(f'Combined settled: {spent} Credits = ${spent/100:.2f} catalog value',flush=True)
