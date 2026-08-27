CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  activated boolean NOT NULL DEFAULT false,
  invite_code_used text,
  is_agent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_balances (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0,
  trial_balance integer NOT NULL DEFAULT 0,
  trial_expires_at timestamptz,
  lifetime_purchased integer NOT NULL DEFAULT 0,
  lifetime_used integer NOT NULL DEFAULT 0,
  stripe_customer_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL UNIQUE,
  stripe_invoice_id text UNIQUE,
  credits integer NOT NULL,
  amount_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  source text NOT NULL,
  provider text,
  apple_transaction_id text UNIQUE,
  apple_original_transaction_id text,
  apple_product_id text,
  apple_environment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  apple_original_transaction_id text UNIQUE,
  apple_transaction_id text,
  apple_product_id text,
  apple_app_account_token text,
  apple_environment text,
  plan_id text NOT NULL,
  billing_interval text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.welcome_credit_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  grant_channel text NOT NULL,
  lifetime_used_at_claim integer NOT NULL DEFAULT 0,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.apple_trial_credit_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  apple_original_transaction_id text NOT NULL UNIQUE,
  apple_transaction_id text NOT NULL UNIQUE,
  credits_granted integer NOT NULL CHECK (credits_granted > 0),
  trial_expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pending_apple_trial_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_token_hash text NOT NULL UNIQUE,
  apple_original_transaction_id text NOT NULL UNIQUE,
  apple_transaction_id text NOT NULL UNIQUE,
  apple_product_id text NOT NULL,
  apple_environment text NOT NULL,
  signed_transaction_info text NOT NULL,
  meta_event_id text,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_apple_trial_claim_state_check CHECK (claimed_at IS NOT NULL OR claimed_by IS NULL)
);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  cover_url text,
  is_public boolean NOT NULL DEFAULT false,
  timeline_version integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  image_url text NOT NULL DEFAULT '',
  tips jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_id text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  description text,
  type text,
  design_path text,
  video_meta jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.messages (
  id text PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  has_image boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_animations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  video_url text,
  prompt text NOT NULL DEFAULT '',
  snapshot_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'processing',
  piapi_task_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.project_music (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  suno_task_id text,
  track_index integer NOT NULL DEFAULT 0,
  audio_url text,
  duration numeric,
  title text,
  tags text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workspace_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_url text,
  marketplace_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, path)
);

