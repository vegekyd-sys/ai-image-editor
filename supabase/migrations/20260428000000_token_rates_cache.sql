-- Cache-aware billing: track cache_read_per_1m / cache_write_per_1m in token_rates,
-- and cache_read_tokens / cache_write_tokens in usage_logs.
--
-- Pricing rationale (Anthropic official multipliers):
--   cache_read  = 0.1  × base input
--   cache_write = 1.25 × base input
-- Then apply existing markup. NULL values fall back to input_per_1m at app layer
-- (equivalent to current behavior — no regression for models without cache pricing).

ALTER TABLE token_rates
  ADD COLUMN IF NOT EXISTS cache_read_per_1m numeric,
  ADD COLUMN IF NOT EXISTS cache_write_per_1m numeric;

-- Backfill Anthropic models using official ratios
UPDATE token_rates
SET
  cache_read_per_1m = input_per_1m * 0.1,
  cache_write_per_1m = input_per_1m * 1.25
WHERE model_id LIKE '%anthropic%';

-- Extend usage_logs for cache token accounting
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer;
