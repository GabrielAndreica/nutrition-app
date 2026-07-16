-- ============================================================
-- Hardening productie pentru recompense, XP si nivel
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS xp integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS app_coins integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_xp_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_xp_nonnegative
      CHECK (xp IS NULL OR xp >= 0)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_level_positive'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_level_positive
      CHECK (level IS NULL OR level >= 1)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_app_coins_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_app_coins_nonnegative
      CHECK (app_coins >= 0)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_currency_ledger_source_length'
  ) THEN
    ALTER TABLE app_currency_ledger
      ADD CONSTRAINT app_currency_ledger_source_length
      CHECK (
        (source_type IS NULL OR char_length(source_type) <= 80)
        AND (source_key IS NULL OR char_length(source_key) <= 180)
      )
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_currency_ledger_user_created
  ON app_currency_ledger(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_currency_ledger_unique_source
  ON app_currency_ledger(user_id, source_type, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date_finalized
  ON daily_user_progress(user_id, progress_date DESC, day_finalized);