CREATE TABLE public.skill_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sharer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.home_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompts jsonb NOT NULL DEFAULT '{}'::jsonb,
  image text NOT NULL,
  before_images text[] NOT NULL DEFAULT '{}',
  prompt text NOT NULL DEFAULT '',
  skill_path text,
  image_count integer NOT NULL DEFAULT 1,
  categories text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.skill_categories (
  id text PRIMARY KEY,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  descriptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  icon text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.expire_apple_trial_credits(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  UPDATE credit_balances
  SET balance = greatest(0, balance - trial_balance),
      trial_balance = 0,
      trial_expires_at = NULL,
      updated_at = now()
  WHERE user_id = p_user_id
    AND trial_expires_at IS NOT NULL
    AND trial_expires_at <= now()
  RETURNING balance INTO v_balance;

  IF v_balance IS NULL THEN
    SELECT balance INTO v_balance FROM credit_balances WHERE user_id = p_user_id;
  END IF;
  RETURN coalesce(v_balance, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_welcome_credits(
  p_user_id uuid,
  p_credits integer,
  p_channel text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF EXISTS (SELECT 1 FROM welcome_credit_claims WHERE user_id = p_user_id) THEN
    SELECT balance INTO v_balance FROM credit_balances WHERE user_id = p_user_id;
    RETURN jsonb_build_object('granted', false, 'credits', 0, 'balance', coalesce(v_balance, 0));
  END IF;

  INSERT INTO welcome_credit_claims (user_id, credits_granted, grant_channel)
  VALUES (p_user_id, p_credits, p_channel);
  INSERT INTO credit_purchases (user_id, stripe_session_id, credits, amount_usd, status, source)
  VALUES (p_user_id, 'welcome_' || p_user_id::text, p_credits, 0, 'completed', 'welcome');
  INSERT INTO credit_balances (user_id, balance, lifetime_purchased)
  VALUES (p_user_id, p_credits, p_credits)
  ON CONFLICT (user_id) DO UPDATE
  SET balance = credit_balances.balance + excluded.balance,
      lifetime_purchased = credit_balances.lifetime_purchased + excluded.lifetime_purchased,
      updated_at = now()
  RETURNING balance INTO v_balance;
  RETURN jsonb_build_object('granted', true, 'credits', p_credits, 'balance', v_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_apple_credits_and_record_purchase(
  p_user_id uuid,
  p_credits integer,
  p_amount_usd numeric,
  p_transaction_id text,
  p_original_transaction_id text,
  p_product_id text,
  p_environment text,
  p_source text,
  p_trial_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_user uuid;
  v_purchase_id uuid;
  v_balance integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('apple:' || p_transaction_id));
  SELECT user_id INTO v_existing_user FROM credit_purchases
  WHERE apple_transaction_id = p_transaction_id LIMIT 1;
  IF v_existing_user IS NOT NULL THEN
    IF v_existing_user <> p_user_id THEN
      RAISE EXCEPTION 'Apple transaction is already linked to another Makaron account' USING ERRCODE = '23505';
    END IF;
    SELECT balance INTO v_balance FROM credit_balances WHERE user_id = p_user_id;
    RETURN jsonb_build_object('granted', false, 'processed', false, 'balance', coalesce(v_balance, 0));
  END IF;

  IF p_source = 'trial' THEN
    IF p_trial_expires_at IS NULL THEN
      RAISE EXCEPTION 'trial expiry is required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM apple_trial_credit_claims WHERE user_id = p_user_id) THEN
      SELECT balance INTO v_balance FROM credit_balances WHERE user_id = p_user_id;
      RETURN jsonb_build_object('granted', false, 'processed', false, 'balance', coalesce(v_balance, 0));
    END IF;
    INSERT INTO apple_trial_credit_claims (
      user_id, apple_original_transaction_id, apple_transaction_id, credits_granted, trial_expires_at
    ) VALUES (
      p_user_id, p_original_transaction_id, p_transaction_id, p_credits, p_trial_expires_at
    );
  END IF;

  INSERT INTO credit_purchases (
    user_id, stripe_session_id, credits, amount_usd, status, source, provider,
    apple_transaction_id, apple_original_transaction_id, apple_product_id, apple_environment
  ) VALUES (
    p_user_id, 'apple_' || p_transaction_id, p_credits, p_amount_usd, 'completed', p_source, 'apple',
    p_transaction_id, p_original_transaction_id, p_product_id, p_environment
  ) RETURNING id INTO v_purchase_id;

  INSERT INTO credit_balances (
    user_id, balance, trial_balance, trial_expires_at, lifetime_purchased, lifetime_used
  ) VALUES (
    p_user_id,
    p_credits,
    CASE WHEN p_source = 'trial' THEN p_credits ELSE 0 END,
    CASE WHEN p_source = 'trial' THEN p_trial_expires_at ELSE NULL END,
    CASE WHEN p_source = 'trial' THEN 0 ELSE p_credits END,
    0
  )
  ON CONFLICT (user_id) DO UPDATE
  SET balance = credit_balances.balance + excluded.balance,
      trial_balance = credit_balances.trial_balance + excluded.trial_balance,
      trial_expires_at = coalesce(excluded.trial_expires_at, credit_balances.trial_expires_at),
      lifetime_purchased = credit_balances.lifetime_purchased + excluded.lifetime_purchased,
      updated_at = now()
  RETURNING balance INTO v_balance;

  RETURN jsonb_build_object(
    'granted', true,
    'processed', true,
    'credits', p_credits,
    'balance', v_balance,
    'purchase_id', v_purchase_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.next_sort_order(p_project_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(max(sort_order) + 1, 0) FROM snapshots WHERE project_id = p_project_id;
$$;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_credit_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apple_trial_credit_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_apple_trial_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_animations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_music ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile" ON public.user_profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own credits" ON public.credit_balances FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own projects" ON public.projects FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own snapshots" ON public.snapshots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own messages" ON public.messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own agent events" ON public.agent_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own animations" ON public.project_animations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own music" ON public.project_music FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own workspace" ON public.workspace_files FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own skill shares" ON public.skill_shares FOR ALL TO authenticated USING (sharer_id = auth.uid()) WITH CHECK (sharer_id = auth.uid());
CREATE POLICY "public home skills" ON public.home_skills FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "public skill categories" ON public.skill_categories FOR SELECT TO anon, authenticated USING (is_active);

CREATE POLICY "own image objects" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "public image reads" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'images');

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.home_skills, public.skill_categories TO anon, authenticated;
GRANT SELECT ON public.user_profiles, public.credit_balances TO authenticated;
GRANT ALL ON public.projects, public.snapshots, public.messages, public.agent_events,
  public.project_animations, public.project_music, public.workspace_files, public.skill_shares TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_apple_trial_credits(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_welcome_credits(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_apple_credits_and_record_purchase(uuid, integer, numeric, text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_sort_order(uuid) TO authenticated, service_role;

REVOKE ALL ON public.pending_apple_trial_claims, public.apple_trial_credit_claims,
  public.welcome_credit_claims, public.credit_purchases, public.subscriptions FROM anon, authenticated;
