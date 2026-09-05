"""Prepare versioned public skill ZIPs with explicit Turbo copy. No live writes."""
import io,json,re,hashlib,urllib.request,zipfile,difflib
from pathlib import Path
root=Path('artifacts/h3max-integration/skill-copy');root.mkdir(parents=True,exist_ok=True)
rows=json.load(open('artifacts/h3max-integration/template-audit.json'))
groups={}
for row in rows:
 if any('minimax-h3-max' in m['text'] for m in row['matches']): groups.setdefault(row['url'],[]).append(row)
manifest=[]
for url,entries in groups.items():
 name=url.rsplit('/',1)[1][:-4];dest=root/name;dest.mkdir(exist_ok=True)
 data=urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Makaron-Compatibility-Audit"}),timeout=30).read();(dest/'original.zip').write_bytes(data)
 output=io.BytesIO();changes=[]
 with zipfile.ZipFile(io.BytesIO(data)) as src,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as out:
  for info in src.infolist():
   payload=src.read(info)
   if info.filename.endswith(('.md','.json','.yaml','.yml','.txt')):
    old=payload.decode('utf8');new=re.sub(r'(?i)(?:MiniMax\s+)?H3\s+Max(?:\s+Turbo)?','fal H3 Turbo',old)
    new=new.replace('minimax-h3-max-turbo','minimax-h3-max')
    if info.filename.endswith('SKILL.md'):
     new=new.rstrip()+'\n\n## Video model\n\nUse **fal H3 Turbo**, with `model: "minimax-h3-max"` for `generate_animation` or `--video-model minimax-h3-max` for the CLI. This skill uses one source image as the video start frame.\n'
    if new!=old:
     changes.append({'file':info.filename,'diff':''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=info.filename,tofile=info.filename))})
     payload=new.encode()
     if info.filename.endswith('SKILL.md'): (dest/'SKILL.md').write_bytes(payload)
   out.writestr(info,payload)
 updated=output.getvalue();(dest/'updated.zip').write_bytes(updated)
 (dest/'copy.diff').write_text('\n'.join(x['diff'] for x in changes))
 assert changes and len(changes)<15
 manifest.append({'name':name,'ids':[x['id'] for x in entries],'labels':[x['labels']['zh'] for x in entries],'oldUrl':url,'newUrl':url[:-4]+'-fal-turbo-20260905.zip','originalSha256':hashlib.sha256(data).hexdigest(),'sha256':hashlib.sha256(updated).hexdigest(),'directory':str(dest),'files':[x['file'] for x in changes]})
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps(manifest,ensure_ascii=False,indent=2))
