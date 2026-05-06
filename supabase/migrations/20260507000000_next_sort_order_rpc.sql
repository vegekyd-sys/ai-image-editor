-- Atomic sort_order allocation to prevent duplicates under concurrency
CREATE OR REPLACE FUNCTION next_sort_order(p_project_id uuid)
RETURNS integer
LANGUAGE sql
AS $$
  SELECT COALESCE(MAX(sort_order), -1) + 1 FROM snapshots WHERE project_id = p_project_id;
$$;
