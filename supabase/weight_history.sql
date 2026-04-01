-- Tabel pentru istoricul greutății clienților
-- Rulează acest SQL în Supabase Dashboard -> SQL Editor

CREATE TABLE IF NOT EXISTS weight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  weight DECIMAL(5,2) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pentru query-uri rapide pe client_id și dată
CREATE INDEX IF NOT EXISTS idx_weight_history_client_id ON weight_history(client_id);
CREATE INDEX IF NOT EXISTS idx_weight_history_recorded_at ON weight_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_weight_history_client_date ON weight_history(client_id, recorded_at DESC);

-- RLS (Row Level Security) - opțional, pentru securitate suplimentară
-- ALTER TABLE weight_history ENABLE ROW LEVEL SECURITY;

-- Comentariu pentru documentare
COMMENT ON TABLE weight_history IS 'Istoricul greutății clienților pentru tracking progres și detectare stagnare';
COMMENT ON COLUMN weight_history.weight IS 'Greutatea în kg';
COMMENT ON COLUMN weight_history.recorded_at IS 'Data la care a fost înregistrată greutatea';
COMMENT ON COLUMN weight_history.notes IS 'Observații opționale (ex: după masă, dimineața, etc.)';
