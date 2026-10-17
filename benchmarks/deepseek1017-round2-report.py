"""Bounded public viewer metadata; no source capability URLs or raw tool logs."""
import importlib.util
import json
from pathlib import Path
import shutil
import datetime as dt

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('trial',ROOT/'benchmarks/deepseek1017-round2.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
PUBLIC=t.OUT/'review';PUBLIC.mkdir(exist_ok=True)
(PUBLIC/'assets').mkdir(exist_ok=True)
rows=[]
for c in t.CASES:
    retrieval=t.read(t.OUT/c['id']/'retrieval-timing.json')
    row={k:c[k] for k in ['id','name','kind','theme']};row.update({k:retrieval.get(k) for k in ['clip_count','source_seconds','seconds']});row['models']=[]
    for model,label in zip(t.MODELS,['DeepSeek Flash 1017 · 读图修复版','GPT-6 Luna · Codex 对照']):
        folder=t.OUT/c['id']/model;sub=t.read(folder/'submission.json');v=t.read(folder/'latest.json');first=t.read(folder/'first-artifact.json');qa=t.read(folder/'qa.json');terminal=t.read(folder/'terminal.json')
        expected='image' if c['kind']=='image' else 'video'
        original=v;original_first=first;original_folder=folder
        recovery_paths=sorted(folder.glob('recovery-*/latest.json'))
        for recovery in recovery_paths:
            candidate=t.read(recovery)
            if any(x.get('type')==expected and x.get('status')=='completed' and x.get('url') for x in candidate.get('output',[])):
                folder=recovery.parent;v=candidate;first=t.read(folder/'first-artifact.json');qa=t.read(folder/'qa.json');terminal=t.read(folder/'terminal.json')
        outputs=[x for x in v.get('output',[]) if x.get('type')==expected and x.get('status')=='completed' and x.get('url')]
        status=v.get('status','未提交' if not sub else '已提交')
        if status=='completed' and not outputs:status='执行结束，未交付产物'
        row['models'].append({'model':model,'label':label,'status':status,'url':outputs[-1]['url'] if outputs else None,'seconds':first.get('client_elapsed_seconds') if outputs else None,'terminal_seconds':terminal.get('client_elapsed_seconds'),'credits':v.get('usage',{}).get('credits_net'),'project_url':sub.get('projectUrl'),'run_id':sub.get('runId'),'qa':qa,'actual_models':sorted(set(e.get('model','') for e in v.get('usage',{}).get('entries',[]))),'text':v.get('result',{}).get('text','')[-1500:]})
        entry=row['models'][-1];entry['recovery']=folder!=original_folder;entry['first_pass_has_output']=bool(original_first);entry['first_pass_seconds']=original_first.get('client_elapsed_seconds');entry['first_pass_status']=original.get('status');entry['credits']=max(original.get('usage',{}).get('credits_net',0) or 0,t.read(original_folder/'usage-live.json').get('summary',{}).get('credits_net',0) or 0)+sum(t.read(p).get('usage',{}).get('credits_net',0) or 0 for p in recovery_paths)
        observations=(folder/'observations.jsonl').read_text().splitlines() if (folder/'observations.jsonl').exists() else []
        previous=None
        for line in observations:
            observation=__import__('json').loads(line)
            if first.get('observed_at') and observation['observed_at']>=first['observed_at']:
                break
            previous=observation
        if first.get('observed_at') and previous:
            entry['polling_uncertainty_seconds']=(dt.datetime.fromisoformat(first['observed_at'])-dt.datetime.fromisoformat(previous['observed_at'])).total_seconds()
        if entry['recovery'] and first.get('observed_at'):
            entry['recovery_seconds']=entry['seconds'];entry['seconds']=(dt.datetime.fromisoformat(first['observed_at'])-dt.datetime.fromisoformat(sub['submitted_at'])).total_seconds()
        entry['host_intervention']=t.read(original_folder/'host-intervention.json')
        if qa.get('local_file') and (qa.get('decode_ok') or qa.get('image_ok')):
            source=Path(qa['local_file']);link=PUBLIC/'assets'/f"{c['id']}-{model}{source.suffix}"
            if link.is_symlink() and link.resolve()!=source:link.unlink()
            if not link.exists():link.symlink_to(source)
            entry['display_url']=f'assets/{link.name}'
    rows.append(row)
t.save(PUBLIC/'data.json',{'generated_at':t.stamp(),'rows':rows,'budget':t.budget(),'notes':'本轮新增预算上限30美元。创作全部通过Makaron Chat CLI；Scene CLI共同检索并冻结素材。DeepSeek使用独立worktree读图修复；Luna明确走原Codex套餐。生成模型由各Agent自动选择，记录在每条任务中。计时为提交至首次观察到产物（约35秒轮询误差），实际文件仍须单独验收。'})
shutil.copyfile(ROOT/'benchmarks/deepseek1017-round2-review.html',PUBLIC/'index.html')
old=ROOT/'artifacts/deepseek1017-luna/review'
link=old/'round2'
if not link.exists():link.symlink_to(PUBLIC,target_is_directory=True)
print('round2 viewer updated')
