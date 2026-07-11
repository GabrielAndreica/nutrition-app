-- ============================================================
-- Migrare: elimina tabela clients, muta totul in users
-- Ruleaza in Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

-- 1. Adauga coloane de profil fitness in users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age integer,
  ADD COLUMN IF NOT EXISTS weight numeric(6,2),
  ADD COLUMN IF NOT EXISTS height numeric(5,2),
  ADD COLUMN IF NOT EXISTS gender varchar(1),
  ADD COLUMN IF NOT EXISTS fitness_level text,
  ADD COLUMN IF NOT EXISTS fitness_goal text,
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS activity_level text,
  ADD COLUMN IF NOT EXISTS diet_type text DEFAULT 'omnivore',
  ADD COLUMN IF NOT EXISTS meals_per_day integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS hydration_target_ml integer,
  ADD COLUMN IF NOT EXISTS food_preferences text,
  ADD COLUMN IF NOT EXISTS allergies text,
  ADD COLUMN IF NOT EXISTS available_equipment text,
  ADD COLUMN IF NOT EXISTS workouts_per_week integer,
  ADD COLUMN IF NOT EXISTS training_split text,
  ADD COLUMN IF NOT EXISTS injuries_limitations text,
  ADD COLUMN IF NOT EXISTS workout_preferences text;

-- 2. Adauga coloane XP / nivel
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS xp integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS app_coins integer NOT NULL DEFAULT 0;

-- 3. Adauga coloane de progres zilnic / streak
ALTER TABLE users
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
  ADD COLUMN IF NOT EXISTS weekly_plan_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS weekly_plan_generation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS weekly_plan_generation_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- 4. Adauga coloana onboarding_completed
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;

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

-- 5. Sterge total_clients_created din users (nu mai e necesar in B2C)
ALTER TABLE users
  DROP COLUMN IF EXISTS total_clients_created;

-- ============================================================
-- 6. meal_plans: sterge trainer_id, schimba FK client_id -> users
--    PASTREAZA planurile existente:
--      - vechiul client_id poate fi clients.id (uuid/text)
--      - noul client_id trebuie sa fie users.id (integer)
--      - maparea se face prin clients.user_id, iar fallback prin users.email daca exista clients.email
-- ============================================================

-- Sterge FK-ul vechi (catre clients)
ALTER TABLE meal_plans
  DROP CONSTRAINT IF EXISTS meal_plans_client_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_meal_plans_client_id;

-- Sterge politicile RLS care depind de trainer_id
DROP POLICY IF EXISTS "Trainers manage their meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can view meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can insert meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can update meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can delete meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Clients view approved meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Clients can view approved meal plans" ON meal_plans;

-- Sterge orice alta politica ramasa pe meal_plans (indiferent de nume)
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'meal_plans' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON meal_plans', r.policyname);
  END LOOP;
END $$;

-- Dezactiveaza RLS temporar pentru a evita alte conflicte
ALTER TABLE meal_plans DISABLE ROW LEVEL SECURITY;

-- Sterge coloana trainer_id
ALTER TABLE meal_plans
  DROP COLUMN IF EXISTS trainer_id;

-- Pastreaza id-ul vechi inainte de schimbarea tipului coloanei
ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS legacy_client_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

UPDATE meal_plans
SET legacy_client_id = client_id::text
WHERE legacy_client_id IS NULL
  AND client_id IS NOT NULL;

-- Schimba tipul client_id in integer. Valorile sunt refacute imediat din legacy_client_id.
ALTER TABLE meal_plans
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN client_id TYPE integer USING NULL;

