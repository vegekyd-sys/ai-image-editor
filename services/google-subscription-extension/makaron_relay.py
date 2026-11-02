"""Opt-in Makaron routes mounted on Scene's existing account relay.

No Scene membership, recipe, job table or endpoint is changed. The host owns
OAuth, safety(), status(), authorize() and native.ready(). Video bytes go only
to the authenticated Cloud worker, never through this process.
"""
from datetime import datetime, timezone
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import sqlite3
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener
from uuid import UUID

MODEL = 'gemini-3.8-flash'
ACCOUNT_MODEL = 'gemini-3.8-flash-medium'
MAX_BYTES = 38_500_000
OPS = {'makaron_video_analysis', 'makaron_image_analysis', 'makaron_frame_verify', 'makaron_frame_locate'}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


class Rejection(Exception):
    def __init__(self, code, status=503, submissions=0):
        self.code, self.status, self.submissions = code, status, submissions


class MakaronRelay:
    def __init__(self, host, cloud_url, owner, *, cloud_call=None, authorize_user=None):
        if not cloud_url.startswith('https://') or not owner or owner not in host.owners:
            raise ValueError('Verified service owner and private Cloud URL required')
        self.host, self.cloud_url, self.owner = host, cloud_url.rstrip('/'), owner
        self.cloud_call = cloud_call or self._cloud_call
        self.authorize_user = authorize_user or self._authorize_user
        self.slots = threading.BoundedSemaphore(2)
        self.completed = threading.Condition()
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY)')
            db.execute('''CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL,
                       digest TEXT NOT NULL, state TEXT NOT NULL, submissions INTEGER NOT NULL,
                       result TEXT, error TEXT, created REAL NOT NULL)''')
            # No replay or deletion of old IDs. A crash cannot prove Google did not run.
            db.execute("UPDATE jobs SET state='FAILED', error='relay_unknown_outcome' WHERE state='RUNNING'")

    def db(self):
        return sqlite3.connect(self.host.state_dir / 'makaron.sqlite3', timeout=5)

    def members(self, ids=None):
        with self.db() as db:
            if ids is not None:
                if (not isinstance(ids, list) or len(ids) > 100
                        or any(not isinstance(i, str) or not i.strip() or len(i) > 100 for i in ids)):
                    raise Rejection('invalid_allowlist', 400)
                db.execute('BEGIN IMMEDIATE')
                db.execute('DELETE FROM members')
                db.executemany('INSERT INTO members VALUES (?)', ((i,) for i in set(ids)))
            return {'userIds': [r[0] for r in db.execute('SELECT id FROM members ORDER BY id')]}

    def status(self, original):
        available = original.get('available') and original.get('native_video') == 'ready'
        return {**original,
            'capabilities': original.get('capabilities', []) + (sorted(OPS) if available else []),
            'makaron_video_analysis': {'version': 1, 'model': MODEL, 'processing': 'static',
                'thinking': 'low', 'input': 'cloud-source-url', 'output': 'text',
                'source_unmodified': True, 'max_source_bytes': MAX_BYTES}}

    def validate(self, payload):
        allowed = {'operation','job_id','model','user_id','source_url','max_source_bytes',
                   'question','processing','thinking','timeout_ms','cloud_identity_token','images'}
        try:
            valid_id = isinstance(payload.get('job_id'), str) and str(UUID(payload['job_id'])) == payload['job_id']
        except (ValueError, TypeError, AttributeError):
            valid_id = False
        operation = payload.get('operation')
        if (set(payload) - allowed or not valid_id or operation not in OPS
                or payload.get('model') != MODEL or payload.get('processing') != 'static'
                or payload.get('thinking') != 'low' or payload.get('max_source_bytes') != MAX_BYTES
                or not isinstance(payload.get('question'), str) or not 0 < len(payload['question']) <= 150000
                or not isinstance(payload.get('cloud_identity_token'), str)
                or not 20 < len(payload['cloud_identity_token']) < 10000
                or type(payload.get('timeout_ms')) is not int or not 1000 <= payload['timeout_ms'] <= 120000):
            raise Rejection('video_request_rejected', 400)
        needs_video = operation in {'makaron_video_analysis', 'makaron_frame_locate'}
        if needs_video != bool(payload.get('source_url')):
            raise Rejection('video_source_unsupported', 400)
        images = payload.get('images', [])
        expected = {'makaron_video_analysis':0,'makaron_image_analysis':1,'makaron_frame_verify':2,'makaron_frame_locate':1}[operation]
        if (not isinstance(images, list) or len(images) != expected
                or any(not isinstance(i, dict) or set(i) != {'mimeType','data'}
                    or i['mimeType'] not in {'image/jpeg','image/png','image/webp','image/gif'}
                    or not isinstance(i['data'], str) or len(i['data']) > 10000000 for i in images)):
            raise Rejection('video_source_unsupported', 400)
        if payload.get('user_id') not in self.members()['userIds']:
            raise Rejection('unauthorized', 403)

    def enqueue(self, owner, payload):
        if owner != self.owner:
            raise Rejection('unauthorized', 403)
        self.validate(payload)
        digest = hashlib.sha256(canonical(payload)).hexdigest()
        with self.db() as db:
            row = db.execute('SELECT owner,digest FROM jobs WHERE id=?', (payload['job_id'],)).fetchone()
        if row:
            if row != (owner, digest):
                raise Rejection('job_identity_conflict', 409, 1)
            return {'state':'ACCEPTED','job_id':payload['job_id']}
        if not self.authorize_user(payload, digest): raise Rejection('unauthorized',403)
        status = self.host.status()
        quota = status.get('quota', {})
        buckets = quota.get('buckets', [])
        if (not status.get('available') or not 0 <= time.time()-quota.get('checked_at', 0) <= 120
                or len(buckets) != 2 or {b.get('id') for b in buckets} != {'gemini-weekly','gemini-5h'}
                or any(not isinstance(b.get('remaining_fraction'), (int,float))
                    or not math.isfinite(b['remaining_fraction']) or not 0 < b['remaining_fraction'] <= 1 for b in buckets)):
            raise Rejection('quota_exhausted' if status.get('quota_exhausted') else 'quota_unavailable')
        self.host.safety()
        try:
            self.host.native.ready()
        except Exception:
            raise Rejection('native_auth_unavailable') from None
        if any(datetime.fromisoformat(b.get('reset_time','').replace('Z','+00:00')).timestamp() <= time.time() for b in buckets):
            raise Rejection('quota_unavailable')
        if not self.slots.acquire(blocking=False):
            raise Rejection('relay_busy')
        acquired = True
        try:
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                # Another instance/thread may have admitted while checking quota.
                row = db.execute('SELECT owner,digest FROM jobs WHERE id=?', (payload['job_id'],)).fetchone()
                if row:
                    self.slots.release()
                    acquired = False
                    if row != (owner,digest): raise Rejection('job_identity_conflict',409,1)
                    return {'state':'ACCEPTED','job_id':payload['job_id']}
                db.execute("INSERT INTO jobs VALUES (?,?,?,'RUNNING',0,NULL,NULL,?)",
                           (payload['job_id'], owner, digest, time.time()))
            threading.Thread(target=self.execute, args=(payload, digest), daemon=True).start()
        except Exception:
            if acquired: self.slots.release()
            raise
        return {'state':'ACCEPTED','job_id':payload['job_id']}

    def execute(self, payload, digest):
        job_id = payload['job_id']
        started = time.monotonic()
        try:
            # Revocations apply to a queued job as well as a new admission.
            if payload.get('user_id') not in self.members()['userIds'] or not self.authorize_user(payload,digest):
                with self.db() as db:
                    db.execute("UPDATE jobs SET state='FAILED',error='unauthorized',submissions=0 WHERE id=?",(job_id,))
                return
            self.host.safety()
            authorize_ms = round((time.monotonic()-started)*1000)
            # Conservatively mark possibly-submitted before sending Cloud POST.
            with self.db() as db:
                db.execute('UPDATE jobs SET submissions=1 WHERE id=?', (job_id,))
            cloud_start = time.monotonic()
            value = self.cloud_call(payload, digest)
            if (value.get('job_id') != job_id or value.get('request_sha256') != digest
                    or value.get('owner_id') != self.owner):
                raise Rejection('unverified_relay_receipt', submissions=1)
            with self.db() as db:
                if value.get('state') == 'SUCCEEDED':
                    value['result']['timings_ms'] = {
                        **value.get('timings_ms',{}), 'execute_authorization':authorize_ms,
                        'cloud_roundtrip':round((time.monotonic()-cloud_start)*1000),
                        'relay_execute':round((time.monotonic()-started)*1000)}
                    db.execute("UPDATE jobs SET state='SUCCEEDED',result=?,submissions=1 WHERE id=?",
                               (json.dumps(value['result'], allow_nan=False),job_id))
                elif value.get('state') == 'FAILED' and type(value.get('generator_submissions')) is int:
                    db.execute("UPDATE jobs SET state='FAILED',error=?,submissions=? WHERE id=?",
                               (value.get('error','relay_unknown_outcome'),value['generator_submissions'],job_id))
                else:
                    raise Rejection('relay_unknown_outcome', submissions=1)
        except Exception:
            with self.db() as db:
                db.execute("UPDATE jobs SET state='FAILED',error='relay_unknown_outcome' WHERE id=?", (job_id,))
        finally:
            payload.clear()
            self.slots.release()
            with self.completed: self.completed.notify_all()

    def job(self, owner, job_id, wait_ms=0):
        wait_ms = min(1000,max(0,wait_ms))
        deadline = time.monotonic()+wait_ms/1000
        with self.completed:
            while True:
                with self.db() as db:
                    row = db.execute('SELECT state,submissions,result,error FROM jobs WHERE id=? AND owner=?', (job_id,owner)).fetchone()
                if not row: raise Rejection('job_not_found',404,1)
                if row[0] != 'RUNNING' or time.monotonic() >= deadline: break
                self.completed.wait(deadline-time.monotonic())
        return {'job_id':job_id,'state':row[0],'generator_submissions':row[1],
                **({'poll_after_ms':0} if wait_ms else {}),
                **({'result':json.loads(row[2])} if row[0]=='SUCCEEDED' else {'error':row[3]} if row[0]=='FAILED' else {})}

    def _authorize_user(self, payload, digest):
        # Fixed trusted Makaron deployment, never a client-supplied callback.
        url = os.environ['MAKARON_AUTHORIZATION_URL']
        from urllib.parse import urlsplit
        parsed = urlsplit(url)
        loopback = parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1','localhost'}
        if ((parsed.scheme != 'https' and not loopback) or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path != '/api/internal/google-relay-authorize'):
            return False
        body = canonical({'user_id':payload['user_id'],'job_id':payload['job_id'],'request_sha256':digest})
        stamp = str(int(time.time()))
        signature = hmac.new(self.host.secret.encode(),b'makaron-job-authorization\n'+stamp.encode()+b'\n'+body,hashlib.sha256).hexdigest()
        from native_video import NoRedirect
        request = Request(url,data=body,headers={'Content-Type':'application/json',
            'x-makaron-authorization-timestamp':stamp,'x-makaron-authorization-signature':signature})
        with build_opener(NoRedirect()).open(request,timeout=5) as response:
            result = json.loads(response.read(4097))
        return result.get('allowed') is True and result.get('job_id') == payload['job_id'] and result.get('request_sha256') == digest

    def _cloud_call(self, payload, digest):
        # The host's official CLI refreshes this credential. No API key or ADC.
        token_file = self.host.home / '.gemini/antigravity-cli/antigravity-oauth-token'
        if token_file.stat().st_mode & 0o077:
            raise Rejection('native_auth_unavailable')
        token = json.loads(token_file.read_text())['token']['access_token']
        body = {k:v for k,v in payload.items() if k != 'cloud_identity_token'}
        body.update(access_token=token, project=self.host.native.project, owner_id=self.owner, request_sha256=digest)
        headers = {'Authorization':'Bearer '+payload['cloud_identity_token'],'Content-Type':'application/json'}
        from native_video import NoRedirect
        opener = build_opener(NoRedirect())
        # Single admission only. Any loss is recovered by reading the same ID.
        try:
            req = Request(self.cloud_url+'/makaron/generate', data=canonical(body), headers=headers)
            with opener.open(req,timeout=payload['timeout_ms']/1000) as response:
                value = None
                for line in response:
                    if len(line) > 2000000: raise Rejection('unverified_relay_receipt',submissions=1)
                    value = json.loads(line)
            return value
        except Exception:
            try:
                req = Request(self.cloud_url+'/makaron/receipt/'+payload['job_id'],headers=headers)
                with opener.open(req,timeout=10) as response:
                    return json.loads(response.read(2000001))
            except Exception:
                raise Rejection('relay_unknown_outcome',submissions=1) from None


