-- ============================================================
-- Hardening productie pentru modulul de antrenamente
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_workout_session jsonb;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_active_workout_session_object;

ALTER TABLE users
  ADD CONSTRAINT users_active_workout_session_object
  CHECK (
    active_workout_session IS NULL
    OR jsonb_typeof(active_workout_session) = 'object'
  );

CREATE INDEX IF NOT EXISTS idx_workout_plans_client_created
  ON workout_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_plans_client_id_id
  ON workout_plans(client_id, id);

CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date
  ON daily_user_progress(user_id, progress_date DESC);

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

-- RLS pentru planuri: fiecare user vede/modifica doar planurile proprii.
ALTER TABLE workout_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workout_plans_select_own" ON workout_plans;
DROP POLICY IF EXISTS "workout_plans_update_own" ON workout_plans;
DROP POLICY IF EXISTS "workout_plans_delete_own" ON workout_plans;

CREATE POLICY "workout_plans_select_own" ON workout_plans
  FOR SELECT USING (client_id = auth_user_id());

CREATE POLICY "workout_plans_update_own" ON workout_plans
  FOR UPDATE USING (client_id = auth_user_id())
  WITH CHECK (client_id = auth_user_id());

CREATE POLICY "workout_plans_delete_own" ON workout_plans
  FOR DELETE USING (client_id = auth_user_id());

-- RLS pentru progresul zilnic folosit de finalizarea antrenamentelor.
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

-- Daca folosesti Supabase direct din client pentru exercitii, expune doar exercitiile active.
DO $$
BEGIN
  IF to_regclass('public.exercises') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'exercises'
         AND column_name = 'active'
     )
  THEN
    EXECUTE 'ALTER TABLE exercises ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "exercises_select_active" ON exercises';
    EXECUTE 'CREATE POLICY "exercises_select_active" ON exercises FOR SELECT USING (active = true)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exercises'
      AND column_name IN ('active', 'equipment', 'muscle_group', 'video_url', 'video_storage_path')
    GROUP BY table_name
    HAVING COUNT(DISTINCT column_name) = 5
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_exercises_active_equipment_muscle_video
      ON exercises(equipment, muscle_group)
      WHERE active = true
        AND (video_storage_path IS NOT NULL OR video_url IS NOT NULL)
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_exercises_active_muscle_video
      ON exercises(muscle_group)
      WHERE active = true
        AND (video_storage_path IS NOT NULL OR video_url IS NOT NULL)
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_exercises_active_equipment_video
      ON exercises(equipment)
      WHERE active = true
        AND (video_storage_path IS NOT NULL OR video_url IS NOT NULL)
    ';
  END IF;
END $$;

SELECT
  'workout_plans RLS enabled' AS check_name,
  relrowsecurity AS enabled
FROM pg_class
WHERE oid = 'public.workout_plans'::regclass
UNION ALL
SELECT
  'daily_user_progress RLS enabled' AS check_name,
  relrowsecurity AS enabled
FROM pg_class
WHERE oid = 'public.daily_user_progress'::regclass;