DO $$
BEGIN
  -- Cazul normal al aplicatiei vechi: meal_plans.client_id = clients.id, clients.user_id = users.id
  IF to_regclass('public.clients') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'clients'
         AND column_name = 'user_id'
     )
  THEN
    EXECUTE '
      UPDATE meal_plans mp
      SET client_id = u.id
      FROM clients c
      JOIN users u ON u.id = c.user_id::text::integer
      WHERE mp.legacy_client_id = c.id::text
        AND c.user_id IS NOT NULL
        AND c.user_id::text ~ ''^[0-9]+$''
        AND mp.client_id IS NULL
    ';
  END IF;

  -- Cazul conturilor sterse/recreate: email-ul clientului este in client_invitations.
  IF to_regclass('public.client_invitations') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'client_invitations'
         AND column_name = 'client_email'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'client_invitations'
         AND column_name = 'client_id'
     )
  THEN
    EXECUTE '
      UPDATE meal_plans mp
      SET client_id = u.id
      FROM client_invitations ci
      JOIN users u ON lower(u.email) = lower(ci.client_email)
      WHERE mp.legacy_client_id = ci.client_id::text
        AND ci.client_email IS NOT NULL
        AND mp.client_id IS NULL
    ';

    IF to_regclass('public.clients') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'clients'
           AND column_name = 'user_id'
       )
    THEN
      EXECUTE '
        UPDATE meal_plans mp
        SET client_id = u.id
        FROM clients c
        JOIN client_invitations ci ON ci.client_id::text = c.id::text
        JOIN users u ON lower(u.email) = lower(ci.client_email)
        WHERE c.user_id IS NOT NULL
          AND mp.legacy_client_id = c.user_id::text
          AND ci.client_email IS NOT NULL
          AND mp.client_id IS NULL
      ';
    END IF;
  END IF;

  -- Fallback pentru baze unde clients are email si nu are user_id completat.
  IF to_regclass('public.clients') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'clients'
         AND column_name = 'email'
     )
  THEN
    EXECUTE '
      UPDATE meal_plans mp
      SET client_id = u.id
      FROM clients c
      JOIN users u ON lower(u.email) = lower(c.email)
      WHERE mp.legacy_client_id = c.id::text
        AND c.email IS NOT NULL
        AND mp.client_id IS NULL
    ';
  END IF;

  -- Fallback pentru randuri deja migrate: legacy_client_id este deja users.id.
  UPDATE meal_plans mp
  SET client_id = mp.legacy_client_id::integer
  WHERE mp.client_id IS NULL
    AND mp.legacy_client_id ~ '^[0-9]+$'
    AND EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = mp.legacy_client_id::integer
    );
END $$;

-- Adauga noul FK catre users
ALTER TABLE meal_plans
  ADD CONSTRAINT meal_plans_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- 7. workout_plans: sterge trainer_id, schimba FK client_id -> users
--    Pastreaza si remapeaza planurile existente, la fel ca meal_plans.
-- ============================================================

ALTER TABLE workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_client_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_workout_plans_client_id;

-- Sterge politicile RLS care depind de trainer_id
DROP POLICY IF EXISTS "Trainers manage their workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can view workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can insert workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can update workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can delete workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Clients view approved workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Clients can view approved workout plans" ON workout_plans;

-- Sterge orice alta politica ramasa pe workout_plans (indiferent de nume)
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'workout_plans' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON workout_plans', r.policyname);
  END LOOP;
END $$;

-- Dezactiveaza RLS temporar
ALTER TABLE workout_plans DISABLE ROW LEVEL SECURITY;

ALTER TABLE workout_plans
  DROP COLUMN IF EXISTS trainer_id;

ALTER TABLE workout_plans
  ADD COLUMN IF NOT EXISTS legacy_client_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

UPDATE workout_plans
SET legacy_client_id = client_id::text
WHERE legacy_client_id IS NULL
  AND client_id IS NOT NULL;

ALTER TABLE workout_plans
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN client_id TYPE integer USING NULL;

DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'clients'
         AND column_name = 'user_id'
     )
  THEN
    EXECUTE '
      UPDATE workout_plans wp
      SET client_id = u.id
      FROM clients c
      JOIN users u ON u.id = c.user_id::text::integer
      WHERE wp.legacy_client_id = c.id::text
        AND c.user_id IS NOT NULL
        AND c.user_id::text ~ ''^[0-9]+$''
        AND wp.client_id IS NULL
    ';
  END IF;

  IF to_regclass('public.client_invitations') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'client_invitations'
         AND column_name = 'client_email'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'client_invitations'
         AND column_name = 'client_id'
     )
  THEN
    EXECUTE '
      UPDATE workout_plans wp
      SET client_id = u.id
      FROM client_invitations ci
      JOIN users u ON lower(u.email) = lower(ci.client_email)
      WHERE wp.legacy_client_id = ci.client_id::text
        AND ci.client_email IS NOT NULL
        AND wp.client_id IS NULL
    ';

    IF to_regclass('public.clients') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'clients'
           AND column_name = 'user_id'
       )
    THEN
      EXECUTE '
        UPDATE workout_plans wp
        SET client_id = u.id
        FROM clients c
        JOIN client_invitations ci ON ci.client_id::text = c.id::text
        JOIN users u ON lower(u.email) = lower(ci.client_email)
        WHERE c.user_id IS NOT NULL
          AND wp.legacy_client_id = c.user_id::text
          AND ci.client_email IS NOT NULL
          AND wp.client_id IS NULL
      ';
    END IF;
  END IF;

  IF to_regclass('public.clients') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'clients'
         AND column_name = 'email'
     )
  THEN
    EXECUTE '
      UPDATE workout_plans wp
      SET client_id = u.id
      FROM clients c
      JOIN users u ON lower(u.email) = lower(c.email)
      WHERE wp.legacy_client_id = c.id::text
        AND c.email IS NOT NULL
        AND wp.client_id IS NULL
    ';
  END IF;

  UPDATE workout_plans wp
  SET client_id = wp.legacy_client_id::integer
  WHERE wp.client_id IS NULL
    AND wp.legacy_client_id ~ '^[0-9]+$'
    AND EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = wp.legacy_client_id::integer
    );
