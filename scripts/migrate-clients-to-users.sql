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
  ADD COLUMN IF NOT EXISTS level integer DEFAULT 1;

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
  ADD COLUMN IF NOT EXISTS weekly_plan_generation_error text;

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
-- 6. meal_plans: sterge trainer_id, schimba FK client_id → users
--    NOTA: client_id era uuid (FK -> clients.id care era uuid).
--          users.id este integer, deci trebuie schimbat tipul.
--          Se truncheaza tabela (datele vechi nu mai sunt valide).
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

-- Goleste tabela (planurile vechi au client_id uuid invalid dupa migrare)
TRUNCATE TABLE meal_plans RESTART IDENTITY CASCADE;

-- Schimba tipul client_id din uuid in integer (sa se potriveasca cu users.id)
ALTER TABLE meal_plans
  ALTER COLUMN client_id TYPE integer USING NULL;

-- Adauga noul FK catre users
ALTER TABLE meal_plans
  ADD CONSTRAINT meal_plans_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- 7. workout_plans: sterge trainer_id, schimba FK client_id → users
--    Acelasi tratament ca la meal_plans (tip uuid → bigint).
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

TRUNCATE TABLE workout_plans RESTART IDENTITY CASCADE;

ALTER TABLE workout_plans
  ALTER COLUMN client_id TYPE integer USING NULL;

ALTER TABLE workout_plans
  ADD CONSTRAINT workout_plans_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

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

-- ============================================================
-- 9. (Optional) RLS: asigura-te ca users pot citi/modifica propria linie
-- ============================================================
-- Daca ai RLS activat pe users, adauga politici pentru noile coloane:
-- CREATE POLICY IF NOT EXISTS "Users can update own profile"
--   ON users FOR UPDATE USING (auth.uid()::text = id::text);

-- ============================================================
-- Done! Ruleaza scriptul de cod pentru a actualiza API-urile.
-- ============================================================
