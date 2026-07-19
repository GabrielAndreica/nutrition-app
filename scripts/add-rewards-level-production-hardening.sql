-- ============================================================
-- Hardening productie pentru recompense, XP si nivel
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS xp integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS app_coins integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meals_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS workout_cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS meals_completed_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workout_completed_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_plan_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_plan_day_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS meal_day_status jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS workout_day_status jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS streak_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_state text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS streak_recovery_day boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS streak_awarded_day integer DEFAULT -1,
  ADD COLUMN IF NOT EXISTS weekly_plan_due_at timestamptz;

CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    NULLIF(
      NULLIF(current_setting('request.jwt.claims', true), ''),
      'null'
    )::jsonb ->> 'id'
  )::integer;
$$;

CREATE TABLE IF NOT EXISTS app_currency_ledger (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  source_type text,
  source_key text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_xp_ledger (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  source_type text NOT NULL,
  source_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_key)
);

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
    SELECT 1 FROM pg_constraint WHERE conname = 'users_daily_progress_bounds'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_daily_progress_bounds
      CHECK (
        COALESCE(meals_completed_days, 0) BETWEEN 0 AND 7
        AND COALESCE(workout_completed_days, 0) BETWEEN 0 AND 7
        AND COALESCE(current_plan_day, 0) BETWEEN 0 AND 7
        AND COALESCE(streak_count, 0) >= 0
        AND COALESCE(streak_awarded_day, -1) BETWEEN -1 AND 6
        AND COALESCE(streak_state, 'normal') IN ('normal', 'warning')
      )
      NOT VALID;
  END IF;

  IF to_regclass('public.app_currency_ledger') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'app_currency_ledger_source_length'
     )
  THEN
    ALTER TABLE app_currency_ledger
      ADD CONSTRAINT app_currency_ledger_source_length
      CHECK (
        (source_type IS NULL OR char_length(source_type) <= 80)
        AND (source_key IS NULL OR char_length(source_key) <= 180)
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_currency_ledger_metadata_object'
  ) THEN
    ALTER TABLE app_currency_ledger
      ADD CONSTRAINT app_currency_ledger_metadata_object
      CHECK (jsonb_typeof(metadata) = 'object')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_xp_ledger_source_length'
  ) THEN
    ALTER TABLE user_xp_ledger
      ADD CONSTRAINT user_xp_ledger_source_length
      CHECK (
        char_length(source_type) <= 80
        AND char_length(source_key) <= 180
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_xp_ledger_metadata_object'
  ) THEN
    ALTER TABLE user_xp_ledger
      ADD CONSTRAINT user_xp_ledger_metadata_object
      CHECK (jsonb_typeof(metadata) = 'object')
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_level_xp
  ON users(level, xp DESC);

CREATE INDEX IF NOT EXISTS idx_users_streak_count
  ON users(streak_count DESC)
  WHERE streak_count > 0;

CREATE INDEX IF NOT EXISTS idx_users_current_plan_due
  ON users(current_plan_day_due_at)
  WHERE current_plan_day_due_at IS NOT NULL
    AND role IN ('user', 'client');

CREATE INDEX IF NOT EXISTS idx_users_weekly_plan_due
  ON users(weekly_plan_due_at)
  WHERE weekly_plan_due_at IS NOT NULL
    AND role IN ('user', 'client');

CREATE INDEX IF NOT EXISTS idx_users_reward_cooldowns
  ON users(id, meals_cooldown_until, workout_cooldown_until)
  WHERE role IN ('user', 'client');

DO $$
BEGIN
  IF to_regclass('public.app_currency_ledger') IS NOT NULL THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_app_currency_ledger_user_created
      ON app_currency_ledger(user_id, created_at DESC)
    ';

    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_currency_ledger_unique_source
      ON app_currency_ledger(user_id, source_type, source_key)
      WHERE source_key IS NOT NULL
    ';

    EXECUTE 'ALTER TABLE app_currency_ledger ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "app_currency_ledger_select_own" ON app_currency_ledger';
    EXECUTE 'CREATE POLICY "app_currency_ledger_select_own" ON app_currency_ledger FOR SELECT USING (user_id = auth_user_id())';

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON app_currency_ledger FROM anon';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON app_currency_ledger FROM authenticated';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_xp_ledger') IS NOT NULL THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_user_xp_ledger_user_created
      ON user_xp_ledger(user_id, created_at DESC)
    ';

    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_xp_ledger_unique_source
      ON user_xp_ledger(user_id, source_type, source_key)
    ';

    EXECUTE 'ALTER TABLE user_xp_ledger ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_xp_ledger_select_own" ON user_xp_ledger';
    EXECUTE 'CREATE POLICY "user_xp_ledger_select_own" ON user_xp_ledger FOR SELECT USING (user_id = auth_user_id())';

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON user_xp_ledger FROM anon';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON user_xp_ledger FROM authenticated';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.daily_user_progress') IS NOT NULL THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date_finalized
      ON daily_user_progress(user_id, progress_date DESC, day_finalized)
    ';

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'daily_user_progress'
        AND column_name = 'water_goal_awarded'
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_daily_user_progress_water_reward
        ON daily_user_progress(user_id, progress_date)
        WHERE water_goal_awarded = false
      ';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.weekly_checkins') IS NOT NULL THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_weekly_checkins_user_week_unawarded_xp
      ON weekly_checkins(user_id, week_key)
      WHERE xp_awarded = false
    ';
  END IF;
END $$;

-- Recompensele si streak-ul se modifica doar server-side prin API/service_role.
REVOKE UPDATE (
  xp,
  level,
  app_coins,
  meals_cooldown_until,
  workout_cooldown_until,
  meals_completed_days,
  workout_completed_days,
  current_plan_day,
  current_plan_day_due_at,
  meal_day_status,
  workout_day_status,
  streak_count,
  streak_state,
  streak_recovery_day,
  streak_awarded_day,
  weekly_plan_due_at
) ON users FROM anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.award_app_coins(integer, integer, text, text, text, jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.award_app_coins(integer, integer, text, text, text, jsonb) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.award_app_coins(integer, integer, text, text, text, jsonb) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.award_app_coins(integer, integer, text, text, text, jsonb) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.award_app_coins(integer, integer, text, text, text, jsonb) TO service_role';
  END IF;
END $$;

SELECT
  'rewards users constraints ready' AS check_name,
  COUNT(*) AS rows_count
FROM pg_constraint
WHERE conname IN ('users_xp_nonnegative', 'users_level_positive', 'users_app_coins_nonnegative', 'users_daily_progress_bounds');
