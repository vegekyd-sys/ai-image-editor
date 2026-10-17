"""Read-only checks on actual MP4s, preserving each first delivery."""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import time

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/deepseek1017-luna'

def run(args,timeout=240):
    return subprocess.run(args,capture_output=True,text=True,timeout=timeout)

def verify(folder):
    latest=json.loads((folder/'latest.json').read_text())
    videos=[v for v in latest.get('output',[]) if v.get('type')=='video' and v.get('url') and v.get('status')=='completed']
    if not videos:
        return
    url=videos[-1]['url']
    if (folder/'qa.json').exists() and json.loads((folder/'qa.json').read_text()).get('url')==url:
        return
    started=time.monotonic()
    target=folder/'first-pass.mp4'
    if not target.exists():
        tmp=target.with_suffix('.download')
        download=run(['aria2c','--continue=true','--allow-overwrite=true','--file-allocation=none','--summary-interval=0','--console-log-level=warn','--max-tries=2','--retry-wait=2','-x','8','-s','8','-k','1M','-d',str(folder),'-o',tmp.name,url],timeout=240) if shutil.which('aria2c') else run(['curl','--fail','--location','--silent','--show-error','--retry','2','--max-time','180','--output',str(tmp),url],timeout=200)
        download.check_returncode()
        tmp.replace(target)
    probe=run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(target)])
    probe.check_returncode()
    meta=json.loads(probe.stdout)
    (folder/'ffprobe.json').write_text(json.dumps(meta,indent=2))
    video=next(s for s in meta['streams'] if s['codec_type']=='video')
    audios=[s for s in meta['streams'] if s['codec_type']=='audio']
    decode=run(['ffmpeg','-v','error','-i',str(target),'-map','0:v:0','-f','null','-'])
    (folder/'decode.log').write_text(decode.stderr)
    loudness=run(['ffmpeg','-hide_banner','-i',str(target),'-vn','-af','ebur128=peak=true','-f','null','-']) if audios else None
    if loudness:
        (folder/'loudness.log').write_text(loudness.stderr)
    integrated=re.findall(r'I:\s*(-?[0-9.]+) LUFS',loudness.stderr if loudness else '')
    peak=re.findall(r'Peak:\s*(-?[0-9.]+) dBFS',loudness.stderr if loudness else '')
    frames=run(['ffmpeg','-v','error','-i',str(target),'-vf','fps=1/5,scale=270:-2,tile=4x3','-frames:v','1','-update','1','-y',str(folder/'contact.jpg')])
    frames.check_returncode()
    end=run(['ffmpeg','-v','error','-ss','58.5','-i',str(target),'-frames:v','1','-vf','scale=360:-2','-update','1','-y',str(folder/'ending.jpg')])
    public=OUT/'review/assets'
    public.mkdir(exist_ok=True)
    poster_name='-'.join(folder.relative_to(OUT).parts)+'.jpg'
    poster=run(['ffmpeg','-v','error','-ss','1','-i',str(target),'-frames:v','1','-vf','scale=360:-2','-update','1','-y',str(public/poster_name)])
    poster.check_returncode()
    duration=float(meta['format']['duration'])
    qa={'url':url,'duration':duration,'duration_ok':59<=duration<=61,'width':video['width'],'height':video['height'],'vertical_ok':abs(video['width']/video['height']-9/16)<0.015,'audio_streams':len(audios),'integrated_lufs':float(integrated[-1]) if integrated else None,'true_peak_dbfs':float(peak[-1]) if peak else None,'decode_ok':decode.returncode==0 and not decode.stderr.strip(),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'check_seconds':time.monotonic()-started,'visual_review':'pending','continuous_motion_and_listening_review':'not verified by automated checks'}
    qa['poster_url']='assets/'+poster_name
    (folder/'qa.json').write_text(json.dumps(qa,indent=2))
    print(folder.parent.name,folder.name,json.dumps(qa),flush=True)

if __name__=='__main__':
    folders=[f.parent for case in OUT.glob('[0-9][0-9]') for f in case.rglob('latest.json')]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for f in pool.map(verify,folders):
            pass
