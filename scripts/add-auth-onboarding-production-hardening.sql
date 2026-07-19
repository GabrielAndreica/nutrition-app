-- ============================================================
-- Hardening productie pentru auth + onboarding B2C
-- Ruleaza in Supabase SQL Editor inainte de deploy.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS confirmation_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free';

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

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;

CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth_user_id());

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth_user_id())
  WITH CHECK (id = auth_user_id());

CREATE INDEX IF NOT EXISTS idx_users_email_lookup
  ON users(lower(btrim(email)))
  WHERE email IS NOT NULL
    AND btrim(email) <> '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE email IS NOT NULL
      AND btrim(email) <> ''
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique_normalized
      ON users(lower(btrim(email)))
      WHERE email IS NOT NULL
        AND btrim(email) <> '';
  ELSE
    RAISE NOTICE 'Nu am creat idx_users_email_unique_normalized: exista emailuri duplicate case-insensitive.';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_users_confirmation_token;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_confirmation_token_unique
  ON users(confirmation_token)
  WHERE confirmation_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_pending_confirmation_expiry
  ON users(confirmation_token_expires_at)
  WHERE status = 'pending'
    AND confirmation_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_onboarding_status
  ON users(id, onboarding_completed)
  WHERE role IN ('user', 'client');

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_cleanup
  ON api_rate_limits(window_start);

-- Daca functia exista deja cu alt RETURN TYPE, Postgres cere DROP inainte.
DROP FUNCTION IF EXISTS public.check_rate_limit(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id text,
  p_endpoint text,
  p_max_requests integer,
  p_window_minutes integer
)
RETURNS TABLE(allowed boolean, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_user_id text := left(coalesce(nullif(btrim(p_user_id), ''), 'unknown'), 160);
  safe_endpoint text := left(coalesce(nullif(btrim(p_endpoint), ''), 'api'), 160);
  safe_max integer := greatest(1, least(coalesce(p_max_requests, 60), 100000));
  safe_window_minutes integer := greatest(1, least(coalesce(p_window_minutes, 1), 1440));
  window_seconds integer;
  current_window timestamptz;
  next_reset timestamptz;
  new_count integer;
BEGIN
  window_seconds := safe_window_minutes * 60;
  current_window := to_timestamp(floor(extract(epoch FROM now()) / window_seconds) * window_seconds);
  next_reset := current_window + make_interval(mins => safe_window_minutes);

  INSERT INTO api_rate_limits(user_id, endpoint, window_start, request_count)
  VALUES (safe_user_id, safe_endpoint, current_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET
    request_count = api_rate_limits.request_count + 1,
    updated_at = now()
  RETURNING request_count INTO new_count;

  allowed := new_count <= safe_max;
  reset_at := next_reset;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prune_old_api_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM api_rate_limits
  WHERE window_start < now() - interval '2 days';
$$;

GRANT EXECUTE ON FUNCTION public.prune_old_api_rate_limits() TO service_role;

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_rate_limits_no_user_access" ON api_rate_limits;
CREATE POLICY "api_rate_limits_no_user_access" ON api_rate_limits
  FOR ALL USING (false)
  WITH CHECK (false);

DO $$
BEGIN
  IF to_regclass('public.activity_logs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "activity_logs_select_own" ON activity_logs';
    EXECUTE '
      CREATE POLICY "activity_logs_select_own" ON activity_logs
      FOR SELECT USING (user_id = auth_user_id())
    ';
  END IF;
END $$;

SELECT
  'emailuri duplicate case-insensitive' AS check_name,
  count(*) AS rows_count
FROM (
  SELECT lower(btrim(email))
  FROM users
  WHERE email IS NOT NULL
    AND btrim(email) <> ''
  GROUP BY lower(btrim(email))
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT
  'tokenuri confirmare duplicate' AS check_name,
  count(*) AS rows_count
FROM (
  SELECT confirmation_token
  FROM users
  WHERE confirmation_token IS NOT NULL
  GROUP BY confirmation_token
  HAVING count(*) > 1
) duplicates;
