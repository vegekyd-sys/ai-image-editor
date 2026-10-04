"""Read-only audit of active public home skill ZIPs; never changes live templates."""
import concurrent.futures,io,json,re,urllib.request,zipfile
from pathlib import Path
root=Path('artifacts/h3max-integration'); root.mkdir(parents=True,exist_ok=True)
rows=json.load(open(root/'home-skills.json'))
def inspect(row):
 out={'id':row['id'],'labels':row.get('labels'),'url':row.get('skill_path'),'matches':[]}
 if not out['url']:return out
 try:
  req=urllib.request.Request(out['url'],headers={'User-Agent':'Makaron-Compatibility-Audit'})
  data=urllib.request.urlopen(req,timeout=30).read(20*1024*1024+1)
  if len(data)>20*1024*1024:raise ValueError('ZIP exceeds audit limit')
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   for f in z.infolist():
    if f.file_size>2*1024*1024 or not f.filename.endswith(('.md','.json','.ts','.js','.yaml','.yml','.txt')):continue
    lines=z.read(f).decode('utf-8',errors='replace').splitlines()
    for i,l in enumerate(lines):
     if re.search(r'minimax|h3[ -]?(max|turbo)|H3|Turbo',l,re.I):out['matches'].append({'file':f.filename,'line':i+1,'text':l[:900]})
 except Exception as e:out['error']=type(e).__name__+': '+str(e)[:150]
 return out
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(inspect,rows))
(root/'template-audit.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps({'active':len(rows),'scanned':sum(bool(r['url']) and not r.get('error') for r in results),'matched':sum(bool(r['matches']) for r in results),'errors':[{k:r.get(k) for k in ['id','error']} for r in results if r.get('error')]},ensure_ascii=False))
for r in results:
 if r['matches']:print(json.dumps({'name':r['labels'],'matches':r['matches']},ensure_ascii=False))
