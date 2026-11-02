"""Private IAM-authenticated Cloud worker extension. Mount on the Scene worker
or run an isolated candidate; Cloud Run must require run.invoker authentication.
Original video bytes, OAuth tokens and URLs are never written to receipts.
"""
import asyncio
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from urllib.parse import quote, urlsplit
from uuid import UUID

import google.auth
from google.auth.transport.requests import Request as AuthRequest
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from makaron_relay import MODEL, ACCOUNT_MODEL, MAX_BYTES, OPS, canonical

BASE = 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent'
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
SLOTS = threading.BoundedSemaphore(2)
BUCKET = os.environ['SCENE_GEMINI_GCS_BUCKET']
PREFIX = os.environ['MAKARON_RECEIPT_PREFIX'].strip('/') + '/'
OWNER = os.environ['MAKARON_GEMINI_OWNER_ID']
ACCOUNT_PROJECT = os.environ['MAKARON_ACCOUNT_PROJECT']
STORAGE_HOST = os.environ['MAKARON_STORAGE_HOST']


def source_url(url):
    p = urlsplit(url)
    if p.scheme != 'https' or p.username or p.password or p.fragment or p.port not in {None,443}:
        raise ValueError('video_source_unsupported')
    if p.hostname in {'www.makaron.app','makaron.app'}:
        import re
        if not re.fullmatch(r'/home-hero/[a-z0-9-]+\.(mp4|webm)',p.path): raise ValueError('video_source_unsupported')
    elif p.hostname not in {STORAGE_HOST,'cdn.makaron.app'} or not p.path.startswith('/storage/v1/object/'):
        raise ValueError('video_source_unsupported')
    return url


def validate(body):
    keys = {'operation','job_id','model','user_id','source_url','max_source_bytes','question','processing',
            'thinking','timeout_ms','images','owner_id','request_sha256','project','access_token'}
    try:
        valid_id = str(UUID(body['job_id'])) == body['job_id']
    except (ValueError,KeyError,TypeError,AttributeError): valid_id = False
    if (not valid_id or set(body)-keys or body.get('owner_id') != OWNER or body.get('operation') not in OPS
            or body.get('model') != MODEL or body.get('processing') != 'static' or body.get('thinking') != 'low'
            or body.get('max_source_bytes') != MAX_BYTES or type(body.get('timeout_ms')) is not int
            or not 1000 <= body['timeout_ms'] <= 120000
            or not isinstance(body.get('question'),str) or not 0 < len(body['question']) <= 150000
            or not isinstance(body.get('request_sha256'),str) or len(body['request_sha256']) != 64
            or not isinstance(body.get('access_token'),str) or not 20 < len(body['access_token']) < 4096
            or body.get('project') != ACCOUNT_PROJECT):
        raise HTTPException(400,'video_request_rejected')
    needs_video = body['operation'] in {'makaron_video_analysis','makaron_frame_locate'}
    if needs_video != bool(body.get('source_url')): raise HTTPException(400,'video_source_unsupported')
    if needs_video:
        try: source_url(body['source_url'])
        except ValueError: raise HTTPException(400,'video_source_unsupported') from None
    expected = {'makaron_video_analysis':0,'makaron_image_analysis':1,'makaron_frame_verify':2,'makaron_frame_locate':1}[body['operation']]
    images = body.get('images',[])
    if not isinstance(images,list) or len(images) != expected: raise HTTPException(400,'video_source_unsupported')
    for image in images:
        if (not isinstance(image,dict) or set(image) != {'mimeType','data'}
                or image['mimeType'] not in {'image/jpeg','image/png','image/webp','image/gif'}
                or not isinstance(image['data'],str) or len(image['data']) > 10000000):
            raise HTTPException(400,'video_source_unsupported')
        try: base64.b64decode(image['data'],validate=True)
        except ValueError: raise HTTPException(400,'video_source_unsupported') from None


def storage():
    credential,_ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    credential.refresh(AuthRequest())
    return httpx.Client(headers={'Authorization':'Bearer '+credential.token},timeout=30,trust_env=False,follow_redirects=False)


