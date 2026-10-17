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
        folder=t.OUT/c['id']/model
        if c['kind']=='tiktok':folder=folder/'formal-01'
        sub=t.read(folder/'submission.json');v=t.read(folder/'latest.json');first=t.read(folder/'first-artifact.json');qa=t.read(folder/'qa.json');terminal=t.read(folder/'terminal.json')
        expected='image' if c['kind']=='image' else 'video'
        original=v;original_first=first;original_folder=folder
        recovery_paths=sorted(folder.glob('recovery-*/latest.json'))
        for recovery in recovery_paths:
            candidate=t.read(recovery)
            if any(x.get('type')==expected and x.get('status')=='completed' and x.get('url') for x in candidate.get('output',[])):
                folder=recovery.parent;v=candidate;first=t.read(folder/'first-artifact.json');qa=t.read(folder/'qa.json');terminal=t.read(folder/'terminal.json')
        usage=v.get('usage') or t.read(folder/'usage-live.json').get('summary') or {}
        outputs=[x for x in v.get('output',[]) if x.get('type')==expected and x.get('status')=='completed' and x.get('url')]
        status=v.get('status',('正式Preview重跑准备中' if c['kind']=='tiktok' else '未提交') if not sub else '已提交')
        if status=='completed' and not outputs:status='执行结束，未交付产物'
        row['models'].append({'model':model,'label':label,'status':status,'url':outputs[-1]['url'] if outputs else None,'seconds':first.get('client_elapsed_seconds') if outputs else None,'terminal_seconds':terminal.get('client_elapsed_seconds'),'credits':usage.get('credits_net'),'project_url':sub.get('projectUrl'),'run_id':sub.get('runId'),'formal':bool(sub.get('formal')),'runtime':sub.get('origin'),'qa':qa,'actual_models':sorted(set(e.get('model','') for e in usage.get('entries',[]))),'text':v.get('result',{}).get('text','')[-1500:]})
        entry=row['models'][-1];entry['recovery']=folder!=original_folder;entry['first_pass_has_output']=bool(original_first);entry['first_pass_seconds']=original_first.get('client_elapsed_seconds');entry['first_pass_status']=original.get('status');entry['credits']=max(original.get('usage',{}).get('credits_net',0) or 0,t.read(original_folder/'usage-live.json').get('summary',{}).get('credits_net',0) or 0)+sum(t.read(p).get('usage',{}).get('credits_net',0) or 0 for p in recovery_paths)
        observations=(folder/'observations.jsonl').read_text().splitlines() if (folder/'observations.jsonl').exists() else []
        previous=None
        for line in observations:
            observation=__import__('json').loads(line)
            if first.get('observed_at') and observation.get('elapsed',float('inf'))>=first.get('client_elapsed_seconds',0):
                break
            previous=observation
        if first.get('observed_at') and previous:
            entry['polling_uncertainty_seconds']=(dt.datetime.fromisoformat(first['observed_at'])-dt.datetime.fromisoformat(previous['observed_at'])).total_seconds()
        if entry['recovery'] and first.get('observed_at'):
            entry['recovery_seconds']=entry['seconds'];entry['seconds']=(dt.datetime.fromisoformat(first['observed_at'])-dt.datetime.fromisoformat(sub['submitted_at'])).total_seconds()
        ready=t.read(folder/'first-video-ready.json')
        if ready:
            entry['observed_seconds']=entry['seconds'];entry['seconds']=ready['seconds'];entry['timing_source']='server_export_completed';entry['render_seconds']=ready.get('render_seconds')
        if sub.get('formal') and sub.get('projectId'):
            entry['project_url']=sub['origin']+'/projects/'+sub['projectId']
        entry['host_intervention']=t.read(original_folder/'host-intervention.json')
        if qa.get('local_file') and (qa.get('decode_ok') or qa.get('image_ok')):
            source=Path(qa['local_file']);link=PUBLIC/'assets'/f"{c['id']}-{model}{source.suffix}"
            if link.is_symlink() and link.resolve()!=source:link.unlink()
            if not link.exists():link.symlink_to(source)
            entry['display_url']=f'assets/{link.name}'
    rows.append(row)
t.save(PUBLIC/'data.json',{'generated_at':t.stamp(),'rows':rows,'budget':t.budget(),'notes':'本轮新增预算上限30美元，含早期本地尝试。60秒TikTok统一在同一独立Preview以全新项目正式重跑；本地受阻阶段仅归档，不计入正式速度结论。Scene素材与brief冻结配对；计时从各自提交开始至服务端首次MP4导出完成；另存客户端首次观察上界与Agent结束时间，尚无服务端时间时显示轮询上界。15秒mascot视频与图片沿用已完成配对。创作全部通过Makaron Chat CLI，Scene检索通过Scene CLI；Luna明确保留Codex套餐路由。'})
shutil.copyfile(ROOT/'benchmarks/deepseek1017-round2-review.html',PUBLIC/'index.html')
old=ROOT/'artifacts/deepseek1017-luna/review'
link=old/'round2'
if not link.exists():link.symlink_to(PUBLIC,target_is_directory=True)
print('round2 viewer updated')
