#!/usr/bin/env python3
"""Creates and stops a fresh, socket-only PostgreSQL cluster. Never connects remotely."""
import json, os, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BIN=Path(os.environ.get('LOCAL_PG_BIN','/opt/homebrew/opt/postgresql@16/bin'))
TABLES=['agent_challenges','credit_pricing','health_alerts','subscriptions','token_rates']
A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222'
results=[]
with tempfile.TemporaryDirectory(prefix='makaron-rls-',dir='/tmp') as temp:
 t=Path(temp);data=t/'data';sock=t/'socket';sock.mkdir()
 def run(args,**kw):return subprocess.run([str(a) for a in args],text=True,capture_output=True,**kw)
 p=run([BIN/'initdb','-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);assert p.returncode==0,p.stderr
 p=run([BIN/'pg_ctl','-D',data,'-l',t/'postgres.log','-o',f"-k {sock} -p 55490 -c listen_addresses=''",'start']);assert p.returncode==0,p.stderr
 try:
  def sql(q):
   return run([BIN/'psql','-X','-h',sock,'-p','55490','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-A','-t','-q'],input=q)
  def ok(name,q,expected=None):
   r=sql(q);assert r.returncode==0,(name,r.stderr)
   if expected is not None:assert r.stdout.strip()==expected,(name,r.stdout,expected)
   results.append({'case':name,'pass':True})
  def denied(name,role,uid,q):
   r=sql(f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL request.jwt.claim.sub = '{uid}'; SET LOCAL request.jwt.claims = '{{\"sub\":\"{uid}\",\"role\":\"{role}\"}}'; {q}; ROLLBACK;")
   assert r.returncode!=0 and '42501' in r.stderr,(name,r.stdout,r.stderr)
   results.append({'case':name,'pass':True,'sqlstate':'42501'})
  ok('reconstruct catalog schema', (ROOT/'supabase/tests/internal-tables-fixture.sql').read_text())
  ok('synthetic users',f"INSERT INTO auth.users VALUES ('{A}'),('{B}');")
  inserts={
   'agent_challenges':"INSERT INTO public.agent_challenges(challenge_text,expected_answer,user_id) VALUES ('synthetic challenge','42','%s')"%A,
   'credit_pricing':"INSERT INTO public.credit_pricing(tool_name,supplier_cost,credits) VALUES ('synthetic',1,2)",
   'health_alerts':"INSERT INTO public.health_alerts(service,error,latency_ms) VALUES ('synthetic','synthetic unavailable',1)",
   'subscriptions':"INSERT INTO public.subscriptions(user_id,stripe_subscription_id,stripe_customer_id,plan_id,billing_interval) VALUES ('%s','synthetic_sub','synthetic_customer','basic','month')"%A,
   'token_rates':"INSERT INTO public.token_rates(model_id,display_name) VALUES ('synthetic','Synthetic')"}
  for table,q in inserts.items():ok('seed '+table,q+';')
  for table in TABLES:ok('baseline anon can read '+table,f'SET ROLE anon; SELECT count(*) FROM public.{table};','1')
  migration=(ROOT/'supabase/migrations/20261022091148_lock_down_internal_public_tables.sql').read_text()
  ok('apply candidate',migration)
  ok('reapply candidate is idempotent',migration)
  ok('all five RLS enabled',"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;",'5')
  ok('no permissive policies needed',"SELECT count(*) FROM pg_policy;",'0')
  for role,uid,label in [('anon',A,'anon'),('authenticated',A,'user A'),('authenticated',B,'user B')]:
   for table in TABLES:
    col='user_id' if table in ['agent_challenges','subscriptions'] else ('tool_name' if table=='credit_pricing' else ('model_id' if table=='token_rates' else 'service'))
    for action,q in [('SELECT',f'SELECT * FROM public.{table}'),('INSERT',inserts[table]),('UPDATE',f'UPDATE public.{table} SET {col}={col}'),('DELETE',f'DELETE FROM public.{table}'),('TRUNCATE',f'TRUNCATE public.{table}')]:
     denied(f'{label} denied {action} {table}',role,uid,q)
  # Defense in depth: deliberately grant table access to a non-bypass local test role.
  ok('create local RLS probe role','CREATE ROLE rls_probe NOLOGIN; GRANT USAGE ON SCHEMA public TO rls_probe; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rls_probe;')
  for table in TABLES:
   ok('RLS hides '+table,f'SET ROLE rls_probe; SELECT count(*) FROM public.{table};','0')
   denied('RLS rejects insert '+table,'rls_probe',A,inserts[table])
  for table,q in inserts.items():
   ok('service reads '+table,f'SET ROLE service_role; SELECT count(*) FROM public.{table};','1')
   col='user_id' if table in ['agent_challenges','subscriptions'] else ('tool_name' if table=='credit_pricing' else ('model_id' if table=='token_rates' else 'service'))
   ok('service updates '+table,f'BEGIN;SET LOCAL ROLE service_role; WITH changed AS (UPDATE public.{table} SET {col}={col} RETURNING 1) SELECT count(*) FROM changed;ROLLBACK;','1')
   ok('service deletes/inserts '+table,f'BEGIN;SET LOCAL ROLE service_role; DELETE FROM public.{table}; {q}; SELECT count(*) FROM public.{table};ROLLBACK;','1')
  ok('service subscription upsert',f"BEGIN;SET LOCAL ROLE service_role; INSERT INTO public.subscriptions(user_id,plan_id,billing_interval,provider) VALUES ('{A}','pro','year','apple') ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id;SELECT plan_id FROM public.subscriptions WHERE user_id='{A}';ROLLBACK;",'pro')
  # Both user records remain available to the server; ownership must still be filtered by the API.
  ok('server filters two users',f"BEGIN;INSERT INTO public.subscriptions(user_id,plan_id,billing_interval,provider) VALUES ('{B}','business','month','apple');SET LOCAL ROLE service_role;SELECT plan_id FROM public.subscriptions WHERE user_id='{A}';SELECT plan_id FROM public.subscriptions WHERE user_id='{B}';ROLLBACK;",'basic\nbusiness')
  # Guard must refuse policy drift without removing the unexpected policy.
  ok('introduce local policy drift','CREATE POLICY unexpected ON public.token_rates FOR SELECT TO authenticated USING (true);')
  r=sql(migration);assert r.returncode!=0 and 'Unexpected existing policy' in r.stderr,r.stderr
  results.append({'case':'migration refuses policy drift','pass':True})
  report={'postgres_version':run([BIN/'postgres','--version']).stdout.strip(),'environment':'fresh local socket-only cluster; schema from catalog; synthetic rows only','passed':len(results),'results':results}
  print(json.dumps(report,indent=2))
 finally:
  p=run([BIN/'pg_ctl','-D',data,'stop','-m','fast']);assert p.returncode==0,p.stderr
