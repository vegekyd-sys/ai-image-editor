-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  stripe_subscription_id text UNIQUE NOT NULL,
  stripe_customer_id text NOT NULL,
  plan_id text NOT NULL,
  billing_interval text NOT NULL,  -- 'month' | 'year'
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)  -- one active subscription per user
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

-- Add stripe_customer_id to track Stripe customer per user
-- Using credit_balances since every billed user has one (avoid creating a new table)
ALTER TABLE credit_balances ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Add stripe_invoice_id to credit_purchases for subscription idempotency
ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS stripe_invoice_id text;
ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS source text DEFAULT 'topup';
-- source: 'topup' (one-time purchase) | 'subscription' (recurring)

-- Unique constraint on invoice_id to prevent double-crediting from webhook replay
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_invoice ON credit_purchases(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
