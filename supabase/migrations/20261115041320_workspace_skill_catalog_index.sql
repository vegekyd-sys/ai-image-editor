-- Run as a standalone statement: concurrent build keeps existing reads/writes available.
-- Catalog entries are a few hundred rows among >560k workspace assets.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_skill_catalog
ON public.workspace_files (user_id, path)
WHERE path LIKE 'skills/%/SKILL.md'
   OR path LIKE 'skills/%/.makaron-skill-index.json';
