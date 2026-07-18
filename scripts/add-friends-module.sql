-- ============================================================
-- Modul Prieteni B2C
-- Lista de prieteni este legata direct de users.id.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_friendships (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> friend_user_id)
);

ALTER TABLE user_friendships
  ALTER COLUMN status SET DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_friendships_pair_unique
  ON user_friendships(LEAST(user_id, friend_user_id), GREATEST(user_id, friend_user_id));

CREATE INDEX IF NOT EXISTS idx_user_friendships_user_status
  ON user_friendships(user_id, status, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_friendships_friend_status
  ON user_friendships(friend_user_id, status, accepted_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_name_trgm
  ON users USING gin (name gin_trgm_ops);

DROP INDEX IF EXISTS idx_users_name_unique_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_unique_normalized
  ON users (lower(btrim(name)))
  WHERE name IS NOT NULL
    AND btrim(name) <> ''
    AND onboarding_completed = true;

CREATE OR REPLACE FUNCTION public.touch_user_friendships_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'accepted' AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_friendships_updated_at ON user_friendships;
CREATE TRIGGER trg_user_friendships_updated_at
  BEFORE INSERT OR UPDATE ON user_friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_friendships_updated_at();

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

ALTER TABLE user_friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_friendships_select_own" ON user_friendships;
DROP POLICY IF EXISTS "user_friendships_insert_own_pending" ON user_friendships;
DROP POLICY IF EXISTS "user_friendships_accept_received" ON user_friendships;

CREATE POLICY "user_friendships_select_own" ON user_friendships
  FOR SELECT USING (user_id = auth_user_id() OR friend_user_id = auth_user_id());

CREATE POLICY "user_friendships_insert_own_pending" ON user_friendships
  FOR INSERT WITH CHECK (user_id = auth_user_id() AND status = 'pending');

CREATE POLICY "user_friendships_accept_received" ON user_friendships
  FOR UPDATE USING (friend_user_id = auth_user_id())
  WITH CHECK (friend_user_id = auth_user_id() AND status IN ('accepted', 'blocked'));
