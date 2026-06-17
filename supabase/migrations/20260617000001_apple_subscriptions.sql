-- Apple App Store subscriptions.
-- Stripe remains supported for web checkout, but iOS native purchases use StoreKit
-- and are verified server-side with App Store signed transaction JWS payloads.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE subscriptions ALTER COLUMN stripe_subscription_id DROP NOT NULL;
ALTER TABLE subscriptions ALTER COLUMN stripe_customer_id DROP NOT NULL;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS apple_original_transaction_id text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS apple_transaction_id text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS apple_product_id text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS apple_app_account_token uuid;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS apple_environment text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_apple_original_transaction_id
  ON subscriptions(apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_user
  ON subscriptions(provider, user_id);

ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS provider text DEFAULT 'stripe';
ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS apple_transaction_id text;
ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS apple_original_transaction_id text;
ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS apple_product_id text;
ALTER TABLE credit_purchases ADD COLUMN IF NOT EXISTS apple_environment text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_apple_transaction
  ON credit_purchases(apple_transaction_id)
  WHERE apple_transaction_id IS NOT NULL;
