-- ============================================================
-- Recompense XP idempotente pentru evenimente speciale
-- Folosit pentru upgrade-ul la Trevano Coach dupa checkout.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_xp_ledger (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  source_type text NOT NULL,
  source_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_user_xp_ledger_user_created
  ON user_xp_ledger(user_id, created_at DESC);

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

ALTER TABLE user_xp_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_xp_ledger_select_own" ON user_xp_ledger;
CREATE POLICY "user_xp_ledger_select_own" ON user_xp_ledger
  FOR SELECT USING (user_id = auth_user_id());
