-- ============================================================
-- Hardening productie pentru modulul de mese
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS meal_plan_generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS meal_plan_generation_error text;

CREATE INDEX IF NOT EXISTS idx_meal_plans_client_created
  ON meal_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recipes_meal_access_created
  ON recipes(meal_type, is_free, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_foods_active_category
  ON foods(is_active, category);

CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date
  ON daily_user_progress(user_id, progress_date DESC);

CREATE OR REPLACE FUNCTION public.claim_meal_plan_generation_lock(
  p_user_id integer,
  p_lock_timeout_minutes integer DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean := false;
  stale_before timestamptz;
BEGIN
  stale_before := now() - make_interval(mins => GREATEST(1, COALESCE(p_lock_timeout_minutes, 10)));

  UPDATE users
  SET
    meal_plan_generation_started_at = now(),
    meal_plan_generation_error = null
  WHERE id = p_user_id
    AND (
      meal_plan_generation_started_at IS NULL
      OR meal_plan_generation_started_at < stale_before
    )
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_meal_plan_generation_lock(
  p_user_id integer,
  p_error text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE users
  SET
    meal_plan_generation_started_at = null,
    meal_plan_generation_error = NULLIF(p_error, '')
  WHERE id = p_user_id;
END;
$$;

