import importlib
import os
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from uuid import uuid4

from makaron_relay import MakaronRelay, Rejection, canonical
os.environ.update(SCENE_GEMINI_GCS_BUCKET='test-bucket',MAKARON_GEMINI_OWNER_ID='owner',MAKARON_STORAGE_HOST='example.supabase.co',MAKARON_ACCOUNT_PROJECT='project',MAKARON_RECEIPT_PREFIX='scene-index/gcs/makaron-test-receipts')
from cloud import source_url, verified_result, analysis_prompt, validate


class Tests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        quota={'checked_at':time.time(),'buckets':[{'id':i,'remaining_fraction':.8,'reset_time':'2099-01-01T00:00:00+00:00'} for i in ['gemini-weekly','gemini-5h']]}
        self.host=SimpleNamespace(state_dir=Path(self.directory.name),owners={'owner','scene-other'},
            status=lambda:{'available':True,'native_video':'ready','quota':quota,'capabilities':['video_analysis']},
            safety=lambda:None,native=SimpleNamespace(ready=lambda:None))
        self.calls=[];self.done=threading.Event()
        def cloud(payload,digest):
            self.calls.append(dict(payload));self.done.set()
            return {'job_id':payload['job_id'],'owner_id':'owner','request_sha256':digest,
                    'state':'SUCCEEDED','result':{'analysis':'OK'}}
        self.relay=MakaronRelay(self.host,'https://private.a.run.app','owner',cloud_call=cloud,authorize_user=lambda *_:True)
        self.relay.members(['admin'])
        self.payload={'job_id':str(uuid4()),'operation':'makaron_video_analysis','model':'gemini-3.8-flash',
            'user_id':'admin','source_url':'https://www.makaron.app/home-hero/cloud-house-v2.mp4',
            'question':'Q','max_source_bytes':38500000,'processing':'static','thinking':'low',
            'timeout_ms':10000,'cloud_identity_token':'test-token-32-characters-long'}
    def tearDown(self):
        # Workers use the temporary DB; wait before deleting it.
        for _ in range(100):
            with self.relay.db() as db:
                if not db.execute("SELECT 1 FROM jobs WHERE state='RUNNING'").fetchone():break
            time.sleep(.01)
        self.directory.cleanup()
    def test_duplicate_admission_generates_once(self):
        self.relay.enqueue('owner',dict(self.payload));self.done.wait(1)
        self.relay.enqueue('owner',dict(self.payload))
        self.assertEqual(len(self.calls),1)
        altered={**self.payload,'question':'different'}
        with self.assertRaises(Rejection): self.relay.enqueue('owner',altered)
        self.assertEqual(len(self.calls),1)
    def test_waiting_receipt_wakes_on_completion_and_keeps_one_generation(self):
        release=threading.Event();started=threading.Event();original=self.relay.cloud_call
        def cloud(payload,digest):
            started.set();release.wait(3)
            return original(payload,digest)
        self.relay.cloud_call=cloud
        self.relay.enqueue('owner',dict(self.payload));self.assertTrue(started.wait(1))
        pending=self.relay.job('owner',self.payload['job_id'],wait_ms=1)
        self.assertEqual(pending['state'],'RUNNING');self.assertEqual(pending['poll_after_ms'],0)
        result=[]
        reader=threading.Thread(target=lambda:result.append(self.relay.job('owner',self.payload['job_id'],wait_ms=1000)))
        reader.start();release.set();reader.join(2)
        self.assertFalse(reader.is_alive());self.assertEqual(result[0]['state'],'SUCCEEDED')
        self.assertEqual(len(self.calls),1)
    def test_owner_and_member_boundaries(self):
        with self.assertRaises(Rejection):self.relay.enqueue('scene-other',self.payload)
        with self.assertRaises(Rejection):self.relay.enqueue('owner',{**self.payload,'user_id':'not-listed-admin'})
        self.relay.members([])
        with self.assertRaises(Rejection):self.relay.enqueue('owner',self.payload)
        self.assertEqual(self.calls,[])
    def test_fresh_authorization_denies_without_submission(self):
        self.relay.authorize_user=lambda *_:False
        with self.assertRaises(Rejection):self.relay.enqueue('owner',self.payload)
        self.assertEqual(self.calls,[])
    def test_role_revoked_between_admission_and_execution(self):
        results=iter([True,False])
        self.relay.authorize_user=lambda *_:next(results)
        self.relay.enqueue('owner',dict(self.payload))
        for _ in range(100):
            result=self.relay.job('owner',self.payload['job_id'])
            if result['state']=='FAILED':break
            time.sleep(.01)
        self.assertEqual(result['generator_submissions'],0);self.assertEqual(self.calls,[])
    def test_bad_recipe_has_no_generation(self):
        for mutation in [{'thinking':'high'},{'processing':'agentic'},{'model':'other'},{'max_source_bytes':999999999},
                         {'timeout_ms':False},{'images':[{'mimeType':'video/mp4','data':'abc'}]}]:
            with self.subTest(mutation=mutation):
                with self.assertRaises(Rejection):self.relay.enqueue('owner',{**self.payload,**mutation})
        self.assertEqual(self.calls,[])
    def test_stale_or_exhausted_quota_prevents_admission(self):
        self.host.status=lambda:{'available':True,'quota':{'checked_at':time.time()-121,'buckets':[]}}
        with self.assertRaises(Rejection) as exc:self.relay.enqueue('owner',self.payload)
        self.assertEqual(exc.exception.submissions,0);self.assertEqual(self.calls,[])
    def test_restart_retains_unknown_and_does_not_replay(self):
        with self.relay.db() as db:
            import hashlib
            digest=hashlib.sha256(canonical(self.payload)).hexdigest()
            db.execute("INSERT INTO jobs VALUES (?,?,?,'RUNNING',1,NULL,NULL,?)",(self.payload['job_id'],'owner',digest,time.time()))
        restarted=MakaronRelay(self.host,'https://private.a.run.app','owner',cloud_call=lambda *_:self.fail('must not replay'),authorize_user=lambda *_:True)
        restarted.enqueue('owner',self.payload)
        self.assertEqual(restarted.job('owner',self.payload['job_id'])['error'],'relay_unknown_outcome')
        with self.assertRaises(Rejection):restarted.job('scene-other',self.payload['job_id'])
    def test_scene_status_is_preserved(self):
        old=self.host.status();new=self.relay.status(old)
        self.assertEqual(old['capabilities'],['video_analysis'])
        self.assertIn('video_analysis',new['capabilities']);self.assertIn('makaron_video_analysis',new['capabilities'])
    def test_source_allowlist_rejects_redirect_and_proxy_targets(self):
        for url in ['http://www.makaron.app/home-hero/a.mp4','https://www.makaron.app/api/proxy?a=1',
                    'https://www.makaron.app.evil.test/home-hero/a.mp4','https://localhost/a',
                    'https://cdn.makaron.app/not-storage','https://user:pass@cdn.makaron.app/storage/v1/object/x']:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):source_url(url)
        self.assertEqual(source_url(self.payload['source_url']),self.payload['source_url'])
    def test_candidate_launcher_rejects_production_state_before_constructing_host(self):
        import subprocess,sys
        root=Path(self.directory.name)
        (root/'server.py').write_text("from pathlib import Path\nclass Relay:\n def __init__(self): Path("+repr(str(root/'mutated'))+").touch()\ndef handler(host):return None\n")
        (root/'state-link').symlink_to('/srv/vlab/scene-gemini-relay/state',target_is_directory=True)
        for state in ['/srv/vlab/scene-gemini-relay/state',str(root/'state-link')]:
            env={**os.environ,'SCENE_GEMINI_APP':str(root),'SCENE_GEMINI_STATE':state}
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('relay_entry.py'))],env=env,capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn(b'Candidate entry refuses',result.stderr)
            self.assertFalse((root/'mutated').exists())
    def test_cloud_input_validation(self):
        body={k:v for k,v in self.payload.items() if k!='cloud_identity_token'}
        body.update(owner_id='owner',access_token='t'*32,project='project',request_sha256='a'*64)
        validate(body)
        with self.assertRaises(Exception):validate({**body,'access_token':'short'})
        with self.assertRaises(Exception):validate({**body,'source_url':'https://evil.test/a'})
    def test_receipt_honestly_distinguishes_missing_and_zero_paid_telemetry(self):
        body={'request_sha256':'a'*64}
        raw={'response':{'modelVersion':'gemini-3.8-flash-n','usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':20},
                        'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'private','thought':True},{'text':'Visible result'}]}}]}}
        r=verified_result(raw,body,{})
        self.assertIsNone(r['consumed_credits']);self.assertEqual(r['paid_credit_status'],'not_reported')
        self.assertEqual(r['analysis'],'Visible result')
        self.assertEqual(verified_result({**raw,'consumedCredits':0},body,{})['paid_credit_status'],'reported_zero')
        for bad in [1,-1,True,'0',{}]:
            with self.subTest(bad=bad):
                with self.assertRaises((ValueError,TypeError)):verified_result({**raw,'consumedCredits':bad},body,{})
        raw['response']['candidates'][0]['finishReason']='MAX_TOKENS'
        with self.assertRaises(ValueError):verified_result(raw,body,{})
    def test_silent_source_prompt(self):
        text=analysis_prompt('Describe.',5.184,False)
        self.assertIn('Measured container duration: 5.184 seconds',text)
        self.assertIn('no audio track',text)
        self.assertNotIn('no audio track',analysis_prompt('Q',5.184,True))

if __name__=='__main__':unittest.main()
