-- ============================================================
-- Unlock-uri pentru retete cu moneda aplicatiei
-- Primele 3 retete / tip masa sunt gratuite, restul se cumpara.
-- Ruleaza dupa scripts/add-app-currency.sql.
-- ============================================================

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coin_price integer NOT NULL DEFAULT 50 CHECK (coin_price >= 0);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY meal_type
      ORDER BY created_at ASC NULLS LAST, name ASC, id ASC
    ) AS rn
  FROM recipes
  WHERE meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')
)
UPDATE recipes r
SET
  is_free = ranked.rn <= 3,
  coin_price = CASE WHEN ranked.rn <= 3 THEN 0 ELSE GREATEST(r.coin_price, 50) END
FROM ranked
WHERE r.id = ranked.id;

CREATE TABLE IF NOT EXISTS user_recipe_unlocks (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  paid_coins integer NOT NULL DEFAULT 0 CHECK (paid_coins >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_user_recipe_unlocks_user
  ON user_recipe_unlocks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_recipe_unlocks_recipe
  ON user_recipe_unlocks(recipe_id);

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

CREATE OR REPLACE FUNCTION public.purchase_recipe_with_coins(
  p_user_id integer,
  p_recipe_id uuid
)
RETURNS TABLE(unlocked boolean, already_owned boolean, balance integer, price integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance integer;
  recipe_price integer;
  recipe_is_free boolean;
  next_balance integer;
BEGIN
  SELECT app_coins
  INTO current_balance
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  SELECT COALESCE(coin_price, 0), COALESCE(is_free, false)
  INTO recipe_price, recipe_is_free
  FROM recipes
  WHERE id = p_recipe_id;

  IF recipe_price IS NULL THEN
    RAISE EXCEPTION 'recipe not found';
  END IF;

  IF recipe_is_free OR recipe_price <= 0 THEN
    unlocked := true;
    already_owned := true;
    balance := current_balance;
    price := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM user_recipe_unlocks
    WHERE user_id = p_user_id
      AND recipe_id = p_recipe_id
  ) THEN
    unlocked := true;
    already_owned := true;
    balance := current_balance;
    price := recipe_price;
    RETURN NEXT;
    RETURN;
  END IF;

  IF current_balance < recipe_price THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  next_balance := current_balance - recipe_price;

  UPDATE users
  SET app_coins = next_balance
  WHERE id = p_user_id;

  INSERT INTO user_recipe_unlocks(user_id, recipe_id, paid_coins)
  VALUES (p_user_id, p_recipe_id, recipe_price)
  ON CONFLICT (user_id, recipe_id) DO NOTHING;

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
    -recipe_price,
    next_balance,
    'Rețetă deblocată',
    'recipe_purchase',
    p_recipe_id::text,
    jsonb_build_object('recipe_id', p_recipe_id)
  )
  ON CONFLICT DO NOTHING;

  unlocked := true;
  already_owned := false;
  balance := next_balance;
  price := recipe_price;
  RETURN NEXT;
END;
$$;

ALTER TABLE user_recipe_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_recipe_unlocks_select_own" ON user_recipe_unlocks;

CREATE POLICY "user_recipe_unlocks_select_own" ON user_recipe_unlocks
  FOR SELECT USING (user_id = auth_user_id());
