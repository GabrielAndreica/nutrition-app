-- ============================================================
-- Fix definitiv: converteste toate coloanele uuid catre integer
-- pentru a se potrivi cu users.id (integer).
-- Ruleaza DUPA migrate-clients-to-users.sql
-- si INAINTE de setup-rls-and-indexes.sql
-- ============================================================

-- ============================================================
-- 1. notifications
--    - user_id: uuid → integer (FK → users.id)
--    - related_client_id: uuid → integer (era FK → clients.id)
-- ============================================================

-- Sterge orice politica RLS existenta
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'notifications' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON notifications', r.policyname);
  END LOOP;
END $$;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

-- Sterge toate FK constraints pe notifications
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- Truncheaza (notificarile vechi au user_id uuid invalid)
TRUNCATE TABLE notifications RESTART IDENTITY CASCADE;

-- Converteste user_id din uuid in integer
ALTER TABLE notifications
  ALTER COLUMN user_id TYPE integer USING NULL;

-- Converteste related_client_id din uuid in integer (daca exista)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'related_client_id'
  ) THEN
    ALTER TABLE notifications
      ALTER COLUMN related_client_id TYPE integer USING NULL;
  END IF;
END $$;

-- Re-adauga FK catre users
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- 2. activity_logs
--    - user_id: uuid/text → integer (FK → users.id)
-- ============================================================

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'activity_logs' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON activity_logs', r.policyname);
  END LOOP;
END $$;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;

-- Sterge FK constraints
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'activity_logs'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- Truncheaza (logurile vechi au user_id invalid)
TRUNCATE TABLE activity_logs RESTART IDENTITY CASCADE;

-- Converteste user_id in integer
ALTER TABLE activity_logs
  ALTER COLUMN user_id TYPE integer USING NULL;

-- Re-adauga FK (nullable - unele loguri pot fi fara user autentificat)
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================
-- 3. weight_history
--    - client_id: uuid → integer (era FK → clients.id)
-- ============================================================

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'weight_history' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON weight_history', r.policyname);
  END LOOP;
END $$;
ALTER TABLE weight_history DISABLE ROW LEVEL SECURITY;

-- Sterge FK constraints
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'weight_history'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE weight_history DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- Truncheaza
TRUNCATE TABLE weight_history RESTART IDENTITY CASCADE;

-- Converteste client_id in integer
ALTER TABLE weight_history
  ALTER COLUMN client_id TYPE integer USING NULL;

-- Re-adauga FK catre users
ALTER TABLE weight_history
  ADD CONSTRAINT weight_history_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- Done! Acum ruleaza setup-rls-and-indexes.sql
-- ============================================================
