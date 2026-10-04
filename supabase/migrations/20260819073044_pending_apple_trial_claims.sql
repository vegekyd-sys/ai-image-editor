-- A native iOS user can confirm the Apple introductory offer before creating
-- a Makaron account. Keep the verified StoreKit transaction server-only until
-- the same WebView finishes authentication, then link it exactly once.

CREATE TABLE IF NOT EXISTS pending_apple_trial_claims (
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
  CONSTRAINT pending_apple_trial_claim_state_check CHECK (
    claimed_at IS NOT NULL OR claimed_by IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_pending_apple_trial_claims_expiry
  ON pending_apple_trial_claims(expires_at)
  WHERE claimed_at IS NULL;

ALTER TABLE pending_apple_trial_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pending_apple_trial_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE pending_apple_trial_claims TO service_role;
