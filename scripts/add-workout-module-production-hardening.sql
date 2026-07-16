-- ============================================================
-- Hardening productie pentru modulul de antrenamente
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_workout_session jsonb;

CREATE INDEX IF NOT EXISTS idx_workout_plans_client_created
  ON workout_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date
  ON daily_user_progress(user_id, progress_date DESC);

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
  END IF;
END $$;

