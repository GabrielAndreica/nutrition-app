/**
 * foodMatcher.js
 * Găsește alimentul potrivit în foodDatabase și îmbogățește planul generat de AI
 * cu valori nutriționale precise.
 */
import { FOOD_DB } from './foodDatabase.js';

/**
 * Normalizează un string pentru comparare:
 * - litere mici
 * - elimină diacritice
 * - elimină caractere speciale
 * - trimește spații
 */
function normalizeName(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // elimină diacritice
    .replace(/[^a-z0-9 ]/g, ' ')    // înlocuiește caractere speciale cu spațiu
    .replace(/\s+/g, ' ')           // comprimă spații multiple
    .trim();
}

/** Mapă pre-construită: normalized name/alias → entry în FOOD_DB (index) */
let _lookupMap = null;

function buildLookupMap() {
  if (_lookupMap) return _lookupMap;
  _lookupMap = new Map();
  for (let i = 0; i < FOOD_DB.length; i++) {
    const entry = FOOD_DB[i];
    // Adaugă numele principal
    const normName = normalizeName(entry.name);
    if (normName && !_lookupMap.has(normName)) {
      _lookupMap.set(normName, i);
    }
    // Adaugă toate alias-urile
    if (Array.isArray(entry.aliases)) {
      for (const alias of entry.aliases) {
        const normAlias = normalizeName(alias);
        if (normAlias && !_lookupMap.has(normAlias)) {
          _lookupMap.set(normAlias, i);
        }
      }
    }
  }
  return _lookupMap;
}

/**
 * Calculează scorul de suprapunere cuvinte între două stringuri normalizate.
 * Returnează numărul de cuvinte comune ponderat cu lungimea.
 */
function wordOverlapScore(a, b) {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  // Ponderat cu cuvintele din query (wordsA) — câte din ce căutăm am găsit
  return common / wordsA.size;
}

/**
 * Găsește cel mai bun match din FOOD_DB pentru un nume dat.
 * Strategii (în ordine):
 *  1. Potrivire exactă după normalizare (O(1) din map)
 *  2. Potrivire parțială: normalized query e conținut în alias sau invers
 *  3. Suprapunere de cuvinte — returnează cel mai bun scor dacă >= 0.5
 *
 * @param {string} foodName - Numele alimentului din planul AI
 * @returns {{ entry: object, score: number } | null}
 */
export function matchFood(foodName) {
  const map = buildLookupMap();
  const norm = normalizeName(foodName);
  if (!norm) return null;

  // 1. Potrivire exactă
  if (map.has(norm)) {
    return { entry: FOOD_DB[map.get(norm)], score: 1.0 };
  }

  // 2. Potrivire parțială în map (query conținut în cheie sau cheie conținută în query)
  let bestPartialIdx = -1;
  let bestPartialScore = 0;
  for (const [key, idx] of map.entries()) {
    if (key === norm) continue; // deja verificat
    const contained = key.includes(norm) || norm.includes(key);
    if (contained) {
      // Prefer cheia mai lungă (mai specifică)
      const score = Math.min(norm.length, key.length) / Math.max(norm.length, key.length);
      if (score > bestPartialScore) {
        bestPartialScore = score;
        bestPartialIdx = idx;
      }
    }
  }
  if (bestPartialScore >= 0.5) {
    return { entry: FOOD_DB[bestPartialIdx], score: bestPartialScore };
  }

  // 3. Suprapunere de cuvinte
  let bestWordIdx = -1;
  let bestWordScore = 0;
  for (const [key, idx] of map.entries()) {
    const score = wordOverlapScore(norm, key);
    if (score > bestWordScore) {
      bestWordScore = score;
      bestWordIdx = idx;
    }
  }
  if (bestWordScore >= 0.5) {
    return { entry: FOOD_DB[bestWordIdx], score: bestWordScore };
  }

  return null;
}

// Unități care indică bucăți (nu grame)
const PIECE_UNITS = new Set([
  'buc', 'bucati', 'bucăți', 'bucata', 'bucată',
  'piece', 'pieces', 'pcs', 'pc',
  'buc.', 'ou', 'oua', 'oua.'
]);

/**
 * Determină gramajul efectiv al unui aliment ținând cont de unitate.
 * Dacă unitatea e explicită ("buc", "ou", etc.) și DB-ul are gramsPerUnit, convertim.
 * În orice alt caz (grame, ml, lipsă unitate), respectăm valoarea trimisă de AI.
 */
