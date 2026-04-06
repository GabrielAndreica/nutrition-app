-- ═══════════════════════════════════════════════════════════
-- Tabel: client_invitations
-- Scopul: Gestionează invitațiile trimise de antrenori către clienți
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.client_invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days') NOT NULL,
  
  -- Referințe
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  trainer_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Email-ul clientului (pentru verificare)
  client_email TEXT NOT NULL,
  
  -- Token unic pentru activare
  token TEXT NOT NULL UNIQUE,
  
  -- Status: 'pending', 'accepted', 'expired'
  status TEXT DEFAULT 'pending' NOT NULL,
  
  -- User ID după activare
  user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  
  -- Când a fost acceptată invitația
  accepted_at TIMESTAMPTZ
);

-- ── Indecși ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invitations_client_id ON public.client_invitations(client_id);
CREATE INDEX IF NOT EXISTS idx_invitations_trainer_id ON public.client_invitations(trainer_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.client_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON public.client_invitations(status);

-- ── Securitate ────────────────────────────────────────────────
-- Nota: Securitatea este gestionată la nivel de API prin JWT
-- RLS nu este activat deoarece auth.uid() (UUID) este incompatibil cu trainer_id (INTEGER)

COMMENT ON TABLE public.client_invitations IS
  'Invitații trimise de antrenori către clienți pentru activare cont';

-- ── Adaugă coloana user_id în clients (pentru linkare la cont) ──
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients(user_id);

COMMENT ON COLUMN public.clients.user_id IS
  'ID-ul userului asociat (dacă clientul are cont activ)';

-- ── Adaugă coloana role în users (pentru diferențiere trainer/client) ──
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'trainer' NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

COMMENT ON COLUMN public.users.role IS
  'Rolul utilizatorului: trainer (antrenor) sau client';
