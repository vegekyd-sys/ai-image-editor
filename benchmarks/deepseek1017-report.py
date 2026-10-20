"""Publish only bounded experiment metadata to the local comparison viewer."""
import json
import pathlib
import datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT/'artifacts/deepseek1017-luna'
PUBLIC = OUT/'review'
PUBLIC.mkdir(exist_ok=True)
NAMES = ['振丰玩具','富阳云绒','帛卉化妆品','云南互祺食品','亦馨家居']

def read(p):
    return json.loads(p.read_text()) if p.exists() else {}

now = datetime.datetime.now(datetime.timezone.utc)
rows=[]
for i,name in enumerate(NAMES,1):
    num=f'{i:02}'
    retrieval=read(OUT/num/'retrieval-timing.json')
    row={'id':num,'name':name,'retrieval_seconds':retrieval.get('seconds'),'source_seconds':retrieval.get('source_seconds'),'clip_count':retrieval.get('clip_count'),'models':[]}
    for model,label in [('deepseek-flash','DeepSeek V4.1 Flash 1017'),('auto','默认 GPT-6 Luna · Codex')]:
        folder=OUT/num/model
        sub=read(folder/'submission.json')
        result=read(folder/'latest.json')
        first=result
        recovery=next(iter(sorted(folder.glob('recovery-*/latest.json'),reverse=True)),None)
        original_folder=folder
        if recovery:
            folder=recovery.parent
            result=read(recovery)
        videos=[v for v in result.get('output',[]) if v.get('type')=='video' and v.get('url') and v.get('status')=='completed']
        first_videos=[v for v in first.get('output',[]) if v.get('type')=='video' and v.get('url') and v.get('status')=='completed']
        corrected=bool(recovery and videos)
        started=sub.get('submitted_at')
        ended=None  # Agent end is not final MP4 readiness; use terminal observation below.
        elapsed=(datetime.datetime.fromisoformat(ended.replace('Z','+00:00')) if ended else now)-datetime.datetime.fromisoformat(started) if started else None
        qa=read(folder/'qa.json')
        if recovery and not videos and first_videos:
            videos=first_videos
            qa=read(original_folder/'qa.json')
        terminal=read(folder/'terminal.json')
        first_mp4=read(folder/'first-mp4.json')
        if first_mp4:
            elapsed=datetime.datetime.fromisoformat(first_mp4['observed_at'])-datetime.datetime.fromisoformat(started)
        elif terminal:
            elapsed=datetime.datetime.fromisoformat(terminal['observed_at'])-datetime.datetime.fromisoformat(started)
        row['models'].append({'model':model,'label':label,'status':result.get('status','pending'),'seconds':elapsed.total_seconds() if elapsed else None,'server_seconds':result.get('progress',{}).get('run_wall_seconds'),'credits':result.get('usage',{}).get('credits_net'),'actual_models':[e.get('model') for e in result.get('usage',{}).get('entries',[]) if e.get('tool_name')=='agent'],'project_url':sub.get('projectUrl'),'run_id':sub.get('runId'),'video_url':videos[-1]['url'] if videos else None,'qa':qa,'last_message':result.get('result',{}).get('text','')[-1100:]})
        entry=row['models'][-1]
        entry['poster_url']=qa.get('poster_url',f'assets/{num}-{model}.jpg')
        entry['first_pass_status']=first.get('status')
        entry['recovery']=bool(recovery)
        entry['corrected']=corrected
        entry['first_video_url']=first_videos[-1]['url'] if first_videos else None
        original_mp4=read(original_folder/'first-mp4.json') or read(original_folder/'terminal.json')
        entry['first_seconds']=original_mp4.get('client_elapsed_seconds') if first_videos else None
        entry['first_credits']=first.get('usage',{}).get('credits_net')
        if videos and qa.get('decode_ok') and entry['status']=='failed':
            entry['status']='新MP4已就绪（含失败旧任务）'
        if recovery:
            entry['credits']=(first.get('usage',{}).get('credits_net',0) or 0)+sum((read(p).get('usage',{}).get('credits_net',0) or 0) for p in original_folder.glob('recovery-*/latest.json'))
    rows.append(row)
value={'generated_at':now.isoformat(),'rows':rows,'budget':read(OUT/'budget.json'),'notes':'同题同素材同提示词；素材由公司 Scene CLI 检索。制作全部由 Makaron Chat CLI 完成。首轮使用线上链路，DeepSeek 工具图片回传缺陷随后在候选修复；本轮不代表修复后的模型能力。耗时为端到端观察值，约35秒轮询误差。目录价值 $0.01/Credit；Luna 套餐覆盖。首版与后续修正分开记录。'}
tmp=PUBLIC/'data.json.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2));tmp.replace(PUBLIC/'data.json')
print('viewer data updated')
