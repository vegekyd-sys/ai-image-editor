-- New-account grant only. Applying this migration changes the configured
-- welcome grant; it does not update existing credit_balances rows.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('welcome_credits', '500', NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;