def mount_handler(base_handler, host, extension):
    """Compose with the unmodified Scene handler; authorize every path once."""
    class Handler(base_handler):
        def dispatch(self):
            self.connection.settimeout(10)
            if '/v1/makaron-' not in self.path and not self.path.endswith('/v1/status'):
                return super().dispatch()
            try:
                length = int(self.headers.get('Content-Length','0'))
                limit = 21000000 if self.path.endswith('/v1/makaron-video-jobs') else 100000
                if not 0 <= length <= limit: raise Rejection('body_too_large',413)
                raw = self.rfile.read(length)
                owner = host.authorize(self.command,self.path,self.headers,raw)
                if self.path.endswith('/v1/status') and self.command == 'GET':
                    value = extension.status(host.status()) if owner == extension.owner else host.status()
                elif owner != extension.owner:
                    raise Rejection('unauthorized',403)
                elif self.path.endswith('/v1/makaron-allowlist'):
                    if self.command not in {'GET','POST'}: raise Rejection('not_found',404)
                    value = extension.members(json.loads(raw)['userIds'] if self.command == 'POST' else None)
                elif self.path.endswith('/v1/makaron-video-jobs') and self.command == 'POST':
                    value = extension.enqueue(owner,json.loads(raw))
                elif '/v1/makaron-video-jobs/' in self.path and self.command == 'GET':
                    value = extension.job(owner,self.path.rsplit('/',1)[-1],
                        wait_ms=int(self.headers.get('x-makaron-wait-ms','0')))
                else: raise Rejection('not_found',404)
                self.respond(202 if value.get('state') == 'ACCEPTED' else 200,value)
            except Rejection as exc:
                self.respond(exc.status,{'error':exc.code,'generator_submissions':exc.submissions})
            except Exception:
                # Authorization/admission outcome is not sufficient evidence of
                # no submission unless the specific path established it.
                self.respond(503,{'error':'relay_unavailable'})
    return Handler
