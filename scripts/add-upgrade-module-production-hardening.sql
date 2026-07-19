-- ============================================================
-- Upgrade / Trevano Coach: hardening productie
-- Protejeaza coloanele de billing si optimizeaza lookup-urile Stripe.
-- Ruleaza in Supabase SQL Editor.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS subscription_id text,
  ADD COLUMN IF NOT EXISTS subscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS plan text;

CREATE INDEX IF NOT EXISTS idx_users_subscription_status
  ON users(subscription_status, account_type)
  WHERE role IN ('user', 'client');

CREATE INDEX IF NOT EXISTS idx_users_subscription_plan
  ON users(subscription_plan)
  WHERE subscription_plan IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE stripe_customer_id IS NOT NULL
      AND btrim(stripe_customer_id) <> ''
    GROUP BY stripe_customer_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer_unique
      ON users(stripe_customer_id)
      WHERE stripe_customer_id IS NOT NULL
        AND btrim(stripe_customer_id) <> '';
  ELSE
    RAISE NOTICE 'Nu am creat idx_users_stripe_customer_unique: exista clienti Stripe duplicati.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE subscription_id IS NOT NULL
      AND btrim(subscription_id) <> ''
    GROUP BY subscription_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_subscription_id_unique
      ON users(subscription_id)
      WHERE subscription_id IS NOT NULL
        AND btrim(subscription_id) <> '';
  ELSE
    RAISE NOTICE 'Nu am creat idx_users_subscription_id_unique: exista subscription_id duplicati.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_account_type_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('free', 'paid')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_subscription_status_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_subscription_status_check
      CHECK (
        subscription_status IS NULL
        OR subscription_status IN ('free', 'active', 'expired', 'cancelled', 'canceled', 'inactive')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_subscription_plan_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_subscription_plan_check
      CHECK (subscription_plan IS NULL OR subscription_plan IN ('coach', 'starter', 'pro')) NOT VALID;
  END IF;
END $$;

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE UPDATE (
      account_type,
      subscription_status,
      subscription_plan,
      subscription_id,
      subscribed_at,
      stripe_customer_id,
      plan
    ) ON users FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE UPDATE (
      account_type,
      subscription_status,
      subscription_plan,
      subscription_id,
      subscribed_at,
      stripe_customer_id,
      plan
    ) ON users FROM authenticated;
  END IF;
END $$;

SELECT
  'stripe customer index exists' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_users_stripe_customer_unique'
  ) AS ok
UNION ALL
SELECT
  'subscription id index exists' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_users_subscription_id_unique'
  ) AS ok
UNION ALL
SELECT
  'users RLS enabled' AS check_name,
  relrowsecurity AS ok
FROM pg_class
WHERE oid = 'public.users'::regclass;
