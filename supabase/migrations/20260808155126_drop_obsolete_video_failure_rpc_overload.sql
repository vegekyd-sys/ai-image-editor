-- Supabase's Data API cannot dispatch overloaded Postgres functions. Production
-- retained the original UUID signature alongside the TEXT repair, causing every
-- failure/refund RPC to return an ambiguous-function 500.
DROP FUNCTION IF EXISTS public.fail_video_snapshot_and_refund(UUID, TEXT);

-- Fail the migration if the canonical TEXT implementation is unexpectedly
-- missing. snapshots.id is TEXT, so this is the only supported signature.
DO $$
BEGIN
  IF to_regprocedure('public.fail_video_snapshot_and_refund(text,text)') IS NULL THEN
    RAISE EXCEPTION 'canonical fail_video_snapshot_and_refund(TEXT, TEXT) is missing';
  END IF;
END;
$$;
