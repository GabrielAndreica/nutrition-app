-- ============================================================
-- Hardening productie pentru modulul de mese
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS meal_plan_generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS meal_plan_generation_error text;

CREATE INDEX IF NOT EXISTS idx_meal_plans_client_created
  ON meal_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meal_plans_client_id_id
  ON meal_plans(client_id, id);

CREATE INDEX IF NOT EXISTS idx_recipes_meal_access_created
  ON recipes(meal_type, is_free, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recipes_meal_price_created
  ON recipes(meal_type, coin_price, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_foods_active_category
  ON foods(is_active, category);

CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date
  ON daily_user_progress(user_id, progress_date DESC);

DO $$
DECLARE
  plan_data_type text;
BEGIN
  SELECT data_type
  INTO plan_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'meal_plans'
    AND column_name = 'plan_data';

  IF plan_data_type IN ('jsonb', 'json') THEN
    EXECUTE 'ALTER TABLE meal_plans DROP CONSTRAINT IF EXISTS meal_plans_plan_data_object';
    IF plan_data_type = 'jsonb' THEN
      EXECUTE '
        ALTER TABLE meal_plans
        ADD CONSTRAINT meal_plans_plan_data_object
        CHECK (plan_data IS NULL OR jsonb_typeof(plan_data) = ''object'')
      ';
    ELSE
      EXECUTE '
        ALTER TABLE meal_plans
        ADD CONSTRAINT meal_plans_plan_data_object
        CHECK (plan_data IS NULL OR json_typeof(plan_data) = ''object'')
      ';
    END IF;
  END IF;
END $$;

ALTER TABLE daily_user_progress
  DROP CONSTRAINT IF EXISTS daily_user_progress_meal_checks_object;

ALTER TABLE daily_user_progress
  ADD CONSTRAINT daily_user_progress_meal_checks_object
  CHECK (jsonb_typeof(meal_checks) = 'object');

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

-- RLS: planurile alimentare si progresul zilnic sunt strict per utilizator.
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_plans_select_own" ON meal_plans;
DROP POLICY IF EXISTS "meal_plans_insert_own" ON meal_plans;
DROP POLICY IF EXISTS "meal_plans_update_own" ON meal_plans;
DROP POLICY IF EXISTS "meal_plans_delete_own" ON meal_plans;

CREATE POLICY "meal_plans_select_own" ON meal_plans
  FOR SELECT USING (client_id = auth_user_id());

CREATE POLICY "meal_plans_insert_own" ON meal_plans
  FOR INSERT WITH CHECK (client_id = auth_user_id());

CREATE POLICY "meal_plans_update_own" ON meal_plans
  FOR UPDATE USING (client_id = auth_user_id())
  WITH CHECK (client_id = auth_user_id());

CREATE POLICY "meal_plans_delete_own" ON meal_plans
  FOR DELETE USING (client_id = auth_user_id());

ALTER TABLE daily_user_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_user_progress_select_own" ON daily_user_progress;
DROP POLICY IF EXISTS "daily_user_progress_insert_own" ON daily_user_progress;
DROP POLICY IF EXISTS "daily_user_progress_update_own" ON daily_user_progress;

CREATE POLICY "daily_user_progress_select_own" ON daily_user_progress
  FOR SELECT USING (user_id = auth_user_id());

CREATE POLICY "daily_user_progress_insert_own" ON daily_user_progress
  FOR INSERT WITH CHECK (user_id = auth_user_id());

CREATE POLICY "daily_user_progress_update_own" ON daily_user_progress
  FOR UPDATE USING (user_id = auth_user_id())
  WITH CHECK (user_id = auth_user_id());

DO $$
BEGIN
  IF to_regclass('public.user_recipe_unlocks') IS NOT NULL THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_user_recipe_unlocks_user_recipe
      ON user_recipe_unlocks(user_id, recipe_id)
    ';

    EXECUTE 'ALTER TABLE user_recipe_unlocks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_recipe_unlocks_select_own" ON user_recipe_unlocks';
    EXECUTE 'CREATE POLICY "user_recipe_unlocks_select_own" ON user_recipe_unlocks FOR SELECT USING (user_id = auth_user_id())';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.recipes') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'recipes'
         AND column_name IN ('is_free', 'coin_price')
       GROUP BY table_name
       HAVING COUNT(DISTINCT column_name) = 2
     )
     AND to_regclass('public.user_recipe_unlocks') IS NOT NULL
  THEN
    EXECUTE 'ALTER TABLE recipes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "recipes_select_free_or_unlocked" ON recipes';
    EXECUTE '
      CREATE POLICY "recipes_select_free_or_unlocked" ON recipes
      FOR SELECT USING (
        is_free = true
        OR COALESCE(coin_price, 0) <= 0
        OR EXISTS (
          SELECT 1
          FROM user_recipe_unlocks uru
          WHERE uru.user_id = auth_user_id()
            AND uru.recipe_id = recipes.id
        )
      )
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.foods') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'foods'
         AND column_name = 'is_active'
     )
  THEN
    EXECUTE 'ALTER TABLE foods ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "foods_select_active" ON foods';
    EXECUTE 'CREATE POLICY "foods_select_active" ON foods FOR SELECT USING (is_active = true)';
  END IF;
END $$;

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

REVOKE ALL ON FUNCTION public.claim_meal_plan_generation_lock(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_meal_plan_generation_lock(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_meal_plan_generation_lock(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meal_plan_generation_lock(integer, integer) TO service_role;

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

REVOKE ALL ON FUNCTION public.release_meal_plan_generation_lock(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_meal_plan_generation_lock(integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.release_meal_plan_generation_lock(integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_meal_plan_generation_lock(integer, text) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.purchase_recipe_with_coins(integer, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.purchase_recipe_with_coins(integer, uuid) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.purchase_recipe_with_coins(integer, uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.purchase_recipe_with_coins(integer, uuid) FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.purchase_recipe_with_coins(integer, uuid) TO service_role';
  END IF;
END $$;

SELECT
  'meal_plans RLS enabled' AS check_name,
  relrowsecurity AS enabled
FROM pg_class
WHERE oid = 'public.meal_plans'::regclass
UNION ALL
SELECT
  'daily_user_progress RLS enabled' AS check_name,
  relrowsecurity AS enabled
FROM pg_class
WHERE oid = 'public.daily_user_progress'::regclass;
