"""Inspect actual files. All creative changes remain inside Makaron Chat."""
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import fcntl
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('trial',ROOT/'benchmarks/deepseek1017-round2.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
def run(args,timeout=240):return subprocess.run(args,capture_output=True,text=True,timeout=timeout)
def verify(job):
    c,model=job;folder=t.OUT/c['id']/model
    with (folder/'.verify.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        try:_verify(job)
        finally:fcntl.flock(lock,fcntl.LOCK_UN)

def _verify(job):
    c,model=job;folder=t.OUT/c['id']/model;v=t.read(folder/'latest.json')
    kind='image' if c['kind']=='image' else 'video'
    outputs=[x for x in v.get('output',[]) if x.get('type')==kind and x.get('status')=='completed' and x.get('url')]
    if not outputs:return
    first=t.read(folder/'first-artifact.json')
    if t.read(folder/'submission.json').get('formal') and first:
        initial=[x for x in first.get('outputs',[]) if x.get('type')==kind and x.get('url')]
        if initial:
            for output in outputs:
                if output['url']!=initial[0]['url']:
                    version=folder/'versions'/output.get('task_id','additional-output')
                    t.save(version/'latest.json',{'status':'completed','output':[output]})
            outputs=initial[:1]
    url=outputs[-1]['url'];qa=t.read(folder/'qa.json')
    if qa.get('url')==url:return
    target=folder/('output.jpg' if kind=='image' else 'output.mp4')
    source=t.read(folder/'download-source.json')
    if target.exists() and ((qa.get('url') and qa['url']!=url) or (source.get('url') and source['url']!=url)):
        raise RuntimeError('Existing output differs; preserve and inspect before replacing')
    t.save(folder/'download-source.json',{'url':url,'local_file':str(target)})
    if not target.exists():
        tmp=target.with_suffix('.download');p=run(['curl','--fail','--location','--silent','--show-error','--retry','2','--max-time','180','--output',str(tmp),url],200);p.check_returncode();tmp.replace(target)
    qa={'url':url,'checked_at':t.stamp(),'local_file':str(target),'visual_review':'待人工查看实际画面'}
    if kind=='image':
        with Image.open(target) as im:
            im.load();qa.update(image_ok=True,width=im.width,height=im.height)
            thumb=im.copy();thumb.thumbnail((1100,1100));thumb.convert('RGB').save(folder/'preview.jpg')
    else:
        p=run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(target)]);p.check_returncode();meta=json.loads(p.stdout);t.save(folder/'ffprobe.json',meta)
        video=next(s for s in meta['streams'] if s['codec_type']=='video');audio=[s for s in meta['streams'] if s['codec_type']=='audio'];duration=float(meta['format']['duration'])
        p=run(['ffmpeg','-v','error','-i',str(target),'-map','0:v:0','-f','null','-']);(folder/'decode.log').write_text(p.stderr)
        qa.update(duration=duration,width=video['width'],height=video['height'],audio_streams=len(audio),decode_ok=p.returncode==0 and not p.stderr.strip())
        p=run(['ffmpeg','-hide_banner','-i',str(target),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'])
        (folder/'loudness.log').write_text(p.stderr)
        match=re.search(r'\{\s*"input_i".*?\}',p.stderr,re.S)
        if match:
            loud=json.loads(match.group());qa.update(integrated_lufs=float(loud['input_i']),true_peak_dbfs=float(loud['input_tp']))
        p=run(['ffmpeg','-hide_banner','-i',str(target),'-vf','blackdetect=d=0.15:pix_th=0.1','-an','-f','null','-']);(folder/'blackdetect.log').write_text(p.stderr)
        qa['black_intervals']=[{'start':float(a),'end':float(b),'duration':float(d)} for a,b,d in re.findall(r'black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)',p.stderr)]
        times=[0.2,2,5,8,11,min(14.7,duration-.2)] if duration<20 else [.2,2,8,15,23,31,39,47,55,duration-.3]
        frames=[]
        for i,sec in enumerate(times):
            frame=folder/f'frame-{i:02}.jpg';p=run(['ffmpeg','-v','error','-ss',str(sec),'-i',str(target),'-frames:v','1','-vf','scale=270:-2','-y',str(frame)]);p.check_returncode()
            with Image.open(frame) as im:frames.append(im.copy().convert('RGB'))
        w=max(im.width for im in frames);h=max(im.height for im in frames)+25;cols=5 if len(frames)>6 else 3
        sheet=Image.new('RGB',(cols*w,((len(frames)+cols-1)//cols)*h),'#eeeae6');draw=ImageDraw.Draw(sheet)
        for i,im in enumerate(frames):
            x=(i%cols)*w;y=(i//cols)*h;sheet.paste(im,(x,y));draw.text((x+8,y+h-20),f'{times[i]:.1f}s',fill='black')
        sheet.save(folder/'contact.jpg')
    t.save(folder/'qa.json',qa);print(c['id'],model,{k:qa.get(k) for k in ['image_ok','duration','width','height','decode_ok','audio_streams','integrated_lufs']},flush=True)
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(verify,[(c,str(p.parent.relative_to(t.OUT/c['id']))) for c in t.CASES for p in (t.OUT/c['id']).glob('**/latest.json')]))
