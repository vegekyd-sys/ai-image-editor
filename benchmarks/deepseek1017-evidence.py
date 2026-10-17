"""Fetch terminal event evidence through the public CLI; never starts creation."""
import concurrent.futures
import json
import pathlib
import subprocess
import os
import collections

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/deepseek1017-luna'

def collect(folder):
    if not (folder/'terminal.json').exists():
        return
    target=folder/'complete-events.json'
    if not target.exists():
        sub=json.loads((folder/'submission.json').read_text())
        p=subprocess.run(['node',str(ROOT/'packages/makaron-cli/bin/makaron.mjs'),'responses','get',sub['runId'],'--events','--json'],capture_output=True,text=True,env={**os.environ,'MAKARON_URL':'https://www.makaron.app'},timeout=90)
        data=json.loads(p.stdout)
        target.write_text(json.dumps(data,ensure_ascii=False,indent=2))
    data=json.loads(target.read_text())
    page=data.get('events',[])
    while len(page)==1000:
        after=page[-1]['seq']
        sub=json.loads((folder/'submission.json').read_text())
        p=subprocess.run(['node',str(ROOT/'packages/makaron-cli/bin/makaron.mjs'),'responses','get',sub['runId'],'--events','--after',str(after),'--json'],capture_output=True,text=True,env={**os.environ,'MAKARON_URL':'https://www.makaron.app'},timeout=90)
        page=json.loads(p.stdout).get('events',[])
        if page and page[-1]['seq']<=after:
            raise RuntimeError('Event sequence did not advance')
        data['events'].extend(page)
        target.write_text(json.dumps(data,ensure_ascii=False,indent=2))
    tools=[{'event':e['type'],'tool':e['data'].get('tool'),'at':e.get('created_at'),'seq':e.get('seq')} for e in data.get('events',[]) if e['type'] in ('tool_call','tool_result')]
    stages=[]
    for item in data.get('output',[]):
        if item.get('type')=='studio_run':
            stages=item.get('stages',[])
    result={'actual_agent_models':[e.get('model') for e in data.get('usage',{}).get('entries',[]) if e.get('tool_name')=='agent'],'tool_call_counts':dict(collections.Counter(e['tool'] for e in tools if e['event']=='tool_call')),'tool_events':tools,'studio_stages':[{k:s.get(k) for k in ['id','status','stageUpdatedAt','artifactCreatedAt']} for s in stages],'agent_created_at':data.get('created_at'),'agent_completed_at':data.get('completed_at'),'agent_seconds':data.get('progress',{}).get('run_wall_seconds'),'credits':data.get('usage',{}).get('credits_net')}
    (folder/'timing-evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(folder.parent.name,folder.name,result['tool_call_counts'],flush=True)

if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(collect,[p.parent for case in OUT.glob('[0-9][0-9]') for p in case.rglob('terminal.json')]))
