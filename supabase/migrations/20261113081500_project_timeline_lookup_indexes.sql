-- Project reads and RLS owner lookups must not scan global history tables.
-- On the shared live database, build each index CONCURRENTLY as a separate
-- statement; the ordinary form also supports transactional fresh installs.
CREATE INDEX IF NOT EXISTS idx_projects_user_id_id ON public.projects (user_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_project_created ON public.messages (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_sort ON public.snapshots (project_id, sort_order);
