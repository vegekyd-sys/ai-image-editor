"""Candidate-only paid probe. A case's durable intent prevents duplicate POSTs.
Run with a case JSON path; resume uses only the saved provider receipt.
Secrets are loaded from an existing env file and are never written to evidence.
"""
import fcntl, json, os, pathlib, re, sys, time, urllib.request, urllib.error, urllib.parse

case_path = pathlib.Path(sys.argv[1])
case = json.loads(case_path.read_text())
out = case_path.parent / case_path.stem
out.mkdir(exist_ok=True)
env_text = pathlib.Path(os.environ['PROBE_ENV_FILE']).read_text()
env = {m[1]: m[2].strip().strip('"\'') for m in re.finditer(r'^([A-Z0-9_]+)=(.*)$', env_text, re.M)}
headers = {'Authorization': 'Key ' + env['FAL_KEY'], 'Content-Type': 'application/json'}

def request(url, body=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers), timeout=60)
    except urllib.error.HTTPError as e:
        r = e
    return r.status, dict(r.headers), json.loads(r.read())

receipt = out / 'receipt.json'
if not receipt.exists():
    # Exclusive create is an at-most-once gate, including unknown transport outcomes.
    with (case_path.parent / 'budget.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        committed = 0.0
        for intent in case_path.parent.glob('*/intent.json'):
            prior = json.loads(intent.read_text()); result = intent.parent / 'result.json'
            cost = json.loads(result.read_text()).get('providerCostUsd') if result.exists() else None
            committed += cost if cost is not None else prior['reservedCeilingUsd']
        external = case_path.parent / 'budget-external.json'
        if external.exists(): committed += json.loads(external.read_text())['reservedOrSpentUsd']
        if committed + case['reservedCeilingUsd'] > 10: raise RuntimeError('Total $10 ceiling would be exceeded; no submission')
        with (out / 'intent.json').open('x') as f:
            json.dump({'started': time.time(), 'case': case, 'reservedCeilingUsd': case['reservedCeilingUsd']}, f)
    status, h, data = request('https://queue.fal.run/' + case['endpoint'], case['input'])
    receipt.write_text(json.dumps({'httpStatus': status, 'task': data}, indent=2))
else:
    data = json.loads(receipt.read_text())['task']
if not data.get('request_id'):
    print(case_path.stem, 'submission failed; see receipt; do not resubmit')
    sys.exit(1)
result_url = data['response_url']
assert result_url.startswith('https://queue.fal.run/')
for _ in range(180):
    status, h, state = request(data['status_url'])
    (out / 'status.json').write_text(json.dumps(state, indent=2))
    if state.get('status') == 'COMPLETED':
        break
    if status >= 400:
        print(case_path.stem, 'query failed', status); sys.exit(2)
    time.sleep(2)
else:
    print(case_path.stem, 'pending; resume same case'); sys.exit(3)
status, h, result = request(result_url)
units = next((v for k,v in h.items() if k.lower() == 'x-fal-billable-units'), None)
record = {'httpStatus': status, 'billableUnits': units, 'providerCostUsd': float(units)*case['unitPriceUsd'] if units else None, 'wallSeconds': time.time()-json.loads((out/'intent.json').read_text())['started'], 'result': result}
(out / 'result.json').write_text(json.dumps(record, indent=2))
if status < 400:
    for i, item in enumerate(result.get('images', [result['image']] if 'image' in result else [])):
        url = item['url']; assert urllib.parse.urlparse(url).hostname.endswith('.fal.media')
        with urllib.request.urlopen(url, timeout=120) as r:
            (out / f'output-{i}.png').write_bytes(r.read())
print(case_path.stem, status, 'units', units, 'USD', record['providerCostUsd'], 'seconds', round(record['wallSeconds'], 2))