function resolveAmountInGrams(food, entry) {
  const rawAmount = parseFloat(food.amount);
  if (!rawAmount || rawAmount <= 0) return 100;

  const unit = normalizeName(food.unit || '');

  // Conversie explicită: unit e "buc", "ou", "piece", etc.
  if (PIECE_UNITS.has(unit) && entry.gramsPerUnit) {
    return rawAmount * entry.gramsPerUnit;
  }

  // În orice alt caz (g, ml, kg, lipsă unitate) — respectăm valoarea AI
  return rawAmount;
}

/**
 * Îmbogățește un aliment individual cu valori din baza de date.
 * Dacă găsim un match, înlocuim calories/protein/carbs/fat bazat pe gramaj.
 *
 * @param {object} food - { name, amount, unit, calories, protein, carbs, fat }
 * @returns {object} - Alimentul cu valori actualizate (sau nemodificat dacă nu s-a găsit)
 */
function enrichFood(food) {
  if (!food || !food.name) return food;

  const result = matchFood(food.name);
  if (!result) return food; // Nicio potrivire — păstrăm valorile AI

  const { entry } = result;
  const amountInGrams = resolveAmountInGrams(food, entry);

  // Scala valorile la gramajul efectiv
  const factor = amountInGrams / 100;
  return {
    ...food,
    amount: Math.round(amountInGrams), // normalizăm la grame în output
    unit: 'g',
    calories: Math.round(entry.per100g.calories * factor),
    protein:  Math.round(entry.per100g.protein  * factor * 10) / 10,
    carbs:    Math.round(entry.per100g.carbs     * factor * 10) / 10,
    fat:      Math.round(entry.per100g.fat       * factor * 10) / 10,
    _dbMatched:  entry.name,                       // pentru debugging
    _per100g:    entry.per100g,                    // valori de referință pentru re-calcul
    _maxAmount:  entry.maxAmount ?? null,           // cap aplicat în adjustDayToTargets
  };
}

/**
 * Recalculează totalurile unei mese pe baza alimentelor îmbogățite.
 *
 * @param {object} meal - { foods: [...], calories, protein, carbs, fat }
 * @returns {object} - Masa cu totaluri recalculate
 */
function recalculateMealTotals(meal) {
  if (!meal || !Array.isArray(meal.foods)) return meal;
  const totals = meal.foods.reduce(
    (acc, f) => ({
      calories: acc.calories + (parseFloat(f.calories) || 0),
      protein:  acc.protein  + (parseFloat(f.protein)  || 0),
      carbs:    acc.carbs    + (parseFloat(f.carbs)    || 0),
      fat:      acc.fat      + (parseFloat(f.fat)      || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  return {
    ...meal,
    calories: Math.round(totals.calories),
    protein:  Math.round(totals.protein  * 10) / 10,
    carbs:    Math.round(totals.carbs    * 10) / 10,
    fat:      Math.round(totals.fat      * 10) / 10,
  };
}

/**
 * Îmbogățește un plan de zi întreg cu valori din baza de date.
 * Parcurge toate mesele → toate alimentele → înlocuiește valorile AI cu DB.
 * Recalculează totalurile mesei după îmbogățire.
 *
 * Structura așteptată a dayPlan:
 * {
 *   meals: [
 *     {
 *       name: "Micul dejun",
 *       foods: [{ name, amount, unit, calories, protein, carbs, fat }],
 *       calories, protein, carbs, fat
 *     }
 *   ],
 *   totals: { calories, protein, carbs, fat }
 * }
 *
 * @param {object} dayPlan
 * @returns {object} - Plan îmbogățit
 */
export function enrichDayWithDatabase(dayPlan) {
  if (!dayPlan || !Array.isArray(dayPlan.meals)) return dayPlan;

  const enrichedMeals = dayPlan.meals.map(meal => {
    if (!meal || !Array.isArray(meal.foods)) return meal;

    const enrichedFoods = meal.foods.map(food => enrichFood(food));
    const enrichedMeal = { ...meal, foods: enrichedFoods };
    return recalculateMealTotals(enrichedMeal);
  });

  // Recalculează totalurile zilei
  const dayTotals = enrichedMeals.reduce(
    (acc, meal) => ({
      calories: acc.calories + (parseFloat(meal.calories) || 0),
      protein:  acc.protein  + (parseFloat(meal.protein)  || 0),
      carbs:    acc.carbs    + (parseFloat(meal.carbs)    || 0),
      fat:      acc.fat      + (parseFloat(meal.fat)      || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    ...dayPlan,
    meals: enrichedMeals,
    totals: {
      calories: Math.round(dayTotals.calories),
      protein:  Math.round(dayTotals.protein  * 10) / 10,
      carbs:    Math.round(dayTotals.carbs    * 10) / 10,
      fat:      Math.round(dayTotals.fat      * 10) / 10,
    },
  };
}
