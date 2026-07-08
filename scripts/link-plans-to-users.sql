-- ============================================================
-- Finalizare schema users-only:
--   1. Leaga meal_plans si workout_plans direct de users.id
--   2. Pastreaza planurile existente din schema veche cu clients.id
--   3. Elimina approval_status / approved_at / approved_by
--   4. Sterge tabelele legacy clients si client_invitations
--
-- Ruleaza in Supabase SQL Editor daca planurile exista in DB,
-- dar aplicatia da 404 pentru ca client_id inca pointeaza la clients.id
-- sau la vechiul clients.user_id.
-- ============================================================

ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS legacy_client_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE workout_plans
  ADD COLUMN IF NOT EXISTS legacy_client_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

UPDATE meal_plans
SET legacy_client_id = client_id::text
WHERE legacy_client_id IS NULL
  AND client_id IS NOT NULL;

UPDATE workout_plans
SET legacy_client_id = client_id::text
WHERE legacy_client_id IS NULL
  AND client_id IS NOT NULL;

ALTER TABLE meal_plans
  DROP CONSTRAINT IF EXISTS meal_plans_client_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_meal_plans_client_id;

ALTER TABLE workout_plans
  DROP CONSTRAINT IF EXISTS workout_plans_client_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_workout_plans_client_id;

DROP POLICY IF EXISTS "Trainers manage their meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can view meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can insert meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can update meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Trainers can delete meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Clients view approved meal plans" ON meal_plans;
DROP POLICY IF EXISTS "Clients can view approved meal plans" ON meal_plans;

DROP POLICY IF EXISTS "Trainers manage their workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can view workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can insert workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can update workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Trainers can delete workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Clients view approved workout plans" ON workout_plans;
DROP POLICY IF EXISTS "Clients can view approved workout plans" ON workout_plans;

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'meal_plans' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON meal_plans', r.policyname);
  END LOOP;

  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_plans' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON workout_plans', r.policyname);
  END LOOP;
END $$;

ALTER TABLE meal_plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE workout_plans DISABLE ROW LEVEL SECURITY;

ALTER TABLE meal_plans
  DROP COLUMN IF EXISTS trainer_id;

ALTER TABLE workout_plans
  DROP COLUMN IF EXISTS trainer_id;

ALTER TABLE meal_plans
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN client_id TYPE integer USING NULL;

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
      UPDATE meal_plans mp
      SET client_id = u.id
      FROM clients c
      JOIN users u ON u.id = c.user_id::text::integer
      WHERE mp.legacy_client_id = c.id::text
        AND c.user_id IS NOT NULL
        AND c.user_id::text ~ ''^[0-9]+$''
        AND mp.client_id IS NULL
    ';

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
    -- Cazul vechi: plans.client_id = clients.id, iar email-ul e tinut in client_invitations.
    EXECUTE '
      UPDATE meal_plans mp
      SET client_id = u.id
      FROM client_invitations ci
      JOIN users u ON lower(u.email) = lower(ci.client_email)
      WHERE mp.legacy_client_id = ci.client_id::text
        AND ci.client_email IS NOT NULL
        AND mp.client_id IS NULL
    ';

    EXECUTE '
      UPDATE workout_plans wp
      SET client_id = u.id
      FROM client_invitations ci
      JOIN users u ON lower(u.email) = lower(ci.client_email)
      WHERE wp.legacy_client_id = ci.client_id::text
        AND ci.client_email IS NOT NULL
        AND wp.client_id IS NULL
    ';

    -- Cazul cont sters/recreat: plans.client_id poate fi vechiul clients.user_id.
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
      UPDATE meal_plans mp
      SET client_id = u.id
      FROM clients c
      JOIN users u ON lower(u.email) = lower(c.email)
      WHERE mp.legacy_client_id = c.id::text
        AND c.email IS NOT NULL
        AND mp.client_id IS NULL
    ';

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

  UPDATE meal_plans mp
  SET client_id = mp.legacy_client_id::integer
  WHERE mp.client_id IS NULL
    AND mp.legacy_client_id ~ '^[0-9]+$'
    AND EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = mp.legacy_client_id::integer
    );

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

ALTER TABLE meal_plans
  ADD CONSTRAINT meal_plans_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE workout_plans
  ADD CONSTRAINT workout_plans_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_meal_plans_client_id
  ON meal_plans(client_id);

CREATE INDEX IF NOT EXISTS idx_workout_plans_client_id
  ON workout_plans(client_id);

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

ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_plans_select_own" ON meal_plans;
DROP POLICY IF EXISTS "workout_plans_select_own" ON workout_plans;

CREATE POLICY "meal_plans_select_own" ON meal_plans
  FOR SELECT USING (client_id = auth_user_id());

CREATE POLICY "workout_plans_select_own" ON workout_plans
  FOR SELECT USING (client_id = auth_user_id());

DROP TABLE IF EXISTS client_invitations CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

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
