-- ============================================================
-- Imagini pentru retete
-- Leaga fiecare reteta de o imagine din Supabase Storage.
-- Aplicatia citeste bucket-ul si path-ul din DB, apoi API-ul
-- genereaza URL-ul semnat/public server-side.
-- ============================================================

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_storage_bucket text DEFAULT 'imagini-mancare',
  ADD COLUMN IF NOT EXISTS image_storage_path text;

ALTER TABLE recipes
  ALTER COLUMN image_storage_bucket SET DEFAULT 'imagini-mancare';

UPDATE recipes
SET image_storage_bucket = 'imagini-mancare'
WHERE image_storage_path IS NOT NULL
  AND (image_storage_bucket IS NULL OR image_storage_bucket = '');

CREATE INDEX IF NOT EXISTS idx_recipes_image_storage_path
  ON recipes(image_storage_path)
  WHERE image_storage_path IS NOT NULL;
