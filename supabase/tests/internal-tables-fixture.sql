-- ISOLATED LOCAL TEST DATABASE ONLY. Contains synthetic data, no production rows.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.agent_challenges (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "challenge_text" text NOT NULL,
  "expected_answer" text NOT NULL,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "verified_at" timestamp with time zone,
  "user_id" uuid,
  CONSTRAINT "agent_challenges_pkey" PRIMARY KEY (id),
  CONSTRAINT "agent_challenges_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
GRANT ALL ON public.agent_challenges TO anon, authenticated, service_role;
CREATE TABLE public.credit_pricing (
  "tool_name" text NOT NULL,
  "supplier_cost" numeric NOT NULL,
  "credits" integer NOT NULL,
  "is_free" boolean DEFAULT false,
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "credit_pricing_pkey" PRIMARY KEY (tool_name)
);
GRANT ALL ON public.credit_pricing TO anon, authenticated, service_role;
CREATE TABLE public.health_alerts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "service" text NOT NULL,
  "error" text NOT NULL,
  "latency_ms" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "health_alerts_pkey" PRIMARY KEY (id)
);
GRANT ALL ON public.health_alerts TO anon, authenticated, service_role;
CREATE TABLE public.subscriptions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "stripe_subscription_id" text,
  "stripe_customer_id" text,
  "plan_id" text NOT NULL,
  "billing_interval" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "provider" text DEFAULT 'stripe'::text NOT NULL,
  "apple_original_transaction_id" text,
  "apple_transaction_id" text,
  "apple_product_id" text,
  "apple_app_account_token" uuid,
  "apple_environment" text,
  "trial_started_at" timestamp with time zone,
  "trial_ends_at" timestamp with time zone,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE (stripe_subscription_id),
  CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT "subscriptions_user_id_key" UNIQUE (user_id)
);
GRANT ALL ON public.subscriptions TO anon, authenticated, service_role;
CREATE TABLE public.token_rates (
  "model_id" text NOT NULL,
  "display_name" text NOT NULL,
  "input_per_1m" numeric DEFAULT 0 NOT NULL,
  "output_per_1m" numeric DEFAULT 0 NOT NULL,
  "markup" numeric DEFAULT 2.0 NOT NULL,
  "is_active" boolean DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now(),
  "cache_read_per_1m" numeric,
  "cache_write_per_1m" numeric,
  CONSTRAINT "token_rates_pkey" PRIMARY KEY (model_id)
);
GRANT ALL ON public.token_rates TO anon, authenticated, service_role;
