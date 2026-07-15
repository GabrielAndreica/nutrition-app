-- ============================================================
-- Greutate dorita pentru onboarding
-- Obiectivul caloric este derivat in aplicatie din weight -> target_weight.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS target_weight numeric(6,2);

-- Coloane necesare flow-ului signup -> confirmare email -> signin.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS confirmation_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS nutrition_target_calories integer,
  ADD COLUMN IF NOT EXISTS nutrition_target_protein_g integer,
  ADD COLUMN IF NOT EXISTS nutrition_target_carbs_g integer,
  ADD COLUMN IF NOT EXISTS nutrition_target_fat_g integer,
  ADD COLUMN IF NOT EXISTS last_weekly_checkin_at timestamptz;

UPDATE users
SET account_type = CASE
    WHEN subscription_status = 'active' THEN 'paid'
    ELSE 'free'
  END
WHERE account_type IS NULL;

UPDATE users
SET subscription_status = 'free'
WHERE subscription_status IS NULL
   OR subscription_status IN ('trial', 'expired', 'cancelled', 'inactive');

ALTER TABLE users
  DROP COLUMN IF EXISTS trial_ends_at;

ALTER TABLE users
  ALTER COLUMN account_type SET DEFAULT 'free',
  ALTER COLUMN subscription_status SET DEFAULT 'free';

CREATE INDEX IF NOT EXISTS idx_users_confirmation_token
  ON users(confirmation_token)
  WHERE confirmation_token IS NOT NULL;
