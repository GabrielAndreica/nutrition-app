-- ============================================================
-- Limite realiste de portie pentru generatorul de mese
-- Optional, dar recomandat pentru productie.
--
-- Generatorul foloseste:
--   - min_amount_per_meal: minimul afisat pentru o masa
--   - max_amount_per_meal: maximul afisat pentru o masa
--   - daily_max_amount: maximul total pe zi pentru acel aliment
-- ============================================================

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS min_amount_per_meal numeric DEFAULT 30 CHECK (min_amount_per_meal >= 0),
  ADD COLUMN IF NOT EXISTS daily_max_amount numeric CHECK (daily_max_amount IS NULL OR daily_max_amount > 0);

UPDATE foods
SET
  min_amount_per_meal = CASE
    WHEN lower(name) LIKE '%ulei%' OR lower(name) LIKE '%unt%' THEN 5
    WHEN lower(name) LIKE '%nuci%' OR lower(name) LIKE '%migdale%' OR lower(name) LIKE '%arahide%' OR lower(name) LIKE '%seminte%' THEN 10
    WHEN lower(name) LIKE '%banana%' THEN 80
    WHEN lower(name) LIKE '%mar%' OR lower(name) LIKE '%para%' OR lower(name) LIKE '%portocala%' OR lower(name) LIKE '%afine%' OR lower(name) LIKE '%capsuni%' THEN 80
    WHEN lower(name) LIKE '%kefir%' OR lower(name) LIKE '%iaurt%' OR lower(name) LIKE '%lapte batut%' THEN 150
    WHEN lower(name) LIKE '%paine%' OR lower(name) LIKE '%lipie%' OR lower(name) LIKE '%tortilla%' THEN 40
    WHEN lower(name) LIKE '%cascaval%' OR lower(name) LIKE '%mozzarella%' OR lower(name) LIKE '%telemea%' OR lower(name) LIKE '%parmezan%' THEN 25
    WHEN lower(name) LIKE '%branza cottage%' OR lower(name) LIKE '%branza de vaci%' OR lower(name) LIKE '%skyr%' THEN 120
    WHEN lower(name) LIKE '%ou%' THEN 50
    WHEN lower(name) LIKE '%sunca%' OR lower(name) LIKE '%jambon%' THEN 50
    WHEN lower(name) LIKE '%pui%' OR lower(name) LIKE '%curcan%' OR lower(name) LIKE '%vita%' OR lower(name) LIKE '%peste%' OR lower(name) LIKE '%somon%' OR lower(name) LIKE '%ton%' OR lower(name) LIKE '%cod%' THEN 100
    WHEN lower(name) LIKE '%orez%' OR lower(name) LIKE '%paste%' OR lower(name) LIKE '%ovaz%' OR lower(name) LIKE '%cartof%' OR lower(name) LIKE '%quinoa%' THEN 40
    WHEN lower(category) IN ('vegetables', 'legume') THEN 30
    ELSE min_amount_per_meal
  END,
  max_amount_per_meal = CASE
    WHEN lower(name) LIKE '%ulei%' OR lower(name) LIKE '%unt%' THEN 15
    WHEN lower(name) LIKE '%nuci%' OR lower(name) LIKE '%migdale%' OR lower(name) LIKE '%arahide%' OR lower(name) LIKE '%seminte%' THEN 35
    WHEN lower(name) LIKE '%banana%' THEN 150
    WHEN lower(name) LIKE '%mar%' OR lower(name) LIKE '%para%' OR lower(name) LIKE '%portocala%' OR lower(name) LIKE '%afine%' OR lower(name) LIKE '%capsuni%' THEN 180
    WHEN lower(name) LIKE '%kefir%' OR lower(name) LIKE '%iaurt%' OR lower(name) LIKE '%lapte batut%' THEN 300
    WHEN lower(name) LIKE '%paine%' OR lower(name) LIKE '%lipie%' OR lower(name) LIKE '%tortilla%' THEN 120
    WHEN lower(name) LIKE '%cascaval%' OR lower(name) LIKE '%mozzarella%' OR lower(name) LIKE '%telemea%' OR lower(name) LIKE '%parmezan%' THEN 60
    WHEN lower(name) LIKE '%branza cottage%' OR lower(name) LIKE '%branza de vaci%' OR lower(name) LIKE '%skyr%' THEN 250
    WHEN lower(name) LIKE '%ou%' THEN 120
    WHEN lower(name) LIKE '%sunca%' OR lower(name) LIKE '%jambon%' THEN 120
    WHEN lower(name) LIKE '%pui%' OR lower(name) LIKE '%curcan%' OR lower(name) LIKE '%vita%' OR lower(name) LIKE '%peste%' OR lower(name) LIKE '%somon%' OR lower(name) LIKE '%ton%' OR lower(name) LIKE '%cod%' THEN 220
    WHEN lower(name) LIKE '%orez%' OR lower(name) LIKE '%paste%' OR lower(name) LIKE '%ovaz%' OR lower(name) LIKE '%cartof%' OR lower(name) LIKE '%quinoa%' THEN 120
    WHEN lower(category) IN ('vegetables', 'legume') THEN 250
    ELSE max_amount_per_meal
  END,
  daily_max_amount = CASE
    WHEN lower(name) LIKE '%ulei%' OR lower(name) LIKE '%unt%' THEN 25
    WHEN lower(name) LIKE '%nuci%' OR lower(name) LIKE '%migdale%' OR lower(name) LIKE '%arahide%' OR lower(name) LIKE '%seminte%' THEN 50
    WHEN lower(name) LIKE '%banana%' THEN 200
    WHEN lower(name) LIKE '%mar%' OR lower(name) LIKE '%para%' OR lower(name) LIKE '%portocala%' OR lower(name) LIKE '%afine%' OR lower(name) LIKE '%capsuni%' THEN 260
    WHEN lower(name) LIKE '%kefir%' OR lower(name) LIKE '%iaurt%' OR lower(name) LIKE '%lapte batut%' THEN 500
    WHEN lower(name) LIKE '%paine%' OR lower(name) LIKE '%lipie%' OR lower(name) LIKE '%tortilla%' THEN 180
    WHEN lower(name) LIKE '%cascaval%' OR lower(name) LIKE '%mozzarella%' OR lower(name) LIKE '%telemea%' OR lower(name) LIKE '%parmezan%' THEN 90
    WHEN lower(name) LIKE '%branza cottage%' OR lower(name) LIKE '%branza de vaci%' OR lower(name) LIKE '%skyr%' THEN 350
    WHEN lower(name) LIKE '%ou%' THEN 180
    WHEN lower(name) LIKE '%sunca%' OR lower(name) LIKE '%jambon%' THEN 180
    WHEN lower(name) LIKE '%pui%' OR lower(name) LIKE '%curcan%' OR lower(name) LIKE '%vita%' OR lower(name) LIKE '%peste%' OR lower(name) LIKE '%somon%' OR lower(name) LIKE '%ton%' OR lower(name) LIKE '%cod%' THEN 320
    WHEN lower(name) LIKE '%orez%' OR lower(name) LIKE '%paste%' OR lower(name) LIKE '%ovaz%' OR lower(name) LIKE '%cartof%' OR lower(name) LIKE '%quinoa%' THEN 180
    WHEN lower(category) IN ('vegetables', 'legume') THEN 500
    ELSE daily_max_amount
  END;

CREATE INDEX IF NOT EXISTS idx_foods_portion_limits
  ON foods(min_amount_per_meal, max_amount_per_meal, daily_max_amount);
