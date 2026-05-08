-- =================================================================
-- Tabel: activity_logs
-- Rulează acest script în Supabase Dashboard → SQL Editor
-- pentru a crea tabelul de jurnalizare a activității.
-- =================================================================

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Acțiunea logată: 'auth.signin', 'auth.signup', 'client.create', etc.
  action      TEXT        NOT NULL,

  -- Rezultatul: 'success' | 'failure' | 'error' | 'blocked'
  status      TEXT        NOT NULL,

  -- Utilizatorul asociat (NULL dacă nu era autentificat)
  user_id     BIGINT      REFERENCES public.users(id) ON DELETE SET NULL,

  -- Email-ul implicat (util pentru evenimente de auth)
  email       TEXT,

  -- Metadata rețea
  ip_address  TEXT,
  user_agent  TEXT,

  -- Date suplimentare specifice evenimentului
  details     JSONB
);

-- Older local drafts used UUID for user_id. The app uses public.users(id) as BIGINT/INTEGER.
-- If this table already exists with UUID user_id, normalize it so server-side logging works.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_logs'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;
    ALTER TABLE public.activity_logs
      ALTER COLUMN user_id TYPE BIGINT USING NULL;
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT activity_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Indecși pentru interogări frecvente ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_logs_user_id    ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_action     ON public.activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_status     ON public.activity_logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.activity_logs(created_at DESC);

-- ── Securitate ───────────────────────────────────────────────────
-- Activează RLS; scrierile se fac exclusiv prin service role (server-side).
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Dacă vrei ca un admin autentificat să poată citi log-urile:
-- CREATE POLICY "admin_read_logs" ON public.activity_logs
--   FOR SELECT USING (auth.role() = 'authenticated');

COMMENT ON TABLE public.activity_logs IS
  'Jurnal de activitate al aplicației trevano. Populat exclusiv server-side.';

-- Retention helper: schedule this monthly via Supabase Cron/pg_cron.
CREATE OR REPLACE FUNCTION public.cleanup_old_activity_logs(retention_days INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.activity_logs
  WHERE created_at < NOW() - make_interval(days => GREATEST(retention_days, 30));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_activity_logs IS
  'Deletes activity logs older than retention_days. Recommended schedule: monthly, retention 180 days or per policy.';
