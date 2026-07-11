-- ============================================================
-- Progres zilnic sincronizat intre dispozitive
-- Apa bauta + mesele bifate pentru ziua curenta.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_user_progress (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  progress_date date NOT NULL,
  meal_checks jsonb NOT NULL DEFAULT '{}',
  water_ml integer NOT NULL DEFAULT 0 CHECK (water_ml >= 0 AND water_ml <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, progress_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_progress_user_date
  ON daily_user_progress(user_id, progress_date DESC);

CREATE OR REPLACE FUNCTION public.touch_daily_user_progress_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_user_progress_updated_at ON daily_user_progress;
CREATE TRIGGER trg_daily_user_progress_updated_at
  BEFORE UPDATE ON daily_user_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_daily_user_progress_updated_at();

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

ALTER TABLE daily_user_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_user_progress_select_own" ON daily_user_progress;
DROP POLICY IF EXISTS "daily_user_progress_insert_own" ON daily_user_progress;
DROP POLICY IF EXISTS "daily_user_progress_update_own" ON daily_user_progress;

CREATE POLICY "daily_user_progress_select_own" ON daily_user_progress
  FOR SELECT USING (user_id = auth_user_id());

CREATE POLICY "daily_user_progress_insert_own" ON daily_user_progress
  FOR INSERT WITH CHECK (user_id = auth_user_id());

CREATE POLICY "daily_user_progress_update_own" ON daily_user_progress
  FOR UPDATE USING (user_id = auth_user_id());
