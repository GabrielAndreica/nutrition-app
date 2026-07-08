-- ============================================================
-- Securizare si optimizare baza de date
-- RLS Policies + Indexes pentru performanta
-- Ruleaza in Supabase SQL Editor DUPA:
--   1. migrate-clients-to-users.sql
--   2. fix-column-types.sql
-- ============================================================

-- ============================================================
-- HELPER: Extrage user ID (integer) din JWT custom
-- Aplicatia semneaza JWT-ul cu { id: integer, email, role, ... }
-- Supabase expune claims-urile prin current_setting().
-- ============================================================
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

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), ''),
    'null'
  )::jsonb ->> 'role';
$$;

-- ============================================================
-- 1. TABELA: users
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "users_insert_own" ON users;

-- Utilizatorul vede doar propriul rand
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth_user_id());

-- Utilizatorul poate modifica doar propriul rand
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth_user_id());

-- INSERT permis doar prin service role (bypasses RLS automat)

-- ============================================================
-- 2. TABELA: meal_plans
-- ============================================================
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_plans_select_own" ON meal_plans;

-- Utilizatorii vad doar planurile lor
CREATE POLICY "meal_plans_select_own" ON meal_plans
  FOR SELECT USING (client_id = auth_user_id());

-- ============================================================
-- 3. TABELA: workout_plans
-- ============================================================
ALTER TABLE workout_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workout_plans_select_own" ON workout_plans;

CREATE POLICY "workout_plans_select_own" ON workout_plans
  FOR SELECT USING (client_id = auth_user_id());

-- ============================================================
-- 4. TABELA: generation_status
-- ============================================================
ALTER TABLE generation_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generation_status_select_own" ON generation_status;
DROP POLICY IF EXISTS "generation_status_modify_own" ON generation_status;

CREATE POLICY "generation_status_select_own" ON generation_status
  FOR SELECT USING (client_id = auth_user_id() OR user_id = auth_user_id());

CREATE POLICY "generation_status_modify_own" ON generation_status
  FOR ALL USING (client_id = auth_user_id() OR user_id = auth_user_id());

-- ============================================================
-- 5. TABELA: notifications
-- ============================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

-- Utilizatorul vede doar notificarile sale
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (user_id = auth_user_id());

-- Utilizatorul poate marca notificarile sale ca citite
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (user_id = auth_user_id());

-- ============================================================
-- 6. TABELA: activity_logs (read-only pentru utilizatori)
-- ============================================================
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_logs_select_own" ON activity_logs;

CREATE POLICY "activity_logs_select_own" ON activity_logs
  FOR SELECT USING (user_id = auth_user_id());

-- ============================================================
-- 7. TABELA: weight_history
-- ============================================================
ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weight_history_select_own" ON weight_history;
DROP POLICY IF EXISTS "weight_history_insert_own" ON weight_history;
DROP POLICY IF EXISTS "weight_history_update_own" ON weight_history;
DROP POLICY IF EXISTS "weight_history_delete_own" ON weight_history;

CREATE POLICY "weight_history_select_own" ON weight_history
  FOR SELECT USING (client_id = auth_user_id());

CREATE POLICY "weight_history_insert_own" ON weight_history
  FOR INSERT WITH CHECK (client_id = auth_user_id());

CREATE POLICY "weight_history_update_own" ON weight_history
  FOR UPDATE USING (client_id = auth_user_id());

CREATE POLICY "weight_history_delete_own" ON weight_history
  FOR DELETE USING (client_id = auth_user_id());

-- ============================================================
-- 8. INDEXES pentru performanta
-- ============================================================

ALTER TABLE meal_plans
  DROP COLUMN IF EXISTS approval_status,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by;

ALTER TABLE workout_plans
  DROP COLUMN IF EXISTS approval_status,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by;

-- ── users ──────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hydration_target_ml integer;

UPDATE users
SET hydration_target_ml = LEAST(
  5000,
  GREATEST(
    1500,
    (ROUND((
      (COALESCE(weight, 70) * 35)
      + CASE activity_level
          WHEN 'light' THEN 250
          WHEN 'moderate' THEN 500
          WHEN 'active' THEN 750
          WHEN 'very_active' THEN 1000
          ELSE 0
        END
      + CASE goal
          WHEN 'weight_loss' THEN 250
          WHEN 'muscle_gain' THEN 250
          WHEN 'endurance' THEN 500
          ELSE 0
        END
    ) / 250.0) * 250)::integer
  )
)
WHERE hydration_target_ml IS NULL
  AND weight IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

CREATE INDEX IF NOT EXISTS idx_users_role_status
  ON users(role, status);

-- ── meal_plans ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meal_plans_client_id
  ON meal_plans(client_id);

DROP INDEX IF EXISTS idx_meal_plans_client_approved;

CREATE INDEX IF NOT EXISTS idx_meal_plans_client_created
  ON meal_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meal_plans_created_at
  ON meal_plans(created_at DESC);

-- ── workout_plans ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workout_plans_client_id
  ON workout_plans(client_id);

DROP INDEX IF EXISTS idx_workout_plans_client_approved;

CREATE INDEX IF NOT EXISTS idx_workout_plans_client_created
  ON workout_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_plans_created_at
  ON workout_plans(created_at DESC);

-- ── generation_status ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_generation_status_client_id
  ON generation_status(client_id);

CREATE INDEX IF NOT EXISTS idx_generation_status_user_id
  ON generation_status(user_id);

CREATE INDEX IF NOT EXISTS idx_generation_status_status_updated
  ON generation_status(status, updated_at)
  WHERE status = 'generating';

-- ── notifications ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, created_at DESC)
  WHERE is_read = false;

-- ── activity_logs ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id
  ON activity_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
  ON activity_logs(created_at DESC);

-- ── weight_history ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_weight_history_client_id
  ON weight_history(client_id);

CREATE INDEX IF NOT EXISTS idx_weight_history_client_recorded
  ON weight_history(client_id, recorded_at DESC);

-- ============================================================
-- Done!
-- ============================================================
-- NOTE: Aplicatia foloseste service role key pe server —
-- service role bypasses RLS automat, deci operatiile normale
-- functioneaza fara restrictii. Politicile de mai sus protejeaza
-- impotriva accesului direct cu anon key + JWT.
-- ============================================================
