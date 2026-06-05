-- First-party marketing event log.
-- Source of truth for ad funnel debugging; Meta/GA/PostHog remain downstream views.
CREATE TABLE IF NOT EXISTS marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  event_id text,
  event_source text NOT NULL DEFAULT 'browser',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  anonymous_id text,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  skill_id text,
  page_url text,
  page_path text,
  referrer text,
  user_agent text,
  fbp text,
  fbc text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  attribution jsonb NOT NULL DEFAULT '{}',
  event_params jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_events_event_name_event_id
  ON marketing_events(event_name, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at
  ON marketing_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_events_event_name_created_at
  ON marketing_events(event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_events_utm_campaign
  ON marketing_events(utm_campaign, created_at DESC)
  WHERE utm_campaign IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_events_skill_id
  ON marketing_events(skill_id, created_at DESC)
  WHERE skill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_events_user_id
  ON marketing_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_events_project_id
  ON marketing_events(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;

-- No client-side table policies on purpose.
-- Browser events are accepted by /api/marketing/events and inserted with service_role.
GRANT SELECT, INSERT ON marketing_events TO service_role;