def write(client,key,value,initial=False):
    params={'uploadType':'media','name':key}
    if initial: params['ifGenerationMatch']='0'
    r=client.post('https://storage.googleapis.com/upload/storage/v1/b/'+BUCKET+'/o',params=params,
                  content=canonical(value),headers={'Content-Type':'application/json'})
    if initial and r.status_code==412: return False
    r.raise_for_status();return True


def read(client,key):
    r=client.get('https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o/'+quote(key,safe=''),params={'alt':'media'})
    if r.status_code==404: raise HTTPException(404,'receipt_not_found')
    r.raise_for_status();return r.json()


def analysis_prompt(question,duration,has_audio):
    prefix = (f'Measured container duration: {duration:.15g} seconds. Inspect the complete timeline through its final frame; '
              'do not infer duration from sampled timestamps. Compare opening and ending framing before calling a camera static.\n\n') if duration else ''
    if has_audio is False:
        prefix += 'The source container has no audio track. Do not invent music, speech, or sound effects.\n\n'
    return prefix+question


def verified_result(raw,body,source):
    response=raw.get('response',{})
    actual=response.get('modelVersion')
    candidates=response.get('candidates',[])
    if (raw.get('consumedCredits') not in {None,0} or actual not in {'gemini-3.8-flash','gemini-3.8-flash-n'}
            or len(candidates)!=1 or candidates[0].get('finishReason')!='STOP'):
        raise ValueError('unverified_relay_receipt')
    parts=candidates[0].get('content',{}).get('parts',[])
    if any(set(p)-{'text','thought','thoughtSignature'} for p in parts): raise ValueError('unverified_relay_receipt')
    text='\n'.join(p.get('text','') for p in parts if not p.get('thought'))
    if not text.strip(): raise ValueError('unverified_relay_receipt')
    usage=response.get('usageMetadata',{})
    keys={'promptTokenCount','candidatesTokenCount','thoughtsTokenCount','cachedContentTokenCount','toolUsePromptTokenCount','totalTokenCount'}
    usage={k:v for k,v in usage.items() if k in keys}
    if (not {'promptTokenCount','candidatesTokenCount'} <= usage.keys()
            or any(type(v) is not int or v<0 for v in usage.values())): raise ValueError('unverified_relay_receipt')
    reported='consumedCredits' in raw
    if reported and (type(raw['consumedCredits']) not in {int,float} or raw['consumedCredits']!=0):
        raise ValueError('unverified_relay_receipt')
    return {'request_sha256':body['request_sha256'],'requested_model':MODEL,'model':actual,'account_model':ACCOUNT_MODEL,
            'transport':'antigravity-native-account','billing':'subscription-allowance','allowance_only':True,
            'paid_credit_status':'reported_zero' if reported else 'not_reported',
            'consumed_credits':0 if reported else None,'finish_reason':'STOP','processing':'static','thinking':'low',
            'generator_submissions':1,'media_on_v':False,'analysis':text,'source':source,'usage':usage}


