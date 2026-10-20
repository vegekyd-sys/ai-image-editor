"""Read-only observer for formal paired outputs; never creates paid work."""
import importlib.util
import concurrent.futures
from pathlib import Path
import subprocess
import time
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('t',ROOT/'benchmarks/deepseek1017-round2.py');t=importlib.util.module_from_spec(s);s.loader.exec_module(t)
def refresh_usage(p):
    sub=t.read(p/'submission.json')
    value=t.cli(['makaron','usage','--run',sub['runId'],'--json'])
    t.save(p/'usage-live.json',value)
for i in range(240):
    if i%2==0:
        folders=[p.parent for p in t.OUT.glob('*/**/formal-01/submission.json')]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for future in [pool.submit(refresh_usage,p) for p in folders]:
                try:future.result()
                except Exception as exc:print('usage',str(exc)[:300],flush=True)
    for name in ['verify','evidence','report']:
        p=subprocess.run(['python3',str(ROOT/f'benchmarks/deepseek1017-round2-{name}.py')],capture_output=True,text=True)
        if p.stdout:print(p.stdout,flush=True)
        if p.returncode:print(name,p.stderr[-1200:],flush=True)
    folders=[p.parent for p in t.OUT.glob('*/**/formal-01/submission.json')]
    if len(folders)==10 and all((p/'terminal.json').exists() and ((p/'qa.json').exists() or not t.read(p/'terminal.json').get('has_output')) and (p/'timing-evidence.json').exists() for p in folders):break
    time.sleep(30)