END $$;

ALTER TABLE workout_plans
  ADD CONSTRAINT workout_plans_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_meal_plans_client_approved;
DROP INDEX IF EXISTS idx_workout_plans_client_approved;

CREATE INDEX IF NOT EXISTS idx_meal_plans_client_created
  ON meal_plans(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_plans_client_created
  ON workout_plans(client_id, created_at DESC);

ALTER TABLE meal_plans
  DROP COLUMN IF EXISTS approval_status,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS legacy_client_id;

ALTER TABLE workout_plans
  DROP COLUMN IF EXISTS approval_status,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS legacy_client_id;

-- ============================================================
-- 8. generation_status: inlocuieste trainer_id cu user_id,
--    si schimba client_id din uuid in bigint.
-- ============================================================

-- Sterge constrangerile unice vechi
ALTER TABLE generation_status
  DROP CONSTRAINT IF EXISTS generation_status_client_id_trainer_id_key,
  DROP CONSTRAINT IF EXISTS generation_status_client_id_key;

-- Sterge FK-ul existent pe client_id (catre clients.id uuid) - OBLIGATORIU inainte de ALTER TYPE
ALTER TABLE generation_status
  DROP CONSTRAINT IF EXISTS generation_status_client_id_fkey;

-- Sterge orice alta politica RLS pe generation_status
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'generation_status' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON generation_status', r.policyname);
  END LOOP;
END $$;
ALTER TABLE generation_status DISABLE ROW LEVEL SECURITY;

-- Sterge trainer_id (cu CASCADE pentru a elimina si dependentele)
ALTER TABLE generation_status
  DROP COLUMN IF EXISTS trainer_id CASCADE;

-- Goleste tabela (statusuri vechi cu uuid-uri invalide)
TRUNCATE TABLE generation_status RESTART IDENTITY CASCADE;

-- Schimba tipul client_id din uuid in integer (users.id este integer)
ALTER TABLE generation_status
  ALTER COLUMN client_id TYPE integer USING NULL;

-- Adauga user_id (integer, acelasi tip cu users.id)
ALTER TABLE generation_status
  ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE CASCADE;

-- Adauga constrangere unica pe (client_id) — client_id = user_id acum
ALTER TABLE generation_status
  ADD CONSTRAINT generation_status_client_id_key UNIQUE (client_id);

DROP TABLE IF EXISTS client_invitations CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

-- ============================================================
-- 9. (Optional) RLS: asigura-te ca users pot citi/modifica propria linie
-- ============================================================
-- Daca ai RLS activat pe users, adauga politici pentru noile coloane:
-- CREATE POLICY IF NOT EXISTS "Users can update own profile"
--   ON users FOR UPDATE USING (auth.uid()::text = id::text);

-- ============================================================
-- 10. Raport rapid dupa migrare
-- ============================================================
SELECT
  'meal_plans fara user mapat' AS check_name,
  COUNT(*) AS rows_count
FROM meal_plans
WHERE client_id IS NULL
UNION ALL
SELECT
  'workout_plans fara user mapat' AS check_name,
  COUNT(*) AS rows_count
FROM workout_plans
WHERE client_id IS NULL;

-- ============================================================
-- Done! Ruleaza scriptul de cod pentru a actualiza API-urile.
-- ============================================================
