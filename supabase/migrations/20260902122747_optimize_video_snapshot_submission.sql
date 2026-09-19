-- Insert a video snapshot and allocate its timeline position in one database
-- transaction. The advisory lock scopes serialization to one project, so
-- unrelated projects can still insert concurrently.
CREATE OR REPLACE FUNCTION public.insert_video_snapshot_atomic(
  p_snapshot_id text,
  p_project_id uuid,
  p_image_url text,
  p_tips jsonb,
  p_message_id text,
  p_type text,
  p_video_meta jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sort_order integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));

  SELECT COALESCE(MAX(sort_order), -1) + 1
  INTO v_sort_order
  FROM public.snapshots
  WHERE project_id = p_project_id;

  INSERT INTO public.snapshots (
    id,
    project_id,
    image_url,
    tips,
    message_id,
    sort_order,
    type,
    video_meta
  ) VALUES (
    p_snapshot_id,
    p_project_id,
    p_image_url,
    COALESCE(p_tips, '[]'::jsonb),
    COALESCE(p_message_id, ''),
    v_sort_order,
    p_type,
    p_video_meta
  );

  RETURN v_sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_video_snapshot_atomic(
  text, uuid, text, jsonb, text, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_video_snapshot_atomic(
  text, uuid, text, jsonb, text, text, jsonb
) TO authenticated, service_role;
