-- ============================================================
-- Video-uri pentru exercitii
-- Leaga fiecare exercitiu de un MP4 din Supabase Storage.
-- ============================================================

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS video_storage_bucket text DEFAULT 'video-exercitii',
  ADD COLUMN IF NOT EXISTS video_storage_path text,
  ADD COLUMN IF NOT EXISTS difficulty_level text;

ALTER TABLE exercises
  ALTER COLUMN video_storage_bucket SET DEFAULT 'video-exercitii';

UPDATE exercises
SET video_storage_bucket = 'video-exercitii'
WHERE video_storage_bucket = 'vide-exercitii';

UPDATE exercises
SET video_url = replace(video_url, '/vide-exercitii/', '/video-exercitii/')
WHERE video_url LIKE '%/vide-exercitii/%';

CREATE INDEX IF NOT EXISTS idx_exercises_video_storage_path
  ON exercises(video_storage_path)
  WHERE video_storage_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.exercise_video_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(
    translate(
      lower(coalesce(value, '')),
      'ăâîșşțţáàäéèëíìïóòöúùü',
      'aaisssttaaaeeeiiiooouuu'
    ),
    '[^a-z0-9]+',
    '-',
    'g'
  ));
$$;

-- Completeaza automat video_storage_path pentru fisierele MP4 deja urcate in Storage.
-- Regula: numele fisierului trebuie sa fie varianta slug a exercitiului:
--   Bench Press       -> bench-press.mp4
--   Impins la piept   -> impins-la-piept.mp4
-- Functioneaza si daca ai fisiere in foldere, ex: piept/bench-press.mp4.
WITH video_files AS (
  SELECT DISTINCT ON (video_key)
    name AS storage_path,
    video_key
  FROM (
    SELECT
      name,
      public.exercise_video_key(
        regexp_replace(
          regexp_replace(name, '^.*/', ''),
          '\.[^.]+$',
          ''
        )
      ) AS video_key
    FROM storage.objects
    WHERE bucket_id = 'video-exercitii'
      AND lower(name) ~ '\.mp4$'
  ) files
  WHERE video_key <> ''
  ORDER BY video_key, name
)
UPDATE exercises e
SET video_storage_bucket = 'video-exercitii',
    video_storage_path = vf.storage_path
FROM video_files vf
WHERE e.video_storage_path IS NULL
  AND vf.video_key IN (
    public.exercise_video_key(e.name),
    public.exercise_video_key(e.name_ro)
  );

-- Raport: exercitiile ramase fara video dupa auto-match.
SELECT
  name,
  name_ro,
  muscle_group
FROM exercises
WHERE video_storage_path IS NULL
ORDER BY name;

-- Variante de completare:
--
-- 1. Daca bucket-ul este public, poti salva doar path-ul din bucket:
-- UPDATE exercises
-- SET video_storage_bucket = 'video-exercitii',
--     video_storage_path = 'bench-press.mp4'
-- WHERE lower(name) = lower('Bench Press');
--
-- 2. Sau poti salva URL-ul public complet:
-- UPDATE exercises
-- SET video_url = 'https://PROJECT.supabase.co/storage/v1/object/public/video-exercitii/bench-press.mp4'
-- WHERE lower(name) = lower('Bench Press');
--
-- Recomandare naming in Storage:
-- video-exercitii/
--   bench-press.mp4
--   lat-pulldown.mp4
--   squat.mp4
