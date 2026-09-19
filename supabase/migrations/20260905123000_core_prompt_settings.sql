-- Server-only release switch. Existing app_settings has no RLS in production;
-- keep this rollout isolated instead of changing unrelated settings permissions.
CREATE TABLE public.core_prompt_settings (
  key text PRIMARY KEY CHECK (key = 'core_prompt_mode'),
  value text NOT NULL CHECK (value IN ('legacy', 'layered')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.core_prompt_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_prompt_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_prompt_settings TO service_role;
INSERT INTO public.core_prompt_settings (key, value) VALUES ('core_prompt_mode', 'layered');
