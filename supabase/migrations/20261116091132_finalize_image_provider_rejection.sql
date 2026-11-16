-- Serialize a terminal provider rejection with append_agent_run_input, cancellation
-- and lease takeover. A newer user instruction gets one dispatch of its own,
-- including when the rejected attempt had reached its automatic retry limit.
CREATE FUNCTION public.finalize_image_provider_rejection(
  p_run_id uuid, p_attempt_id uuid, p_lease_token uuid, p_input_epoch bigint,
  p_message_id uuid, p_content text, p_has_image boolean, p_seq integer,
  p_terminal jsonb, p_input_tokens bigint, p_output_tokens bigint, p_attempt_metadata jsonb,
  p_snapshot jsonb, p_snapshot_tokens integer, p_snapshot_version integer
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  job public.agent_runs%ROWTYPE;
  new_input boolean;
  outcome text;
BEGIN
  SELECT * INTO job FROM public.agent_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR job.status <> 'running' OR job.lease_token IS DISTINCT FROM p_lease_token THEN
    UPDATE public.agent_attempts SET status = 'aborted', ended_at = now()
      WHERE id = p_attempt_id AND run_id = p_run_id AND lease_token = p_lease_token AND status = 'running';
    RETURN 'aborted';
  END IF;
  IF p_input_epoch IS NULL OR p_input_epoch > job.input_version
     OR p_terminal->>'code' IS DISTINCT FROM 'image_provider_payment_required' THEN
    RAISE EXCEPTION 'Invalid image rejection or input version';
  END IF;
  new_input := job.input_version > p_input_epoch;
  outcome := CASE WHEN new_input THEN 'handed_off' ELSE 'failed' END;

  UPDATE public.agent_attempts SET status = outcome, ended_at = now(),
    input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    terminal_code = CASE WHEN new_input THEN 'agent_input_received' ELSE p_terminal->>'code' END,
    metadata = metadata || p_attempt_metadata
    WHERE id = p_attempt_id AND run_id = job.id AND lease_token = p_lease_token AND status = 'running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Image rejection attempt does not own this run'; END IF;

  INSERT INTO public.messages AS m (id, project_id, role, content, has_image)
    VALUES (p_message_id, job.project_id, 'assistant', p_content, p_has_image)
    ON CONFLICT (id) DO UPDATE SET content = excluded.content, has_image = excluded.has_image
    WHERE m.project_id = excluded.project_id AND m.role = 'assistant';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid assistant message for this project'; END IF;

  IF new_input THEN
    INSERT INTO public.agent_context_snapshots
      (run_id, attempt_id, project_id, user_id, version, kind, content, token_estimate)
      VALUES (job.id, p_attempt_id, job.project_id, job.user_id, p_snapshot_version,
              'attempt_handoff', p_snapshot, p_snapshot_tokens);
    UPDATE public.agent_runs SET next_attempt_at = now(), current_work_unit = 'agent',
      lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastHandoff',
        jsonb_build_object('attemptId', p_attempt_id, 'attemptNo', job.attempt_count,
                           'terminalCode', 'agent_input_received', 'nextAction', p_snapshot->>'nextAction'))
      WHERE id = job.id;
  ELSE
    INSERT INTO public.agent_events (run_id, project_id, seq, type, data)
      VALUES (job.id, job.project_id, p_seq, 'error', p_terminal - 'type');
    UPDATE public.agent_run_inputs SET status = 'applied', applied_at = now(), applied_attempt_id = p_attempt_id
      WHERE run_id = job.id AND status = 'pending';
    UPDATE public.agent_runs SET status = 'failed', ended_at = now(), next_attempt_at = NULL,
      lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('terminal', p_terminal)
      WHERE id = job.id;
  END IF;
  RETURN outcome;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_image_provider_rejection(uuid,uuid,uuid,bigint,uuid,text,boolean,integer,jsonb,bigint,bigint,jsonb,jsonb,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_image_provider_rejection(uuid,uuid,uuid,bigint,uuid,text,boolean,integer,jsonb,bigint,bigint,jsonb,jsonb,integer,integer) TO authenticated, service_role;
