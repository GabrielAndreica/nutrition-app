-- ============================================================
-- Notificari B2C: hardening productie
-- RLS strict + indexuri pentru citire/mark-read la volum.
-- Ruleaza in Supabase SQL Editor.
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

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
DROP POLICY IF EXISTS "notifications_update_read_own" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_own" ON notifications;
DROP POLICY IF EXISTS "notifications_delete_own" ON notifications;

CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (user_id = auth_user_id());

CREATE POLICY "notifications_update_read_own" ON notifications
  FOR UPDATE USING (user_id = auth_user_id())
  WITH CHECK (user_id = auth_user_id());

-- Daca aplicatia expune si client Supabase direct, limitam update-ul direct
-- la marcarea ca citit. API-urile server-side folosesc service role si nu sunt afectate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE INSERT, UPDATE, DELETE ON notifications FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE ON notifications FROM authenticated;
    GRANT SELECT ON notifications TO authenticated;
    GRANT UPDATE (is_read) ON notifications TO authenticated;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON notifications(user_id, created_at DESC)
  WHERE is_read = false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'related_client_id'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_notifications_friend_request_lookup
      ON notifications(user_id, type, related_client_id)
      WHERE type IN (''friend_request'', ''friend_request_accepted'')
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'related_plan_id'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_notifications_related_plan_lookup
      ON notifications(user_id, related_plan_id)
      WHERE related_plan_id IS NOT NULL
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_type_length_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_type_length_check
      CHECK (char_length(type) BETWEEN 1 AND 80) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_title_length_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_title_length_check
      CHECK (title IS NULL OR char_length(title) <= 200) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_message_length_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_message_length_check
      CHECK (char_length(message) BETWEEN 1 AND 1000) NOT VALID;
  END IF;
END $$;

SELECT
  'notifications RLS enabled' AS check_name,
  relrowsecurity AS enabled
FROM pg_class
WHERE oid = 'public.notifications'::regclass
UNION ALL
SELECT
  'notifications unread index exists' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_notifications_user_unread_created'
  ) AS enabled;
