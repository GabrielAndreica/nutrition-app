-- ============================================================
-- Elimina 6 zile de antrenament si Bro Split din datele existente.
-- Ruleaza in Supabase SQL Editor dupa deploy-ul codului.
-- ============================================================

UPDATE users
SET workouts_per_week = 5
WHERE workouts_per_week IS NOT NULL
  AND workouts_per_week > 5;

UPDATE users
SET training_split = 'Upper/Lower/Push/Pull/Legs'
WHERE training_split IS NOT NULL
  AND lower(replace(replace(training_split, '-', ' '), '_', ' ')) = 'bro split';

DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE '
      UPDATE clients
      SET workouts_per_week = 5
      WHERE workouts_per_week IS NOT NULL
        AND workouts_per_week > 5
    ';

    EXECUTE '
      UPDATE clients
      SET training_split = ''Upper/Lower/Push/Pull/Legs''
      WHERE training_split IS NOT NULL
        AND lower(replace(replace(training_split, ''-'', '' ''), ''_'', '' '')) = ''bro split''
    ';
  END IF;
END $$;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_workouts_per_week_2_5;

ALTER TABLE users
  ADD CONSTRAINT users_workouts_per_week_2_5
  CHECK (workouts_per_week IS NULL OR workouts_per_week BETWEEN 2 AND 5);

DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_workouts_per_week_2_5';

    EXECUTE '
      ALTER TABLE clients
      ADD CONSTRAINT clients_workouts_per_week_2_5
      CHECK (workouts_per_week IS NULL OR workouts_per_week BETWEEN 2 AND 5)
    ';
  END IF;
END $$;

SELECT
  'users cu 6+ antrenamente sau bro split' AS check_name,
  COUNT(*) AS rows_count
FROM users
WHERE COALESCE(workouts_per_week, 0) > 5
   OR lower(replace(replace(COALESCE(training_split, ''), '-', ' '), '_', ' ')) = 'bro split';
