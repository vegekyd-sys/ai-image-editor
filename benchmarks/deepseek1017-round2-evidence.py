"""Terminal usage and paginated timestamps through the same Chat CLI."""
import collections
import concurrent.futures
import importlib.util
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('trial',ROOT/'benchmarks/deepseek1017-round2.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
def collect(folder):
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
