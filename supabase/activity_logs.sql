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
  user_id     UUID        REFERENCES public.users(id) ON DELETE SET NULL,

  -- Email-ul implicat (util pentru evenimente de auth)
  email       TEXT,

  -- Metadata rețea
  ip_address  TEXT,
  user_agent  TEXT,

  -- Date suplimentare specifice evenimentului
  details     JSONB
);

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
  'Jurnal de activitate al aplicației NutriAI. Populat exclusiv server-side.';
