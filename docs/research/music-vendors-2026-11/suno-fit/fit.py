"""Pick the take closest to T and land exactly on T without cutting the ending.
longer by <=5%: speed up (pitch kept). shorter: slow down by at most 4%, rest is silence after the natural end."""
import json, subprocess, collections, sys
rows=[json.loads(l) for l in open('edits.jsonl')]
jobs=collections.defaultdict(list)
for r in rows:
    n=r['src'][4:-4]
    if n.startswith('bars_'): jobs[n.rsplit('_',1)[0]].append(r)
res=[]
for job, rs in sorted(jobs.items()):
    T=rs[0]['target']
    best=min(rs, key=lambda r: abs(r['natural_end']-T))
    end=best['natural_end']; ratio=end/T
    out=f"out/final_{job}.mp3"
    if ratio>1.05:
        print(job,'too long, use splice'); continue
    r=max(ratio,0.96)
    subprocess.run(['ffmpeg','-v','error','-y','-i',best['src'],'-af',f"atrim=end={end},atempo={r:.5f},apad",'-t',f'{T}','-b:a','192k',out],check=True)
    silence=max(0, T-end/r)
    res.append(dict(job=job,T=T,takes=[r_['natural_end'] for r_ in rs],pick=best['src'][4:-4],tempo=round(r,3),silence_tail=round(silence,2)))
    print(f"{job:20} takes={res[-1]['takes']} pick={res[-1]['pick']} tempo x{r:.3f} silence {silence:.2f}s")
json.dump(res,open('fit.json','w'),indent=1)
