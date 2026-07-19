-- ============================================================
-- Weekly check-ins B2C
-- Stocheaza istoricul de progres si ajustarile nutritionale.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nutrition_target_calories integer,
  ADD COLUMN IF NOT EXISTS nutrition_target_protein_g integer,
  ADD COLUMN IF NOT EXISTS nutrition_target_carbs_g integer,
  ADD COLUMN IF NOT EXISTS nutrition_target_fat_g integer,
  ADD COLUMN IF NOT EXISTS last_weekly_checkin_at timestamptz;

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

CREATE TABLE IF NOT EXISTS weekly_checkins (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_key date NOT NULL,
  weight_kg numeric(6,2) NOT NULL,
  previous_weight_kg numeric(6,2),
  target_weight_kg numeric(6,2),
  goal text NOT NULL,
  account_type text NOT NULL DEFAULT 'free',
  meal_adherence_pct integer NOT NULL CHECK (meal_adherence_pct BETWEEN 0 AND 100),
  workout_adherence_pct integer NOT NULL CHECK (workout_adherence_pct BETWEEN 0 AND 100),
  workout_difficulty integer NOT NULL CHECK (workout_difficulty BETWEEN 1 AND 5),
  hunger_level integer NOT NULL CHECK (hunger_level BETWEEN 1 AND 5),
  notes text,
  weight_delta_kg numeric(6,2),
  outcome text NOT NULL,
  recommendation text NOT NULL,
  suggested_adjustment_calories integer NOT NULL DEFAULT 0,
  applied_adjustment_calories integer NOT NULL DEFAULT 0,
  applied_adjustment_carbs_g integer NOT NULL DEFAULT 0,
  plan_adjusted boolean NOT NULL DEFAULT false,
  xp_awarded boolean NOT NULL DEFAULT false,
  xp_awarded_at timestamptz,
  xp_awarded_amount integer NOT NULL DEFAULT 0 CHECK (xp_awarded_amount >= 0),
  meal_plan_id_before text,
  meal_plan_id_after text,
  targets_before jsonb NOT NULL DEFAULT '{}',
  targets_after jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_key)
);

ALTER TABLE weekly_checkins
  ADD COLUMN IF NOT EXISTS xp_awarded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS xp_awarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS xp_awarded_amount integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_checkins_xp_awarded_amount_nonnegative'
  ) THEN
    ALTER TABLE weekly_checkins
      ADD CONSTRAINT weekly_checkins_xp_awarded_amount_nonnegative
      CHECK (xp_awarded_amount >= 0)
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_weekly_checkins_user_created
  ON weekly_checkins(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_checkins_user_week
  ON weekly_checkins(user_id, week_key DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_checkins_user_outcome_created
  ON weekly_checkins(user_id, outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_checkins_user_week_unawarded_xp
  ON weekly_checkins(user_id, week_key)
  WHERE xp_awarded = false;

ALTER TABLE weekly_checkins
  DROP CONSTRAINT IF EXISTS weekly_checkins_targets_before_object;

ALTER TABLE weekly_checkins
  ADD CONSTRAINT weekly_checkins_targets_before_object
  CHECK (jsonb_typeof(targets_before) = 'object');

ALTER TABLE weekly_checkins
  DROP CONSTRAINT IF EXISTS weekly_checkins_targets_after_object;

ALTER TABLE weekly_checkins
  ADD CONSTRAINT weekly_checkins_targets_after_object
  CHECK (jsonb_typeof(targets_after) = 'object');

ALTER TABLE weekly_checkins
  DROP CONSTRAINT IF EXISTS weekly_checkins_metadata_object;

ALTER TABLE weekly_checkins
  ADD CONSTRAINT weekly_checkins_metadata_object
  CHECK (jsonb_typeof(metadata) = 'object');

CREATE OR REPLACE FUNCTION public.update_weekly_checkins_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS weekly_checkins_updated_at ON weekly_checkins;
CREATE TRIGGER weekly_checkins_updated_at
  BEFORE UPDATE ON weekly_checkins
  FOR EACH ROW
  EXECUTE FUNCTION public.update_weekly_checkins_updated_at();

ALTER TABLE weekly_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_checkins_select_own" ON weekly_checkins;
CREATE POLICY "weekly_checkins_select_own" ON weekly_checkins
  FOR SELECT USING (user_id = auth_user_id());

-- Scrierile in weekly_checkins raman server-side prin API/service_role.
DROP POLICY IF EXISTS "weekly_checkins_insert_own" ON weekly_checkins;
DROP POLICY IF EXISTS "weekly_checkins_update_own" ON weekly_checkins;
DROP POLICY IF EXISTS "weekly_checkins_delete_own" ON weekly_checkins;

SELECT
  'weekly_checkins RLS enabled' AS check_name,
  relrowsecurity AS enabled
FROM pg_class
WHERE oid = 'public.weekly_checkins'::regclass;
