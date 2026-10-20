"""Clean timed TikTok pairs. New projects, frozen Scene corpus, one Preview runtime."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('trial',ROOT/'benchmarks/deepseek1017-round2.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)

def submit(c,model):
    folder=t.OUT/c['id']/model/'formal-01';folder.mkdir(parents=True,exist_ok=True)
    if (folder/'submission.json').exists():return
    if (folder/'intent.json').exists():raise RuntimeError('An earlier submission intent needs reconciliation before retry')
    preview=t.read(t.OUT/'preview.json');origin=preview['cli_origin']
    b=t.budget();reserve=75
    if b['credits_settled']+b['credits_reserved']+reserve>2985:raise RuntimeError(f'Formal combined budget guard: {b}')
    brief=t.prompt({**c,'reserve':reserve})+'\n本次是正式计时的新项目制作，勿查找、复用或修改其他项目之前做过的工程和音轨。两边均使用同一套冻结Scene素材与同一brief。正常只生成一条成功的完整混音；ASR中的同音词差异请先核对音频，不要仅因同音拼写就重复付费生成。对最终实际MP4做检查。异步导出必须复用已返回的task/job，不反复创建相同导出或无期限等待；确认成品就绪后及时结束。'
    (folder/'prompt.txt').write_text(brief)
    start=t.stamp();clock=time.monotonic();t.save(folder/'intent.json',{'case':c['id'],'requested_model':model,'started_at':start,'origin':preview['url'],'candidate_commit':preview['commit']})
    args=['node',str(ROOT/'packages/makaron-cli/bin/makaron.mjs'),'chat','--project','auto','--agent-model',model,'--skill','tiktok-video','--media-manifest',str(t.OUT/c['id']/'manifest.json'),'--json','-b',brief]
    p=subprocess.run(args,cwd=ROOT,env={**os.environ,'MAKARON_URL':origin},capture_output=True,text=True,timeout=180)
    try:v=json.loads(p.stdout)
    except ValueError:
        t.save(folder/'submission-error.json',{'at':t.stamp(),'exit_code':p.returncode,'error':p.stderr[-700:]});raise RuntimeError('Ambiguous formal submission; reconcile intent before retry')
    if p.returncode:raise RuntimeError(str(v)[:300])
    t.save(folder/'submission.json',{'case':c['id'],'kind':'tiktok','requested_model':model,'reserve':reserve,'submitted_at':start,'submit_finished_at':t.stamp(),'submit_seconds':time.monotonic()-clock,'origin':preview['url'],'candidate_commit':preview['commit'],'formal':True,**v})
    print('formal',c['id'],model,v['runId'],flush=True)

if __name__=='__main__':
    mode=sys.argv[1]
    cases=[c for c in t.CASES if c['kind']=='tiktok' and (len(sys.argv)<3 or c['id'] in sys.argv[2].split(','))]
    if mode=='submit':
        for i,c in enumerate(cases):
            for model in t.MODELS if i%2==0 else t.MODELS[::-1]:submit(c,model)
        t.save(t.OUT/'formal-submissions-complete.json',{'at':t.stamp(),'cases':[c['id'] for c in cases]})
    elif mode=='monitor':
        for iteration in range(360):
            jobs=[(c,m+'/formal-01') for c in cases for m in t.MODELS if (t.OUT/c['id']/m/'formal-01/submission.json').exists() and not (t.OUT/c['id']/m/'formal-01/terminal.json').exists()]
            if not jobs:
                if (t.OUT/'formal-submissions-complete.json').exists():break
                time.sleep(5);continue
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                fs=[pool.submit(t.poll,*job) for job in jobs]
                for f in fs:
                    try:f.result()
                    except Exception as exc:print(str(exc)[:250],flush=True)
            t.save(t.OUT/'budget.json',t.budget())
            subprocess.run([sys.executable,str(ROOT/'benchmarks/deepseek1017-round2-report.py')],check=True,capture_output=True)
            time.sleep(20)