def execute(body,value,client):
    started=time.monotonic();key=PREFIX+body['job_id']+'.json'
    try:
        deadline=started+body['timeout_ms']/1000
        parts=[{'inlineData':image} for image in body.get('images',[])]
        source={}
        duration=None;has_audio=None
        if body.get('source_url'):
            with tempfile.TemporaryDirectory(prefix='makaron-understand-') as temporary:
                path=Path(temporary)/'source';digest=hashlib.sha256();size=0
                with httpx.Client(timeout=min(45,body['timeout_ms']/1000),trust_env=False,follow_redirects=False) as fetch:
                    with fetch.stream('GET',source_url(body['source_url'])) as response:
                        response.raise_for_status()
                        mime=response.headers.get('content-type','').split(';')[0]
                        if mime not in {'video/mp4','video/webm','video/quicktime'}: raise ValueError('video_source_unsupported')
                        with path.open('wb') as output:
                            for chunk in response.iter_bytes(1024*1024):
                                if time.monotonic()>=deadline: raise ValueError('video_source_unsupported')
                                size+=len(chunk)
                                if size>MAX_BYTES: raise ValueError('video_source_unsupported')
                                digest.update(chunk);output.write(chunk)
                if not size: raise ValueError('video_source_unsupported')
                probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type','-of','json',str(path)],
                                     capture_output=True,check=True,timeout=min(10,max(1,deadline-time.monotonic())))
                metadata=json.loads(probe.stdout);duration=float(metadata['format']['duration'])
                if not math.isfinite(duration) or duration<=0: raise ValueError('video_source_unsupported')
                has_audio=any(s.get('codec_type')=='audio' for s in metadata['streams'])
                source={'prepared':False,'source_bytes':size,'input_bytes':size,'source_sha256':digest.hexdigest(),
                        'input_sha256':digest.hexdigest(),'duration_seconds':duration,'has_audio':has_audio}
                parts.append({'inlineData':{'mimeType':mime,'data':base64.b64encode(path.read_bytes()).decode()}})
        parts.append({'text':analysis_prompt(body['question'],duration,has_audio)})
        request={'contents':[{'role':'user','parts':parts}],
                 'generationConfig':{'thinkingConfig':{'thinkingLevel':'LOW'}}}
        if deadline-time.monotonic()<1: raise ValueError('video_source_unsupported')
        value.update(state='GENERATING',generator_submissions=1)
        write(client,key,value)  # Durable admission before the only generation.
        with httpx.Client(timeout=deadline-time.monotonic(),trust_env=False,follow_redirects=False) as native:
            response=native.post(BASE,json={'project':body['project'],'model':ACCOUNT_MODEL,'userAgent':'antigravity',
                                'requestId':body['job_id'],'request':request},
                                headers={'Authorization':'Bearer '+body['access_token'],'User-Agent':'antigravity/cli/1.3.3'})
            # Even a provider rejection follows a submission; do not auto-replay.
            if response.status_code!=200 or len(response.content)>2000000: raise ValueError('relay_terminal_failure')
            result=verified_result(response.json(),body,source)
        value.update(state='SUCCEEDED',result=result)
    except Exception:
        value.update(state='FAILED',error='relay_terminal_failure' if value['generator_submissions'] else 'video_source_unsupported')
    finally:
        value['elapsed_ms']=round((time.monotonic()-started)*1000)
        try: write(client,key,value)
        except Exception: pass # Prior admission blocks any duplicate inference.
        body.clear();client.close();SLOTS.release()


@app.get('/makaron/receipt/{job_id}')
def receipt(job_id:str):
    try:
        if str(UUID(job_id))!=job_id: raise ValueError()
    except ValueError: raise HTTPException(400,'invalid_job_id') from None
    with storage() as client: return read(client,PREFIX+job_id+'.json')


@app.post('/makaron/generate')
async def generate(request:Request):
    # Bound the streamed body even when Content-Length is omitted/untrusted.
    raw=bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw)>21000000: raise HTTPException(413,'body_too_large')
    body=json.loads(raw);validate(body)
    if not SLOTS.acquire(blocking=False): raise HTTPException(409,'relay_busy')
    client=None
    try:
        client=storage()
        value={'job_id':body['job_id'],'owner_id':OWNER,'request_sha256':body['request_sha256'],
               'state':'ACCEPTED','generator_submissions':0}
        key=PREFIX+body['job_id']+'.json'
        if not write(client,key,value,initial=True):
            previous=read(client,key)
            if previous.get('request_sha256')!=body['request_sha256'] or previous.get('owner_id')!=OWNER:
                raise HTTPException(409,'job_identity_conflict')
            client.close();SLOTS.release();return previous
        worker=threading.Thread(target=execute,args=(body,value,client),daemon=True);worker.start()
    except Exception:
        if client: client.close()
        SLOTS.release();raise
    async def stream():
        yield json.dumps({'state':'ACCEPTED'})+'\n'
        while worker.is_alive():
            await asyncio.sleep(1)
            yield json.dumps({'state':'WAITING'})+'\n'
        yield json.dumps(value,ensure_ascii=False)+'\n'
    return StreamingResponse(stream(),media_type='application/x-ndjson')
