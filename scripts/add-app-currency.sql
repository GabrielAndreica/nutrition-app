-- ============================================================
-- Moneda aplicatiei
-- Balanță pe users + ledger auditabil pentru recompense.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_coins integer NOT NULL DEFAULT 0 CHECK (app_coins >= 0);

CREATE TABLE IF NOT EXISTS app_currency_ledger (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  source_type text,
  source_key text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_currency_ledger_user_created
  ON app_currency_ledger(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_currency_ledger_unique_source
  ON app_currency_ledger(user_id, source_type, source_key)
  WHERE source_key IS NOT NULL;

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

CREATE OR REPLACE FUNCTION public.award_app_coins(
  p_user_id integer,
  p_amount integer,
  p_reason text,
  p_source_type text DEFAULT NULL,
  p_source_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS TABLE(amount_awarded integer, balance integer, transaction_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance integer;
  next_balance integer;
  existing_id bigint;
  existing_balance integer;
  inserted_id bigint;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'amount must not be zero';
  END IF;

  SELECT app_coins
  INTO current_balance
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  IF p_source_key IS NOT NULL THEN
    SELECT id, balance_after
    INTO existing_id, existing_balance
    FROM app_currency_ledger
    WHERE user_id = p_user_id
      AND source_type IS NOT DISTINCT FROM p_source_type
      AND source_key = p_source_key
    LIMIT 1;

    IF existing_id IS NOT NULL THEN
      amount_awarded := 0;
      balance := current_balance;
      transaction_id := existing_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  next_balance := current_balance + p_amount;
  IF next_balance < 0 THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  UPDATE users
  SET app_coins = next_balance
  WHERE id = p_user_id;

  INSERT INTO app_currency_ledger (
    user_id,
    amount,
    balance_after,
    reason,
    source_type,
    source_key,
    metadata
  )
  VALUES (
    p_user_id,
    p_amount,
    next_balance,
    COALESCE(NULLIF(p_reason, ''), 'reward'),
    p_source_type,
    p_source_key,
    COALESCE(p_metadata, '{}')
  )
  RETURNING id INTO inserted_id;

  amount_awarded := p_amount;
  balance := next_balance;
  transaction_id := inserted_id;
  RETURN NEXT;
END;
$$;

ALTER TABLE app_currency_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_currency_ledger_select_own" ON app_currency_ledger;

CREATE POLICY "app_currency_ledger_select_own" ON app_currency_ledger
  FOR SELECT USING (user_id = auth_user_id());
