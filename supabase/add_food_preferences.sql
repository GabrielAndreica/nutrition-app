-- Adaugă coloana food_preferences în tabelul clients
-- Rulează acest SQL în Supabase Dashboard -> SQL Editor

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS food_preferences TEXT;

COMMENT ON COLUMN clients.food_preferences IS 'Preferințe alimentare ale clientului (alimente preferate sau evitate, altele decât alergii)';
