"""Terminal usage and paginated timestamps through the same Chat CLI."""
import collections
import concurrent.futures
import importlib.util
import datetime as dt
import json
import os
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('trial',ROOT/'benchmarks/deepseek1017-round2.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
def collect(folder):
    sub=t.read(folder/'submission.json')
    first=t.read(folder/'first-artifact.json')
    if sub.get('formal') and first and not (folder/'first-video-ready.json').exists():
        for output in first.get('outputs',[]):
            task=output.get('task_id','')
            if not task.startswith('remotion-export-'):continue
            job_id=task.removeprefix('remotion-export-')
            p=subprocess.run(['node',str(ROOT/'packages/makaron-cli/bin/makaron.mjs'),'composition','status',job_id,'--json'],cwd=ROOT,env=t.OBSERVATION_ENV,capture_output=True,text=True,timeout=60)
            if p.returncode:raise RuntimeError('Export status CLI failed: '+p.stderr[-250:])
            job=json.loads(p.stdout);t.save(folder/'first-export-job.json',job)
            if job.get('status')=='completed' and job.get('completed_at'):
                elapsed=(dt.datetime.fromisoformat(job['completed_at'].replace('Z','+00:00'))-dt.datetime.fromisoformat(sub['submitted_at'])).total_seconds()
                if elapsed<0:raise RuntimeError('Clock mismatch: export completed before submission')
                t.save(folder/'first-video-ready.json',{'seconds':elapsed,'completed_at':job['completed_at'],'task_id':task,'source':'Makaron composition status completed_at; client submission UTC start','render_seconds':job.get('render_seconds'),'created_at':job.get('created_at'),'started_at':job.get('started_at'),'observed_upper_bound_seconds':first['client_elapsed_seconds']})
                break
    if not (folder/'terminal.json').exists() or (folder/'timing-evidence.json').exists():return
    sub=t.read(folder/'submission.json');data=t.cli(['makaron','responses','get',sub['runId'],'--events','--json']);page=data.get('events',[])
    while len(page)==1000:
        after=page[-1]['seq'];page=t.cli(['makaron','responses','get',sub['runId'],'--events','--after',str(after),'--json']).get('events',[])
        if page and page[-1]['seq']<=after:raise RuntimeError('Event cursor did not advance')
        data['events'].extend(page)
    t.save(folder/'complete-events.json',data)
    t.save(folder/'usage.json',t.cli(['makaron','usage','--run',sub['runId'],'--json']))
    tools=[{'type':e['type'],'tool':e.get('data',{}).get('tool'),'at':e.get('created_at'),'seq':e.get('seq')} for e in data.get('events',[]) if e['type'] in ('tool_call','tool_result')]
    t.save(folder/'timing-evidence.json',{'actual_models':data.get('usage',{}).get('entries',[]),'tool_events':tools,'tool_call_counts':dict(collections.Counter(x['tool'] for x in tools if x['type']=='tool_call')),'created_at':data.get('created_at'),'completed_at':data.get('completed_at'),'server_seconds':data.get('progress',{}).get('run_wall_seconds'),'event_count':len(data.get('events',[]))})
    print(str(folder.relative_to(t.OUT)),len(data.get('events',[])),'events',flush=True)
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(collect,[p.parent for p in t.OUT.glob('*/**/submission.json')]))
