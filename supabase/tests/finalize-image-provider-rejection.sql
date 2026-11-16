-- Run with psql -X -f in a fresh local PostgreSQL cluster. No hosted database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF inet_server_addr() IS NOT NULL OR current_database() <> 'nano_rejection_test' THEN
    RAISE EXCEPTION 'Use a fresh Unix-socket database named nano_rejection_test';
  END IF;
END $$;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE projects(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users);
CREATE TABLE messages(id uuid PRIMARY KEY, project_id uuid REFERENCES projects, role text, content text, has_image boolean);
CREATE PUBLICATION supabase_realtime;
\ir ../migrations/20260411000000_agent_runs_events.sql
\ir ../migrations/20260411100000_agent_events_project_id.sql
\ir ../migrations/20260712000000_durable_agent_executions.sql
\ir ../migrations/20260712010000_agent_context_project_scope.sql
\ir ../migrations/20260722000000_agent_run_inputs.sql
\ir ../migrations/20260905190237_isolate_agent_execution_origins.sql
\ir ../migrations/20261116091132_finalize_image_provider_rejection.sql

CREATE FUNCTION pg_temp.reject_image(r uuid, a uuid, lease uuid, m uuid, loaded uuid[])
RETURNS text LANGUAGE sql AS $$
  SELECT finalize_image_provider_rejection(r, a, lease, 1, loaded, m, 'Starting. Provider 402.',
    false, 1, '{"type":"error","code":"image_provider_payment_required","message":"Provider 402."}',
    17, 3, '{"inputEpoch":1}', '{"nextAction":"Handle new input"}', 5, 1)
$$;

DO $$
DECLARE
  u uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  r uuid; a uuid; lease uuid; m uuid; first_input uuid; next_input uuid;
  scenario text; outcome text;
BEGIN
  INSERT INTO auth.users VALUES (u);
  INSERT INTO projects VALUES (p, u);
  FOREACH scenario IN ARRAY ARRAY['same version','new input','cancelled','lease taken'] LOOP
    r := gen_random_uuid(); a := gen_random_uuid(); lease := gen_random_uuid(); m := gen_random_uuid();
    INSERT INTO agent_runs(id, project_id, user_id, lease_token, attempt_count, execution_policy)
      VALUES (r, p, u, lease, 1, '{"durable":true,"maxAttempts":1}');
    first_input := append_agent_run_input(r, p, u, 'First image instruction');
    INSERT INTO agent_attempts(id, run_id, user_id, attempt_no, lease_token) VALUES (a,r,u,1,lease);
    INSERT INTO messages VALUES (m,p,'assistant','Starting.',false);
    CASE scenario
      WHEN 'new input' THEN next_input := append_agent_run_input(r, p, u, 'Translate text only');
      WHEN 'cancelled' THEN UPDATE agent_runs SET status = 'aborted', lease_token = NULL WHERE id = r;
      WHEN 'lease taken' THEN UPDATE agent_runs SET lease_token = gen_random_uuid() WHERE id = r;
      ELSE NULL;
    END CASE;

    outcome := pg_temp.reject_image(r,a,lease,m,ARRAY[first_input]);
    IF scenario IN ('cancelled','lease taken') THEN
      ASSERT outcome = 'aborted';
      ASSERT (SELECT status = 'running' AND terminal_code IS NULL FROM agent_attempts WHERE id = a);
      ASSERT (SELECT content = 'Starting.' FROM messages WHERE id = m);
      ASSERT NOT EXISTS (SELECT 1 FROM agent_events WHERE run_id = r);
      ASSERT NOT EXISTS (SELECT 1 FROM agent_context_snapshots WHERE run_id = r);
      ASSERT (SELECT status = 'pending' FROM agent_run_inputs WHERE id = first_input);
      CONTINUE;
    END IF;

    -- Reconcile a lost response by returning the durable receipt.
    ASSERT pg_temp.reject_image(r,a,lease,m,ARRAY[first_input]) = outcome;
    ASSERT (SELECT content = 'Starting. Provider 402.' FROM messages WHERE id = m);
    ASSERT (SELECT status = 'applied' AND applied_attempt_id = a FROM agent_run_inputs WHERE id = first_input);
    ASSERT (SELECT status = outcome AND input_tokens = 17 FROM agent_attempts WHERE id = a);
    IF scenario = 'same version' THEN
      ASSERT outcome = 'failed';
      ASSERT (SELECT status = 'failed' AND lease_token IS NULL FROM agent_runs WHERE id = r);
      ASSERT (SELECT count(*) = 1 FROM agent_events WHERE run_id = r AND type = 'error');
    ELSE
      ASSERT outcome = 'handed_off';
      ASSERT (SELECT status = 'running' AND next_attempt_at IS NOT NULL FROM agent_runs WHERE id = r);
      ASSERT (SELECT status = 'pending' FROM agent_run_inputs WHERE id = next_input);
      ASSERT (SELECT count(*) = 1 FROM agent_context_snapshots WHERE run_id = r);
      ASSERT NOT EXISTS (SELECT 1 FROM agent_events WHERE run_id = r AND type = 'error');
      ASSERT (SELECT attempt_no = 2 FROM claim_agent_execution(r,'new-worker',180));
    END IF;
  END LOOP;
END $$;
