import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── Constante pentru generarea bazată pe rețete ───────────────────────────────

const MEAL_TYPE_MAP = {
  'Mic Dejun': 'breakfast',
  'Prânz':     'lunch',
  'Cină':      'dinner',
  'Gustare':   'snack',
  'Gustare 1': 'snack',
  'Gustare 2': 'snack',
};

// Surse de proteine rotative pe zile (mapate la valorile din coloana protein_source din recipes)
// Tipul de pește pentru toată săptămâna — ales aleatoriu, UN SINGUR tip
const FISH_TYPES_POOL = ['Somon', 'Ton în apă', 'Macrou', 'Sardine în suc propriu'];
const weeklyFish = FISH_TYPES_POOL[Math.floor(Math.random() * FISH_TYPES_POOL.length)];

const PROTEIN_SOURCE_BY_DAY = [
  ['pui', 'curcan'],           // Ziua 1
  ['pește'],                   // Ziua 2 — pește (ziua 1 din 2)
  ['ouă', 'lactate'],          // Ziua 3
  ['carne de vită', 'porc'],   // Ziua 4
  ['leguminoase'],             // Ziua 5
  ['pui'],                     // Ziua 6 — pui, nu pește (zile neconsecutive)
  ['pește'],                   // Ziua 7 — pește (ziua 2 din 2, nu consecutiv cu ziua 2)
];
// NOTĂ: zilele de pește sunt 2 și 7 — neconsecutive, max 2/săptămână

// Mapare surse proteice (română) → coloana protein_source din tabela recipes
const PROTEIN_SOURCE_TO_DB_KEY = {
  'pui':           'chicken',
  'curcan':        'turkey',
  'pește':         'fish',
  'carne de vită': 'beef',
  'porc':          'pork',
  'ouă':           'eggs',
  'lactate':       'dairy',
  'leguminoase':   'legumes',
};

// Gramaj fix pentru legume și fructe (nu participă la redistribuire calorică)
const FIXED_VEG_FRUIT_GRAMS = 80;

// Gramaj maxim per categorie — proporțional cu greutatea clientului
// Referință: persoană de 70 kg / 175 cm. Scalat liniar cu greutatea.
const BASE_MAX_GRAMS_BY_CATEGORY = {
  protein:    250,   // carne/pește la 70kg
  grains:     100,   // orez/paste CRUD la o masă — 100g crud = ~365 kcal, realist și nu domină farfuria
  dairy:      300,
  fats:        20,
  nuts:        60,
  legumes:    250,
  fruits:     200,
  vegetables: 150,   // legumele sunt garnitură, nu sursă de calorii — max 150g per masă
  default:    250,
};

function getMaxGramsByCategory(weightKg = 70, heightCm = 175) {
  const factor = Math.max(0.5, Math.min(2.0, weightKg / 70));
  const result = {};
  for (const [k, v] of Object.entries(BASE_MAX_GRAMS_BY_CATEGORY)) {
    result[k] = Math.round(v * factor / 5) * 5;
  }
  // Carbohidrații și legumele NU se scalează după greutate
  // — legumele sunt garnitură (150g e o porție normală indiferent de client)
  result.grains     = BASE_MAX_GRAMS_BY_CATEGORY.grains;     // 100g crud fix
  result.vegetables = BASE_MAX_GRAMS_BY_CATEGORY.vegetables; // 150g fix
  return result;
}

// Funcție helper pentru a obține date nutriționale din Supabase
async function getNutritionalData(foodName) {
  const supabase = getSupabase();
  
  // Normalizează (lowercase, fără diacritice, fără caractere speciale)
  const normalize = (str) => str.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/[()%]/g, '').trim();

  // Elimină sufixele de preparare care nu apar în DB
  const stripPreparation = (str) => str
    .replace(/\s*\(crud[aă]?\)/gi, '')
    .replace(/\s*\(fiert[aă]?\)/gi, '')
    .replace(/\s*\(fiartă\)/gi, '')
    .replace(/\s*\(la (tigaie|cuptor|grătar|gratar|abur)\)/gi, '')
    .replace(/\s*\(copt[aă]?\)/gi, '')
    .replace(/\s*\(călită\)/gi, '')
    .replace(/\s*\(calita\)/gi, '')
    .replace(/\s*\(prăjit[aă]?\)/gi, '')
    .replace(/\s*\(conserv[aă]\)/gi, '')
    .replace(/\s*\(afumat[aă]?\)/gi, '')
    .replace(/\s*\(congelat[aă]?\)/gi, '')
    .replace(/\s*\(proaspăt[aă]?\)/gi, '')
    .replace(/\s*\(proaspat[aă]?\)/gi, '')
    .replace(/\s*\(mix\)/gi, '')
    .replace(/\s*\(ras\)/gi, '')
    .replace(/\s*\(natural[aă]?\)/gi, '')
    .replace(/\s*\(ferm\)/gi, '')
    .replace(/\s*\(\d+%\)/gi, '')
    .replace(/\s*\/.*$/, '') // elimină "fiartă/conservă"
    .trim();

  const searchTerm = normalize(stripPreparation(foodName));
  
  // Mapări pentru variații comune
  const mappings = {
    'oua': 'ou intreg',
    'ou': 'ou intreg',
    'lapte': 'lapte 1.5',
    'lapte 1.5%': 'lapte 1.5',
    'lapte integral': 'lapte 1.5',
    'lapte de vaca': 'lapte 1.5',
    'lapte de migdale': 'lapte 1.5',
    'lapte vegetal': 'lapte 1.5',
    'iaurt grecesc (2%)': 'iaurt grecesc',
    'iaurt grecesc 2%': 'iaurt grecesc',
    'iaurt natural': 'iaurt grecesc',
    'orez fiert': 'orez alb',
    'orez alb fiert': 'orez alb',
    'ton conserva': 'ton conserva',
    'ton la conserva': 'ton conserva',
    'morcovi': 'morcov',
    'rosii': 'rosii',
    'roșii cherry': 'rosii',
    'paste fierte': 'paste',
    'branza cottage': 'branza de vaci',
    'cottage': 'branza de vaci',
    'fructe de padure congelate': 'fructe de padure',
    'afine congelate': 'fructe de padure',
    'paine de secara': 'paine integrala',
    'pâine de secară': 'paine integrala',
    'paine integrala de secara': 'paine integrala',
    'paine alba': 'paine alba',
    'baguette': 'paine alba',
    'fulgi de ovaz': 'fulgi de ovaz',
    'ovaz': 'fulgi de ovaz',
    'piept de pui': 'piept de pui',
    'piept de curcan': 'piept de curcan',
    'muschi de porc': 'muschi de porc',
    'file de cod': 'cod',
    'file de somon': 'somon',
    'somon afumat': 'somon',
    'branza feta': 'feta',
    'ardei rosu': 'ardei rosu',
    'ardei gras': 'ardei rosu',
    'rosii cherry': 'rosii',
    'rosii': 'rosii',
    'spanac': 'spanac',
    'morcov': 'morcov',
    'castraveti': 'castraveti',
    'broccoli': 'broccoli',
    'cartofi': 'cartofi',
    'cartof dulce': 'cartof dulce',
    'paste integrale': 'paste integrale',
    'orez brun': 'orez brun',
    'orez alb': 'orez alb',
    'orez basmati': 'orez alb',
    'quinoa': 'quinoa',
    'bulgur': 'bulgur',
    'couscous': 'couscous',
    'malai': 'malai',
    'hrisca': 'hrisca',
    'linte rosie': 'linte',
    'linte verde': 'linte',
    'linte': 'linte',
    'fasole rosie': 'fasole',
    'fasole verde': 'fasole verde',
    'naut': 'naut',
    'mazare': 'mazare',
    'ceapa verde': 'ceapa verde',
    'ceapa': 'ceapa',
    'usturoi': 'usturoi',
    'ciuperci': 'ciuperci',
    'vinete': 'vinete',
    'dovlecel': 'dovlecel',
    'conopida': 'conopida',
    'seminte de chia': 'seminte chia',
    'seminte de in': 'seminte in',
    'seminte de floarea soarelui': 'seminte floarea soarelui',
    'fructe de padure': 'fructe de padure',
    'lapte 1.5': 'lapte 1.5',
    'carne de vita': 'vita',
    'carne tocata de vita': 'carne tocata',
    'carne tocata': 'carne tocata',
    'sardine': 'sardine',
    'branza cheddar': 'cheddar',
    'branza ricotta': 'ricotta',
    'tahini': 'tahini',
    'sparanghel': 'sparanghel',
    'conopida': 'conopida',
    'salata verde': 'salata verde',
    'hrișcă': 'hrisca',
    'hrișca': 'hrisca',
  };
  
  const finalSearch = mappings[searchTerm] || searchTerm;
  
  // Căutare exactă mai întâi (ocolim problemele de normalizări cu paranteze/diacritice)
  let data = null;
  let error = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await supabase
      .from('foods')
      .select('name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, max_amount_per_meal, grams_per_unit')
      .eq('name', foodName)
      .limit(1);
    data  = result.data;
    error = result.error;
    if (!error) break;
    const isNetwork = error?.message?.includes('ECONNRESET') || error?.message?.includes('fetch failed') || error?.message?.includes('ETIMEDOUT');
    if (!isNetwork || attempt === 3) break;
    await new Promise(r => setTimeout(r, attempt * 300));
  }
  if (!error && data && data.length > 0) {
    const food = data[0];
    console.log(`[getNutritionalData] Găsit: ${food.name} pentru query "${foodName}"`);
    return { name: food.name, calories_per_100g: food.calories_per_100g, protein_per_100g: food.protein_per_100g, carbs_per_100g: food.carbs_per_100g, fat_per_100g: food.fat_per_100g, max_amount_per_meal: food.max_amount_per_meal || null, grams_per_unit: food.grams_per_unit || null };
  }
  
  // Fuzzy search cu ilike după normalizare
  data = null; error = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await supabase
      .from('foods')
      .select('name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, max_amount_per_meal, grams_per_unit')
      .ilike('name', `%${finalSearch}%`)
      .limit(5);
    data  = result.data;
    error = result.error;
    if (!error) break;
    const isNetwork = error?.message?.includes('ECONNRESET') || error?.message?.includes('fetch failed') || error?.message?.includes('ETIMEDOUT');
    if (!isNetwork || attempt === 3) break;
    console.warn(`[getNutritionalData] Rețea instabilă pentru "${foodName}", retrì ${attempt}/3...`);
    await new Promise(r => setTimeout(r, attempt * 300));
  }
  
  if (error) {
    console.error(`[getNutritionalData] Query error for "${foodName}":`, error);
    return null;
  }
  
  if (!data || data.length === 0) {
    console.log(`[getNutritionalData] Aliment negăsit: ${foodName}`);
    return null;
  }
  
  // Returnează primul rezultat
  const food = data[0];
  console.log(`[getNutritionalData] Găsit: ${food.name} pentru query "${foodName}"`);
  
  return {
    name: food.name,
    calories_per_100g: food.calories_per_100g,
    protein_per_100g: food.protein_per_100g,
    carbs_per_100g: food.carbs_per_100g,
    fat_per_100g: food.fat_per_100g,
    max_amount_per_meal: food.max_amount_per_meal || null,
    grams_per_unit: food.grams_per_unit || null,
  };
}

// Valori nutriționale estimative pe categorii — folosite când alimentul nu e găsit în DB
// Format: { keywords[], cal, p, c, f, maxAmt }
const NUTRITION_FALLBACKS = [
  // Pâine & cereale
  { kw: ['paine', 'bread', 'toast', 'bagheta', 'covrigi'],         cal: 255, p:  9, c: 48, f:  3, max: 150 },
  { kw: ['fulgi de ovaz', 'ovaz', 'oatmeal', 'porridge'],          cal: 389, p: 17, c: 66, f:  7, max: 120 },
  { kw: ['orez', 'rice'],                                           cal: 365, p:  7, c: 80, f:  1, max: 120 },
  { kw: ['paste', 'penne', 'spaghete', 'tagliatelle', 'fusilli'],  cal: 358, p: 12, c: 72, f:  2, max: 120 },
  { kw: ['quinoa'],                                                 cal: 368, p: 14, c: 64, f:  6, max: 120 },
  { kw: ['bulgur', 'couscous', 'hrisca', 'malai', 'mamaliga'],     cal: 340, p: 12, c: 70, f:  2, max: 120 },
  { kw: ['cartofi', 'potato'],                                      cal:  77, p:  2, c: 17, f:  0, max: 300 },
  { kw: ['cartofi dulci', 'sweet potato'],                         cal:  86, p:  2, c: 20, f:  0, max: 300 },
  // Carne & pește
  { kw: ['piept de pui', 'pui', 'chicken'],                        cal: 120, p: 22, c:  0, f:  3, max: 200 },
  { kw: ['curcan', 'turkey'],                                      cal: 135, p: 25, c:  0, f:  3, max: 200 },
  { kw: ['vita', 'beef', 'vitel'],                                  cal: 200, p: 26, c:  0, f: 10, max: 180 },
  { kw: ['porc', 'pork', 'muschi de porc'],                        cal: 190, p: 23, c:  0, f: 10, max: 180 },
  { kw: ['somon', 'salmon'],                                       cal: 208, p: 20, c:  0, f: 13, max: 200 },
  { kw: ['ton', 'tuna'],                                           cal:  86, p: 20, c:  0, f:  1, max: 200 },
  { kw: ['cod', 'macrou', 'sardine', 'peste', 'fish'],             cal: 150, p: 20, c:  0, f:  7, max: 200 },
  { kw: ['creveti', 'shrimp'],                                     cal:  99, p: 21, c:  0, f:  1, max: 200 },
  // Ouă & lactate
  { kw: ['ou intreg', 'oua', 'ou'],                                cal: 143, p: 13, c:  1, f: 10, max: 120 },
  { kw: ['albus'],                                                  cal:  52, p: 11, c:  1, f:  0, max:  80 },
  { kw: ['lapte'],                                                  cal:  61, p:  3, c:  5, f:  3, max: 300 },
  { kw: ['iaurt grecesc', 'iaurt'],                                cal:  97, p: 10, c:  4, f:  5, max: 200 },
  { kw: ['branza feta', 'feta'],                                   cal: 264, p: 14, c:  4, f: 21, max:  80 },
  { kw: ['branza de vaci', 'cottage', 'ricotta'],                  cal:  84, p: 11, c:  3, f:  3, max: 200 },
  { kw: ['parmezan', 'cheddar', 'branza'],                         cal: 402, p: 25, c:  2, f: 33, max:  40 },
  { kw: ['unt '],                                                   cal: 717, p:  1, c:  0, f: 81, max:  20 },
  // Leguminoase & tofu
  { kw: ['naut', 'chickpea'],                                      cal: 164, p:  9, c: 27, f:  3, max: 200 },
  { kw: ['linte', 'lentil'],                                       cal: 116, p:  9, c: 20, f:  0, max: 200 },
  { kw: ['fasole', 'bean'],                                        cal: 127, p:  9, c: 23, f:  1, max: 200 },
  { kw: ['tofu'],                                                   cal:  76, p:  8, c:  2, f:  5, max: 200 },
  { kw: ['tempeh'],                                                 cal: 193, p: 19, c:  9, f: 11, max: 200 },
  { kw: ['edamame'],                                               cal: 121, p: 11, c:  9, f:  5, max: 150 },
  // Grăsimi & nuci
  { kw: ['ulei de masline', 'ulei de cocos', 'ulei'],              cal: 884, p:  0, c:  0, f:100, max:  20 },
  { kw: ['avocado'],                                               cal: 160, p:  2, c:  9, f: 15, max: 200 },
  { kw: ['unt de arahide', 'peanut butter'],                       cal: 588, p: 25, c: 20, f: 50, max:  40 },
  { kw: ['nuci', 'migdale', 'caju', 'alune'],                      cal: 600, p: 18, c: 18, f: 54, max:  40 },
  { kw: ['seminte de susan', 'tahini', 'seminte'],                 cal: 573, p: 18, c: 23, f: 50, max:  30 },
  { kw: ['hummus'],                                                cal: 166, p:  8, c: 14, f: 10, max: 100 },
  // Fructe
  { kw: ['banana'],                                                cal:  89, p:  1, c: 23, f:  0, max: 150 },
  { kw: ['mar', 'apple'],                                          cal:  52, p:  0, c: 14, f:  0, max: 200 },
  { kw: ['capsuni', 'afine', 'zmeura', 'fructe de padure', 'kiwi', 'fructe'], cal: 50, p: 1, c: 12, f: 0, max: 200 },
  { kw: ['miere', 'sirop'],                                        cal: 304, p:  0, c: 82, f:  0, max:  30 },
  // Legume
  { kw: ['broccoli', 'conopida', 'spanac', 'fasole verde', 'sparanghel'], cal: 35, p: 3, c: 6, f: 0, max: 300 },
  { kw: ['ardei', 'castraveti', 'rosii', 'dovlecel', 'morcov', 'vinete'], cal: 30, p: 2, c: 6, f: 0, max: 300 },
  { kw: ['ceapa', 'usturoi'],                                      cal:  40, p:  2, c:  9, f:  0, max: 100 },
  { kw: ['salata verde', 'rucola', 'salata'],                      cal:  15, p:  1, c:  2, f:  0, max: 150 },
  // Proteine praf
  { kw: ['pudra de proteine', 'proteina', 'whey'],                 cal: 380, p: 80, c: 10, f:  5, max:  50 },
  // Altele
  { kw: ['sos de soia'],                                           cal:  53, p:  8, c:  5, f:  1, max:  30 },
  { kw: ['mustar'],                                                cal:  66, p:  4, c:  6, f:  4, max:  30 },
  { kw: ['lamaie', 'otet'],                                        cal:  29, p:  1, c:  9, f:  0, max:  50 },
];

/**
 * Returnează valori nutriționale fallback bazate pe numele alimentului.
 */
function getNutritionFallback(foodName) {
  const n = (foodName || '').toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't').replace(/[()%]/g, '').trim();
  for (const fb of NUTRITION_FALLBACKS) {
    if (fb.kw.some(k => n.includes(k))) {
      return { cal: fb.cal, p: fb.p, c: fb.c, f: fb.f, max: fb.max };
    }
  }
  // fallback generic
  return { cal: 100, p: 5, c: 15, f: 3, max: 200 };
}

/**
 * Preia lista de alimente din tabela foods pentru a le trimite la GPT.
 * Returnează un string compact cu toate alimentele disponibile.
 */
// Normalizare simplă pentru potrivire fuzzy (aceleași reguli ca în getNutritionalData)
function normalizeForMatch(str) {
  return str.toLowerCase()
    .replace(/\s*\(crud[aă]?\)/gi, '').replace(/\s*\(fiert[aă]?\)/gi, '')
    .replace(/\s*\(fiartă\)/gi, '').replace(/\s*\(la (tigaie|cuptor|grătar|gratar|abur)\)/gi, '')
    .replace(/\s*\(copt[aă]?\)/gi, '').replace(/\s*\(prăjit[aă]?\)/gi, '')
    .replace(/\s*\(conserv[aă]\)/gi, '').replace(/\s*\(afumat[aă]?\)/gi, '')
    .replace(/\s*\(congelat[aă]?\)/gi, '').replace(/\s*\(proaspăt[aă]?\)/gi, '')
    .replace(/\s*\(proaspat[aă]?\)/gi, '').replace(/\s*\(mix\)/gi, '')
    .replace(/\s*\(ras\)/gi, '').replace(/\s*\(natural[aă]?\)/gi, '')
    .replace(/\s*\(ferm\)/gi, '').replace(/\s*\(\d+%\)/gi, '')
    .replace(/\s*\/.*$/, '')
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/[()%]/g, '').trim();
}

async function getAvailableFoodsList() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('foods')
    .select('name, category')
    .order('category');
  if (error || !data) return { listString: '', normMap: {} };
  // Hartă: numeNormalizat → numeExactDB (pentru a corecta automat ce întoarce GPT)
  const normMap = {};
  for (const f of data) {
    normMap[normalizeForMatch(f.name)] = f.name;
  }
  // Una per linie — GPT urmărește mai bine decât șir virgulă-separat
  const listString = data.map(f => `- ${f.name}`).join('\n');

  // Lista restricționată pentru gustări — DOAR alimente potrivite ca snack
  // Fructe + lactate ușoare + cereale simple (fără nuci/semințe — grăsimile merg la mese principale)
  const SNACK_ALLOWED_DAIRY = ['iaurt grecesc', 'branza de vaci', 'lapte'];
  const SNACK_ALLOWED_GRAINS_KW = ['fulgi', 'paine', 'rondele', 'covrigei', 'biscuiti', 'crackers', 'orez puf'];
  const snackFoods = data.filter(f => {
    const nm = f.name.toLowerCase();
    // Fructe — mereu ok la gustare
    if (f.category === 'fruits') return true;
    // Dairy — doar iaurt/brânză de vaci/lapte (nu brânzeturi pentru gătit)
    if (f.category === 'dairy') {
      return SNACK_ALLOWED_DAIRY.some(kw => nm.includes(kw));
    }
    // Cereale simple: rondele de orez, fulgi de ovăz, pâine, covrigei
    if (f.category === 'grains') {
      return SNACK_ALLOWED_GRAINS_KW.some(kw => nm.includes(kw));
    }
    // Nuci/semințe — EXCLUSE din gustare (merg la mese principale)
    return false;
  });
  const snackListString = snackFoods.map(f => `- ${f.name}`).join('\n');

  return { listString, normMap, snackListString };
}

/**
 * Apelează GPT pentru a genera o masă.
 * GPT propune rețeta completă: alimente, gramaje și macros estimate.
 * Codul local doar scalează proporțional totalurile pentru a atinge targetele.
 */
async function generateMealWithGPT({
  mealType, mealLabel, mealTargets, dietType,
  proteinSources, usedMealNames, usedIngredients, usedProteinsToday,
  clientPreferences, allergies, dayIndex, usedSnackBases, forcedProtein,
}) {
  const targetCalories = mealTargets.calories;
  const dietLabel = {
    omnivore: 'omnivoră (include carne, pește, ouă, lactate)',
    vegetarian: 'vegetariană (fără carne și pește, cu ouă și lactate)',
    vegan: 'vegană (100% vegetală, FĂRĂ ouă, FĂRĂ lactate, FĂRĂ miere)',
  }[dietType] || 'omnivoră';

  // Reguli stricte diet
  const dietStrictRules = dietType === 'vegan'
    ? `INTERZIS ABSOLUT (dietă vegană): carne de orice fel, pește, fructe de mare, ouă, lapte, iaurt, brânză, unt, miere, orice produs animal. Folosește EXCLUSIV: legume, fructe, cereale, leguminoase (linte, năut, fasole), tofu, nuci, semințe, uleiuri vegetale.`
    : dietType === 'vegetarian'
    ? `INTERZIS (dietă vegetariană): carne de orice fel (pui, vită, porc, curcan), pește, fructe de mare. Permis: ouă, lactate (iaurt, brânză, lapte), legume, fructe, cereale, leguminoase.`
    : '';

  const proteinHint = proteinSources
    ? `Sursa principală de proteine pentru această zi: ${proteinSources.join(' sau ')}.`
    : '';

  // La retry cu proteină forțată — hint ultra-explicit
  const forcedProteinHint = forcedProtein
    ? `🛑 OBLIGATORIU: Această masă TREBUIE să conțină "${forcedProtein}" ca sursă de proteină. Fără excepție, fără alte tipuri de carne sau pește.`
    : '';

  const usedHint = usedMealNames.size > 0
    ? `Mese deja folosite în acest plan (NU repeta): ${[...usedMealNames].join(', ')}.`
    : '';

  const usedIngredientsHint = usedIngredients && usedIngredients.size > 0
    ? `Ingrediente deja folosite des în acest plan (EVITĂ să le repeți ca ingredient principal): ${[...usedIngredients].join(', ')}.`
    : '';

  const usedProteinsTodayHint = usedProteinsToday && usedProteinsToday.size > 0
    ? `Proteine deja folosite AZI (NU le mai folosi în această masă): ${[...usedProteinsToday].join(', ')}.`
    : '';

  const allergyHint = allergies && allergies.length > 0
    ? `ALERGII/INTOLERANȚE — INTERZIS ABSOLUT: ${allergies.join(', ')}. Nu folosi aceste alimente sub nicio formă, nici ca ingredient secundar.`
    : '';

  const prefHint = clientPreferences
    ? `Preferințe client: ${clientPreferences}.`
    : '';

  const dayHint = dayIndex !== undefined
    ? `Aceasta este ziua ${dayIndex + 1} din 7 — combina alimente DIFERITE față de zilele anterioare.`
    : '';

  // Snack variety hint — evită baza deja folosită
  const snackBasesUsed = usedSnackBases && usedSnackBases.size > 0
    ? `Baze pentru gustare deja folosite AZI (NU repeta): ${[...usedSnackBases].join(', ')}. Alege o bază COMPLET DIFERITă.`
    : '';

  const mealTypeRules = {
    breakfast: `TIP MASĂ — Mic dejun: alege EXCLUSIV combinații simple tip mic dejun. Exemple BUNE: omletă cu legume, ouă fierte cu pâine și roșii, fulgi de ovăz cu lapte și fructe, toast cu unt de arahide și banană, iaurt cu fructe, sandwich cu ou și legume. Exemple INTERZISE: clătite, pancakes, waffle, croissant, preparate elaborate. NU combina ouă cu iaurt în aceeași masă. NU orez, NU carne la grătar, NU cartofi. NICIODATĂ pește la mic dejun.`,
    snack:     `TIP MASĂ — Gustare: EXACT 2 ingrediente din lista de mai jos — nimic altceva. Fără preparare. Combinații CORECTE (alege una similară):
- Iaurt grecesc (2%) + Banană
- Iaurt grecesc (2%) + Afine
- Iaurt grecesc (2%) + Căpșuni
- Iaurt grecesc (2%) + Mere
- Branza de vaci + Banană
- Branza de vaci + Căpșuni
- Rondele de orez + Banană
- Rondele de orez + Mere
- Fulgi de ovăz + Lapte
- Pâine integrală + Banană
- Portocală + Mere
- Banană + Afine
NU nuci, NU caju, NU migdale, NU semințe, NU arahide la gustare — grăsimile se pun la mesele principale. ${snackBasesUsed} NU carne, NU pește, NU legume, NU brânzeturi pentru gătit (mozzarella, feta, parmezan).`,
    lunch:     `TIP MASĂ — Prânz: masă consistentă și simplă. Exemple BUNE: pui cu orez și legume, carne cu cartofi și salată, pește la cuptor cu legume, ouă cu cartofi. Gătit la tigaie sau cuptor, max 20 minute. IMPORTANT: folosește sursa de proteină specificată pentru această zi.`,
    dinner:    `TIP MASĂ — Cină: masă ușoară și simplă. Exemple BUNE: omletă cu legume, brânză cu legume fierte, salată cu pui, pui la cuptor cu salată. Fără orez mult, fără prăjeli, max 20 minute.`,
  }[mealType] || '';

  // Regulă globală: pește DOAR la prânz/cină
  const fishDayOnlyHint = (mealType === 'lunch' || mealType === 'dinner') && proteinSources && proteinSources.includes('pește')
    ? `Ziua de pește: folosește EXCLUSIV ${weeklyFish} (nu alte specii). Peștele apare O SINGURĂ DATĂ pe zi (la această masă).`
    : (mealType === 'breakfast' || mealType === 'snack')
    ? `NU folosi pește de niciun fel la ${mealType === 'breakfast' ? 'mic dejun' : 'gustare'}.`
    : '';

  const prompt = `Ești nutriționist expert. Creează o masă reală de tip "${mealLabel}" pentru o dietă ${dietLabel}.

Target nutritiv pentru această masă:
- Calorii: ~${mealTargets.calories} kcal
- Proteine: ~${mealTargets.protein}g
- Carbohidrați: ~${mealTargets.carbs}g
- Grăsimi: ~${mealTargets.fat}g
${dietStrictRules ? `
⚠️ RESTRICȚII OBLIGATORII:
${dietStrictRules}` : ''}${allergyHint ? `
⚠️ ${allergyHint}` : ''}
${mealTypeRules}
${forcedProteinHint}
${proteinHint}
${fishDayOnlyHint}
${prefHint}
${usedHint}
${usedIngredientsHint}
${usedProteinsTodayHint}
${dayHint}

Răspunde STRICT în acest format JSON (fără text suplimentar):
{
  "name": "Nume masă scurt în română (2-4 cuvinte, ex: 'Pui cu orez', 'Omletă cu legume', 'Iaurt cu fructe')",
  "foods": [
    {"name": "Piept de pui", "amount": 150, "unit": "g", "calories": 165, "protein": 31, "carbs": 0, "fat": 4},
    {"name": "Orez alb (fiert)", "amount": 200, "unit": "g", "calories": 260, "protein": 5, "carbs": 58, "fat": 0}
  ],
  "preparation": "Instrucțiuni scurte de preparare în română (2-4 pași numerotați)"
}

Reguli OBLIGATORII:
- Gramajele TREBUIE să fie realiste și să se apropie de targetul de calorii de mai sus
- Macros estimate per ingredient cât mai precise (folosește valori standard din nutriție)
- Respectă STRICT tipul mesei și restricțiile de dietă de mai sus
- 2-5 alimente (gustare: exact 2)
- O SINGURĂ sursă de proteină animală per masă (nu pui + șuncă, nu somon + ton)
- CRITIC: Dacă sursa de proteină a zilei este specificată mai sus, folosește ACEA proteină la prânz/cină
- Numele mesei trebuie să reflecte proteina reală: dacă e pui → 'Pui cu...', dacă e vită → 'Vită cu...' etc.
- Pește NICIODATĂ la mic dejun sau gustare
- Gustare: bază DIFERITĂ față de celelalte gustări ale zilei
- INTERZIS: clătite, pancakes, waffle, preparate ce necesită > 30 minute
- Mese SIMPLE: tigaie, cuptor, fiert — max 20 minute, 2-4 pași preparare
- Varietate față de mesele și proteinele deja folosite azi
- Combinații LOGICE și normale pentru tipul mesei
- NU folosi mai multe tipuri de pește în același plan
- Respectă ABSOLUT restricțiile de dietă și alergii — nicio excepție
- "amount" este ÎNTOTDEAUNA în grame (chiar și lichide — ex: lapte 200g)`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content;
  const parsed = JSON.parse(raw);

  if (!parsed.name || !Array.isArray(parsed.foods) || parsed.foods.length === 0) {
    throw new Error('Răspuns GPT invalid: lipsesc name sau foods');
  }

  // Acceptă atât formatul nou {name,amount,calories,...} cât și formatul vechi ["Aliment"]
  const foods = parsed.foods.map(f => {
    if (typeof f === 'string') {
      // Format vechi (fallback) — estimăm macros din NUTRITION_FALLBACKS
      const fb = getNutritionFallback(f);
      const amt = 100;
      return { name: f, amount: amt, unit: 'g',
               calories: fb.cal, protein: fb.p, carbs: fb.c, fat: fb.f };
    }
    return {
      name:     f.name     || 'Ingredient',
      amount:   Number(f.amount)   || 100,
      unit:     f.unit     || 'g',
      calories: Number(f.calories) || 0,
      protein:  Number(f.protein)  || 0,
      carbs:    Number(f.carbs)    || 0,
      fat:      Number(f.fat)      || 0,
    };
  });

  return {
    name: parsed.name,
    foods,
    preparation: parsed.preparation || '',
  };
}

// ─── CLASIFICARE MACRO-ROL (din datele alimentului, fără DB) ────────────────
// Folosit în fineTuneDayToTargets pentru a identifica alimente proteice vs carb
function classifyFoodRole(nd) {
  const c  = nd.calories_per_100g || 1;
  const pPct = (nd.protein_per_100g * 4) / c;
  const cPct = (nd.carbs_per_100g   * 4) / c;
  const fPct = (nd.fat_per_100g     * 9) / c;
  if (nd.fat_per_100g >= 40)                       return 'fat_dense'; // ulei, unt
  if (nd.fat_per_100g >= 15 && fPct >= 0.45)        return 'fat_dense'; // nuci, unt arahide, tahini
  if (c < 60 && nd.protein_per_100g < 8)            return 'vegetable'; // broccoli, spanac, ardei, roșii
  if (nd.protein_per_100g >= 15 && pPct >= 0.35)    return 'protein';   // carne, pește, ouă, leguminoase
  if (nd.carbs_per_100g   >= 30 && cPct >= 0.50)    return 'carb';      // orez, paste, pâine, fructe, cartofi
  return 'mixed'; // iaurt, brânză de vaci, lapte — au deopotrivă prot+carb/fat
}

/**
 * Preia masa generată de GPT (cu gramaje și macros estimate) și construiește
 * obiectul meal. Nu face niciun lookup în DB — gramajele și macros vin direct de la GPT.
 * Aplică doar limite de siguranță per ingredient (ulei max 20g, nuci max 40g etc.).
 * fineTuneDayToTargets va ajusta totalurile ulterior.
 */
function resolveGPTMealToFoods(gptMeal, mealCal, mealType = 'lunch', _normMap = null, _clientProfile = null) {
  if (!Array.isArray(gptMeal.foods) || gptMeal.foods.length === 0) return null;

  const foods = gptMeal.foods.map(f => {
    if (!f.name) return null;
    // Limite de siguranță folosind NUTRITION_FALLBACKS (fără DB)
    const fb  = getNutritionFallback(f.name);
    const rawAmt = Number(f.amount) || 100;
    const amount = Math.min(Math.max(Math.round(rawAmt), 5), fb.max);
    const scale  = amount / Math.max(rawAmt, 1);
    return {
      name:     f.name,
      amount,
      unit:     'g',
      calories: Math.round((Number(f.calories) || fb.cal * rawAmt / 100) * scale),
      protein:  Math.round((Number(f.protein)  || fb.p   * rawAmt / 100) * scale),
      carbs:    Math.round((Number(f.carbs)     || fb.c   * rawAmt / 100) * scale),
      fat:      Math.round((Number(f.fat)       || fb.f   * rawAmt / 100) * scale),
    };
  }).filter(Boolean);

  if (foods.length === 0) return null;

  // ── Deduplicare: mergeează alimente cu același nume (normalizat) în același fel ──
  const deduped = [];
  for (const f of foods) {
    const key = normalizeForMatch(f.name);
    const existing = deduped.find(x => normalizeForMatch(x.name) === key);
    if (existing) {
      existing.amount   += f.amount;
      existing.calories += f.calories;
      existing.protein  += f.protein;
      existing.carbs    += f.carbs;
      existing.fat      += f.fat;
    } else {
      deduped.push({ ...f });
    }
  }
  const foods2 = deduped;

  const mealTotals = foods2.reduce(
    (acc, f) => ({ calories: acc.calories + f.calories, protein: acc.protein + f.protein,
                   carbs: acc.carbs + f.carbs, fat: acc.fat + f.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  console.log(`[resolveGPTMeal] "${gptMeal.name}" → ${mealTotals.calories}/${mealCal} kcal (GPT estimate — va fi reglat de fineTune)`);

  return {
    meal: { name: gptMeal.name, mealType, foods: foods2, preparation: gptMeal.preparation, mealTotals },
    foodLimits: {},
  };
}

// ─── ÎNCĂRCARE DATE DIN SUPABASE ─────────────────────────────────────────────

/**
 * Încarcă toate alimentele din tabela foods cu datele nutriționale complete.
 */
async function loadFoodsFromSupabase() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('foods')
    .select('name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, max_amount_per_meal, category');
  if (error) {
    console.error('[loadFoodsFromSupabase] Eroare:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Construiește un Map name → food pentru acces O(1).
 * Adaugă atât varianta exactă cât și varianta normalizată pentru fuzzy match.
 */
function buildFoodsMap(foods) {
  const map = new Map();
  for (const f of foods) {
    map.set(f.name, f);
    map.set(normalizeForMatch(f.name), f);
  }
  return map;
}

/**
 * Încarcă toate rețetele din tabela recipes.
 */
async function loadRecipesFromSupabase() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('recipes')
    .select('id, name, meal_type, diet_types, protein_source, preparation, ingredients');
  if (error) {
    console.error('[loadRecipesFromSupabase] Eroare:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Filtrează rețetele după tipul de dietă și alergiile clientului.
 */

// Sinonime pentru alergeni și alimente — mapează text liber la termeni din DB
const ALLERGY_SYNONYMS = {
  'oua':            ['ou ', 'oua', 'ouale', 'egg', 'albus', 'galbenus'],
  'ou':             ['ou ', 'oua', 'ouale', 'egg', 'albus', 'galbenus'],
  'lapte':          ['lapte', 'lactate', 'unt ', 'smantana', 'iaurt', 'branza', 'mozzarella', 'parmezan', 'cheddar', 'cascaval', 'feta', 'ricotta', 'kefir', 'whey'],
  'lactate':        ['lapte', 'lactate', 'unt ', 'smantana', 'iaurt', 'branza', 'mozzarella', 'parmezan', 'cheddar', 'cascaval', 'feta', 'ricotta', 'kefir', 'whey'],
  'gluten':         ['faina', 'grau', 'paine', 'paste', 'couscous', 'orz', 'secara', 'gris'],
  'grau':           ['faina', 'grau', 'paine', 'paste', 'couscous', 'gris'],
  'nuci':           ['nuci', 'migdale', 'caju', 'alune', 'fistic', 'macadamia', 'pecan'],
  'arahide':        ['arahide', 'unt de arahide', 'peanut'],
  'soia':           ['soia', 'tofu', 'edamame', 'lapte de soia'],
  'peste':          ['peste', 'somon', 'ton', 'macrou', 'sardine', 'tilapia', 'cod', 'hering', 'biban', 'crap', 'pastrav', 'file de'],
  'fructe de mare': ['creveti', 'midii', 'calamari', 'homar', 'crab', 'fructe de mare'],
  'creveti':        ['creveti'],
  'porc':           ['porc', 'bacon', 'slanina', 'sunca', 'cotlet de porc'],
  'vita':           ['vita', 'carne de vita', 'muschi de vita', 'antricot'],
  'pui':            ['pui', 'piept de pui', 'pulpe de pui', 'chicken'],
  'curcan':         ['curcan', 'turkey'],
};

// Cuvinte care indică negare (română)
const NEGATION_WORDS = [
  'nu vreau', 'nu-mi place', 'nu imi place', 'nu consum', 'nu doresc',
  'fara ', 'fără ', 'evit', 'exclude', 'exclus', 'alerg', 'intolerant',
  'nu mananc', 'nu mananci',
];

// Alimente suplimentare (non-alergeni) pentru parsarea preferințelor
const FOOD_KEYWORDS_EXTRA = [
  'quinoa', 'avocado', 'spanac', 'broccoli', 'morcov', 'rosii', 'castravete',
  'fasole', 'linte', 'naut', 'ciuperci', 'ardei', 'dovlecel', 'vinete', 'varza',
  'banane', 'mere', 'portocale', 'afine', 'capsuni', 'kiwi', 'pepene', 'ananas',
  'ovaz', 'fulgi', 'orez', 'cartofi', 'proteic', 'shake', 'smoothie',
  'salata', 'supa', 'ciorba', 'pudra', 'whey', 'proteina pudra',
];

// Sinonime pentru ingrediente din preferinte → termeni de căutat în numele rețetelor
const PREF_INGREDIENT_SYNONYMS = {
  'pudra':          ['pudra de proteine', 'shake proteic', 'whey'],
  'pudra proteica': ['pudra de proteine', 'shake proteic', 'whey'],
  'proteina pudra': ['pudra de proteine', 'shake proteic', 'whey'],
  'whey':           ['pudra de proteine', 'shake proteic', 'whey'],
  'shake':          ['shake proteic', 'smoothie proteic'],
  'smoothie':       ['smoothie proteic', 'shake proteic'],
  'proteic':        ['pudra de proteine', 'shake proteic', 'smoothie proteic'],
};

/**
 * Parseaza textul liber de preferinte si extrage:
 * - includes: alimente dorite (boost in selectie)
 * - excludes: alimente nedorite (filtrate complet, ca si alergii)
 * - specialMeals: cereri speciale ("shake proteic", "supa de legume" etc.)
 */
function sanitizePrefText(text) {
  if (!text || typeof text !== 'string') return '';

  // 1. Taie la maxim 300 caractere — nicio preferință alimentară legitimă nu e mai lungă
  let s = text.slice(0, 300);

  // 2. Elimină caractere de control și newline-uri (previn injectarea de noi linii în prompt)
  s = s.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ');

  // 3. Elimină secvențe tipice de prompt injection
  //    (ignore previous, you are now, act as, system:, ##, etc.)
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|above|prior)/gi,
    /you\s+are\s+now/gi,
    /act\s+as\s+(a\s+)?/gi,
    /new\s+instruction/gi,
    /system\s*:/gi,
    /assistant\s*:/gi,
    /user\s*:/gi,
    /\[INST\]/gi,
    /<<SYS>>/gi,
    /###/g,
    /══/g,          // nu poate injecta blocuri care arată ca instrucțiunile noastre
    /CRITIC\s+ABSOLUT/gi,
    /OBLIGATORIU/gi,
    /<\s*script/gi,
    /javascript\s*:/gi,
    /data\s*:/gi,
  ];
  for (const re of injectionPatterns) {
    s = s.replace(re, '');
  }

  // 4. Elimină ghilimele duble (ar închide string-ul din prompt) — înlocuiește cu ghilimele simple
  s = s.replace(/"/g, "'");

  // 5. Normalizează spații multiple
  s = s.replace(/\s{2,}/g, ' ').trim();

  return s;
}

function parsePreferences(prefText) {
  if (!prefText || !prefText.trim()) {
    return { includes: [], excludes: [], specialMeals: [], raw: '' };
  }

  // Sanitizează înainte de orice procesare
  const sanitized = sanitizePrefText(prefText);

  // Normalizeaza diacritice si punctuatie
  const norm = sanitized.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/ş/g, 's').replace(/ţ/g, 't')
    .replace(/[.,!?;:]/g, ' ');

  // Imparte in propozitii
  const sentences = norm.split(/\s*[.!?\n]+\s*|,\s*(?=nu |fara |fără )/).filter(Boolean);

  const includes     = new Set();
  const excludes     = new Set();
  const specialMeals = [];

  const specialPatterns = [
    { re: /shake\s*proteic/,                label: 'shake proteic' },
    { re: /smoothie\s*proteic/,             label: 'smoothie proteic' },
    { re: /pudra\s*(?:de\s*)?proteine?/,    label: 'shake proteic' },
    { re: /pudra\s*proteica/,               label: 'shake proteic' },
    { re: /proteina\s*pudra/,               label: 'shake proteic' },
    { re: /\bwhey\b/,                       label: 'shake proteic' },
    { re: /smoothie/,                       label: 'smoothie' },
    { re: /supa\s*de\s*(\w+)/,              label: (m) => `supa de ${m[1]}` },
    { re: /ciorba\s*de\s*(\w+)/,            label: (m) => `ciorba de ${m[1]}` },
  ];

  const allFoodKeys = [...Object.keys(ALLERGY_SYNONYMS), ...FOOD_KEYWORDS_EXTRA];

  for (const sentence of sentences) {
    // Detecteaza negare in propozitie
    const hasNegation = NEGATION_WORDS.some(neg => sentence.includes(neg));

    // Cereri speciale (tratate ca include, nu exclude)
    for (const { re, label } of specialPatterns) {
      const m = sentence.match(re);
      if (m) {
        const l = typeof label === 'function' ? label(m) : label;
        specialMeals.push(l);
      }
    }

    // Detecteaza alimente mentionate
    for (const key of allFoodKeys) {
      if (sentence.includes(key)) {
        if (hasNegation) excludes.add(key);
        else includes.add(key);
      }
    }
  }

  return {
    includes:     [...includes],
    excludes:     [...excludes],
    specialMeals: [...new Set(specialMeals)],
    raw:          sanitized.trim(),
  };
}

function getAllergyTerms(allergyInput) {
  const norm = normalizeForMatch(allergyInput);
  for (const [key, synonyms] of Object.entries(ALLERGY_SYNONYMS)) {
    if (norm === key || norm.includes(key) || key.includes(norm)) {
      return synonyms;
    }
  }
  return [norm];
}

// Verifica daca o reteta contine vreun termen dintr-o lista
function recipeContainsTerm(recipe, terms) {
  const ingNames = (recipe.ingredients || []).map(i => normalizeForMatch(i.food_name));
  const name     = normalizeForMatch(recipe.name || '');
  const protSrc  = normalizeForMatch(recipe.protein_source || '');
  return terms.some(term =>
    ingNames.some(n => n.includes(term)) ||
    name.includes(term) ||
    protSrc.includes(term)
  );
}

function filterRecipesByDiet(recipes, dietType, allergies = [], prefExcludes = []) {
  // Combina alergenii + excluderile din preferinte
  const allergyTermsList = [
    ...allergies.map(a => getAllergyTerms(a)),
    ...prefExcludes.map(e => getAllergyTerms(e)),
  ];

  return recipes.filter(r => {
    const dt = r.diet_types || [];
    if (dietType === 'vegan' && !dt.includes('vegan')) return false;
    if (dietType === 'vegetarian' && !dt.includes('vegetarian') && !dt.includes('vegan')) return false;

    for (const terms of allergyTermsList) {
      if (recipeContainsTerm(r, terms)) return false;
    }
    return true;
  });
}

/**
 * PROMPT 1 — O singură cerere AI pentru toate cele 7 zile.
 * AI primește lista de rețete (id, name, meal_type, protein_source) și returnează
 * selecția completă pentru fiecare masă din fiecare zi.
 */
async function selectRecipesWithAI(eligibleRecipes, clientData, targets, mealDistribution, parsedPrefs = null) {
  const dietType    = clientData.dietType || 'omnivore';
  const allergies   = (clientData.allergies || []).join(', ');
  const prefs       = parsedPrefs || parsePreferences(clientData.foodPreferences || clientData.preferences || '');
  const rawPrefText = prefs.raw || '';

  const dietLabel = { omnivore: 'omnivoră', vegetarian: 'vegetariană', vegan: 'vegană' }[dietType] || 'omnivoră';

  // Grupează rețetele pe meal_type
  const byType = {};
  for (const r of eligibleRecipes) {
    if (!byType[r.meal_type]) byType[r.meal_type] = [];
    byType[r.meal_type].push({ id: r.id, name: r.name, protein_source: r.protein_source || 'mixed' });
  }

  const recipeListText = Object.entries(byType)
    .map(([type, recipes]) =>
      `${type.toUpperCase()}:\n${recipes.map(r => `  - id:"${r.id}" | "${r.name}" | proteina:${r.protein_source}`).join('\n')}`)
    .join('\n\n');

  const mealsPerDay = mealDistribution.map(([slot]) => slot);

  // Rotație proteică pe zile
  const dayProteinHints = PROTEIN_SOURCE_BY_DAY.map((srcs, i) => {
    const dbKeys = srcs.map(s => PROTEIN_SOURCE_TO_DB_KEY[s]).filter(Boolean);
    return `Ziua ${i + 1}: ${dbKeys.join(' sau ')}`;
  }).join('\n');

  const systemPrompt = `Ești un nutriționist expert care selectează rețete dintr-o bază de date pre-definită pentru planuri alimentare săptămânale personalizate.

ROLUL TĂU:
- Selectezi EXCLUSIV rețete existente din lista furnizată
- Nu inventezi rețete noi sau modifici rețetele existente
- Prioritizezi rețete simple, accesibile, ușor de preparat zilnic
- Personalizezi selecția în funcție de preferințele și restricțiile clientului
- Maximizezi varietatea și calitatea nutrițională a planului

PRINCIPII DE SELECȚIE:
1. SIMPLITATE PRIMUL — preferă rețete cu 3-5 ingrediente față de rețete complexe
2. ACCESIBILITATE — ingrediente comune, ușor de găsit în orice supermarket
3. VARIETATE — nicio rețetă repetată de mai mult de o dată în 7 zile dacă există alternative
4. ROTAȚIE PROTEICĂ — surse diferite de proteină în fiecare zi
5. RESTRICȚII ABSOLUTE — alergiile și excluderile din preferințe sunt LEGE, nu sugestii`;

  const userPrompt = `Selectează rețete pentru un plan alimentar de 7 zile.

CLIENT:
- Dietă: ${dietLabel}
- Alergii/restricții medicale: ${allergies || 'niciuna'}
- Mese pe zi: ${mealsPerDay.join(', ')}

${prefs.excludes.length > 0 ? `══════════════════════════════════════════
ALIMENTE EXCLUSE DIN PREFERINȚE (OBLIGATORIU):
Clientul NU vrea: ${prefs.excludes.join(', ')}
Tratează aceste alimente IDENTIC cu alergiile.
NU selecta NICIO rețetă care conține aceste alimente sau ingrediente similare.
══════════════════════════════════════════
` : ''}${allergies ? `══════════════════════════════════════════
ALERGII MEDICALE — CRITIC ABSOLUT:
Clientul NU poate consuma: ${allergies}
Verifică FIECARE rețetă selectată să nu conțină aceste ingrediente.
Dacă nu ești sigur — NU selecta rețeta respectivă.
══════════════════════════════════════════
` : ''}${rawPrefText ? `══════════════════════════════════════════
PREFERINȚELE CLIENTULUI — OBLIGATORIU DE RESPECTAT:
"${rawPrefText}"
Citește cu atenție textul de mai sus. Dacă clientul menționează un ingredient specific (ex: pudră de proteine, shake proteic, ovăz, pui, etc.), selectează rețete care conțin acel ingredient. Include cel puțin 3-4 mese din 7 care reflectă aceste preferințe. Caută în lista de rețete disponibile rețetele care se potrivesc cel mai bine.
══════════════════════════════════════════
` : ''}
ROTAȚIE PROTEINE PE ZILE (respectă pentru prânz și cină):
${dayProteinHints}

REGULI OBLIGATORII:
1. Returnează EXACT 7 obiecte day (zilele 1-7)
2. Fiecare zi trebuie să aibă TOATE mesele: ${mealsPerDay.join(', ')}
3. Folosește EXCLUSIV recipe_id-uri din lista de mai jos
4. Nu repeta aceeași rețetă în aceeași zi
5. Maximizează varietatea pe parcursul săptămânii
6. Tipul mesei trebuie să corespundă: breakfast→Mic Dejun, lunch→Prânz, dinner→Cină, snack→Gustare
7. Pește și fructe de mare NICIODATĂ la mic dejun sau gustare
8. Mic dejun — preferă rețete rapide (ovăz, ouă, iaurt) față de rețete complexe
9. Gustare — preferă rețete simple cu maxim 2-3 ingrediente
10. Prânz și cină — pot fi mai elaborate dar tot preferă simplitatea
11. Nu selecta aceeași sursă de proteină principală în două zile consecutive

REȚETE DISPONIBILE:
${recipeListText}

Răspunde EXCLUSIV cu JSON valid, fără text adițional, fără markdown:
{
  "days": [
    {
      "day": 1,
      "meals": [
        {"slot": "Mic Dejun", "recipe_id": "uuid-exact-din-lista"},
        {"slot": "Prânz", "recipe_id": "uuid-exact-din-lista"},
        {"slot": "Cină", "recipe_id": "uuid-exact-din-lista"}
      ]
    }
  ]
}`;

  let rawText = '';
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.8,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    });
    rawText = resp.choices[0].message.content;
    const parsed = JSON.parse(rawText);
    const arr = parsed.days || (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);
    if (Array.isArray(arr) && arr.length > 0) {
      console.log(`[selectRecipesWithAI] Plan selectat: ${arr.length} zile`);
      return arr;
    }
  } catch (err) {
    console.error('[selectRecipesWithAI] Eroare GPT:', err.message, 'Raw:', rawText.slice(0, 200));
  }

  // Fallback: selecție aleatorie
  console.warn('[selectRecipesWithAI] Fallback la selecție aleatorie.');
  return Array.from({ length: 7 }, (_, i) => ({
    day: i + 1,
    meals: mealDistribution.map(([slot]) => {
      const mealType = MEAL_TYPE_MAP[slot] || 'snack';
      const pool     = eligibleRecipes.filter(r => r.meal_type === mealType);
      const recipe   = pool[Math.floor(Math.random() * pool.length)] || eligibleRecipes[0];
      return { slot, recipe_id: recipe?.id };
    }),
  }));
}

/**
 * Scalează o rețetă la targetul caloric al mesei folosind matematică pură (base_amount_g).
 *
 * Algoritm:
 * a) baseCalories = Σ(cal_per_100g × ingredient.base_amount_g / 100)  [legumele/fructele excluse]
 * b) scaleFactor  = mealTargetCalories / baseCalories
 * c) scaledGrams  = base_amount_g × scaleFactor
 * d) Cap: min(scaledGrams, max_amount_per_meal || MAX_GRAMS_BY_CATEGORY)
 * e) Legume/fructe: întotdeauna base_amount_g fix, nu scalate
 * f) Deficit după cap: crește ingredientul necapat cu cel mai mult kcal/g;
 *    dacă toate capate → ingredient complementar context-aware
 * g) roundToNearest5 pe toate gramajele
 */
function scaleRecipeToTarget(recipe, mealTargetCalories, foodsMap, maxGramsMap) {
  const MAX_GRAMS_BY_CATEGORY = maxGramsMap || BASE_MAX_GRAMS_BY_CATEGORY;
  const ingredients = recipe.ingredients || [];
  if (ingredients.length === 0) return [];

  // Calculează baseAmount din ratio_pct dacă base_amount_g lipsește.
  // ratio_pct = ponderea calorică a ingredientului; presupunem ~400 kcal/100g mediu → 400 kcal total bază.
  // Deci: base_amount_g = ratio_pct × 400 kcal / (cal_per_100g/100)
  // Facem asta după ce avem cal_per_100g, deci mai jos după lookup în foodsMap.

  // Rezolvă fiecare ingredient din foodsMap
  let items = ingredients.map(ing => {
    const rawName    = ing.food_name;
    const food       = foodsMap.get(rawName) || foodsMap.get(normalizeForMatch(rawName));

    // Determină baseAmount: preferă base_amount_g explicit, altfel derivă din ratio_pct
    let baseAmount = Number(ing.base_amount_g) || 0;
    if (!baseAmount && ing.ratio_pct) {
      // Estimăm gramajul de bază din ratio_pct × o masă de referință de 500 kcal
      const cal100 = food?.calories_per_100g || 100;
      baseAmount = Math.round((ing.ratio_pct * 500) / (cal100 / 100));
      baseAmount = Math.max(baseAmount, 5);
    }
    if (!baseAmount) baseAmount = 100; // fallback absolut

    if (!food || !food.calories_per_100g) {
      const fb    = getNutritionFallback(rawName);
      const isVeg = fb.cal < 60 && fb.p < 5;
      return {
        name: rawName, baseAmount, isVeg,
        cal100: fb.cal, p100: fb.p, c100: fb.c, f100: fb.f,
        maxGrams: fb.max || 200, category: 'unknown',
      };
    }

    const category = food.category || 'default';
    const isVeg    = category === 'vegetables' || category === 'fruits'
                     || food.calories_per_100g < 60; // densitate scăzută = garnitură (ceapă, usturoi, roșii etc.)
    // La gustare, fructele au un cap mai mic (max 200g = o porție reală)
    const isSnackMeal = (recipe.meal_type === 'snack');
    // Alimente cu densitate scăzută: cap dur la 150g indiferent de ce scrie în DB
    const LOW_DENSITY_MAX = 150;
    const maxGrams = (food.calories_per_100g < 60 ? Math.min(food.max_amount_per_meal || LOW_DENSITY_MAX, LOW_DENSITY_MAX) : null)
      || food.max_amount_per_meal
      || (isSnackMeal && isVeg ? 200 : null)
      || MAX_GRAMS_BY_CATEGORY[category]
      || MAX_GRAMS_BY_CATEGORY.default;

    return {
      name: food.name, baseAmount, isVeg,
      cal100: food.calories_per_100g,
      p100:   food.protein_per_100g,
      c100:   food.carbs_per_100g,
      f100:   food.fat_per_100g,
      maxGrams, category,
    };
  }).filter(Boolean);

  // ── Deduplicare: mergeează ingrediente cu același nume (normalizat) ────────
  {
    const seen = new Map();
    for (const item of items) {
      const key = normalizeForMatch(item.name);
      if (seen.has(key)) {
        seen.get(key).baseAmount += item.baseAmount; // sumează gramajul
      } else {
        seen.set(key, item);
      }
    }
    items = Array.from(seen.values());
  }

  // Calculează caloriile de bază (legumele/fructele nu contribuie la scalare)
  const baseCalories = items.reduce(
    (s, i) => s + (i.isVeg ? 0 : (i.baseAmount / 100) * i.cal100), 0
  );

  // Dacă rețeta nu are calorii definite, returnează base_amount_g fără scalare
  if (baseCalories < 1) {
    return items.map(i => ({
      name:     i.name,
      amount:   roundToNearest5(i.baseAmount),
      unit:     'g',
      calories: Math.round((i.baseAmount / 100) * i.cal100),
      protein:  Math.round((i.baseAmount / 100) * i.p100),
      carbs:    Math.round((i.baseAmount / 100) * i.c100),
      fat:      Math.round((i.baseAmount / 100) * i.f100),
    }));
  }

  const scaleFactor = mealTargetCalories / baseCalories;

  // Calculează grame scalate cu cap
  for (const item of items) {
    if (item.isVeg) {
      // Legumele nu se scalează după calorii (sunt garnitură), dar CAP-ul se aplică obligatoriu
      item.finalGrams = roundToNearest5(Math.min(item.baseAmount, item.maxGrams));
      item.capped     = item.baseAmount > item.maxGrams;
    } else {
      const raw       = item.baseAmount * scaleFactor;
      item.finalGrams = roundToNearest5(Math.max(Math.min(raw, item.maxGrams), 5));
      item.capped     = item.finalGrams < raw * 0.95;
    }
  }

  // Compensare deficit caloric
  const totalCal = () => items.reduce((s, i) => s + ((i.finalGrams || 0) / 100) * i.cal100, 0);
  const deficit  = mealTargetCalories - totalCal();

  if (deficit > mealTargetCalories * 0.05) {
    const best = items
      .filter(i => !i.capped && !i.isVeg)
      .sort((a, b) => b.cal100 - a.cal100)[0];

    if (best) {
      const extraGrams = Math.min(
        roundToNearest5(deficit / Math.max(best.cal100 / 100, 0.01)),
        best.maxGrams - best.finalGrams
      );
      if (extraGrams >= 5) best.finalGrams += extraGrams;
    } else {
      // Toate capate — încearcă să crească PROTEINA existentă (carne/pește) înainte de a adăuga carb nou
      const mealType    = recipe.meal_type || 'lunch';
      const isBreakfast = mealType === 'breakfast';
      const isSnack     = mealType === 'snack';

      // PRIORITATE 1: mărește proteina existentă (relaxăm cap-ul cu 50%)
      const proteinItem = items
        .filter(i => !i.isVeg && (i.category === 'meat' || i.category === 'fish' || i.p100 >= 15))
        .sort((a, b) => b.p100 - a.p100)[0];

      if (proteinItem) {
        const hardMax    = Math.max(proteinItem.maxGrams * 1.5, 250); // permite depășire cu 50%
        const extraGrams = roundToNearest5(Math.min(
          deficit / Math.max(proteinItem.cal100 / 100, 0.01),
          hardMax - proteinItem.finalGrams
        ));
        if (extraGrams >= 5) {
          proteinItem.finalGrams += extraGrams;
          proteinItem.capped = false;
        }
      } else {
        // PRIORITATE 2: ingredient complementar context-aware (fără duplicare grains)
        const hasGrains = items.some(i => i.category === 'grains');

        // Dacă există deja grains, mărește-l în loc să adaugi un ingredient nou
        if (hasGrains && !isSnack) {
          const grainItem = items
            .filter(i => i.category === 'grains')
            .sort((a, b) => b.cal100 - a.cal100)[0];
          if (grainItem) {
            const extraGrams = roundToNearest5(Math.min(
              deficit / Math.max(grainItem.cal100 / 100, 0.01),
              grainItem.maxGrams - grainItem.finalGrams
            ));
            if (extraGrams >= 5) { grainItem.finalGrams += extraGrams; grainItem.capped = false; }
          }
        } else {
          let compName, compCal100, compP100, compC100, compF100, compMax;
          if (isSnack) {
            // La gustare preferăm cereale simple dacă există deja un fruct, altfel banană
            const hasFruit = items.some(i => i.category === 'fruits');
            if (hasFruit) {
              compName = 'Rondele de orez'; compCal100 = 387; compP100 = 8; compC100 = 82; compF100 = 3; compMax = 60;
            } else {
              compName = 'Banană'; compCal100 = 89; compP100 = 1; compC100 = 23; compF100 = 0; compMax = 150;
            }
          } else if (isBreakfast && !hasGrains) {
            compName = 'Fulgi de ovăz'; compCal100 = 389; compP100 = 17; compC100 = 66; compF100 = 7; compMax = 80;
          } else {
            compName = 'Orez alb'; compCal100 = 365; compP100 = 7; compC100 = 80; compF100 = 1; compMax = 120;
          }

          const compGrams = roundToNearest5(Math.max(Math.min(deficit / (compCal100 / 100), compMax), 5));
          if (compGrams >= 10) {
            items.push({
              name: compName, baseAmount: compGrams, isVeg: false,
              cal100: compCal100, p100: compP100, c100: compC100, f100: compF100,
              maxGrams: compMax, category: 'grains', capped: false,
              finalGrams: compGrams,
            });
          }
        }
      }
    }
  }

  return items
    .filter(i => (i.finalGrams || 0) >= 5)
    .map(i => ({
      name:     i.name,
      amount:   i.finalGrams,
      unit:     'g',
      calories: Math.round((i.finalGrams / 100) * i.cal100),
      protein:  Math.round((i.finalGrams / 100) * i.p100),
      carbs:    Math.round((i.finalGrams / 100) * i.c100),
      fat:      Math.round((i.finalGrams / 100) * i.f100),
    }));
}

export async function POST(request) {
  try {
    console.log('[Generate Plan] Request received');
    
    const auth = verifyToken(request);
    if (auth.error) {
      console.log('[Generate Plan] Auth failed:', auth.error);
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    console.log('[Generate Plan] Auth successful, userId:', auth.userId);
    
    const { ip, userAgent } = getRequestMeta(request);

    let clientData;
    try {
      clientData = await request.json();
      console.log('[Generate Plan] Client data parsed:', { 
        name: clientData.name, 
        goal: clientData.goal,
        mealsPerDay: clientData.mealsPerDay 
      });
      // Normalize allergies to always be an array (suporta "ou si lactate", "oua,gluten" etc.)
      if (typeof clientData.allergies === 'string') {
        clientData.allergies = clientData.allergies.trim()
          ? clientData.allergies
              .replace(/\s+si\s+|\s+și\s+|\s+and\s+/gi, ',')
              .split(/[,;]+/)
              .map(s => s.trim())
              .filter(Boolean)
          : [];
      } else if (!Array.isArray(clientData.allergies)) {
        clientData.allergies = [];
      }
    } catch (parseError) {
      console.error('[Generate Plan] JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Body-ul cererii este invalid sau lipsă. Trimiteți un JSON valid.' },
        { status: 400 }
      );
    }

    const missingFields = [];
    if (!clientData.name)           missingFields.push('nume');
    if (!clientData.age)            missingFields.push('vârstă');
    if (!clientData.weight)         missingFields.push('greutate');
    if (!clientData.height)         missingFields.push('înălțime');
    if (!clientData.goal)           missingFields.push('obiectiv');
    if (!clientData.gender)         missingFields.push('gen');
    if (!clientData.activityLevel)  missingFields.push('nivel activitate');

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Câmpuri obligatorii lipsă: ${missingFields.join(', ')}.` },
        { status: 400 }
      );
    }

    let targetCalories;
    const hasAdjustment = typeof clientData.calorieAdjustment === 'number' && clientData.calorieAdjustment !== 0;
    const hasPreviousBase = clientData.currentPlanCalories && Number(clientData.currentPlanCalories) > 0;

    if (hasPreviousBase && hasAdjustment) {
      // Regenerare după ajustare AI — baza este planul ANTERIOR, nu TDEE-ul recalculat
      // Astfel schimbarea de greutate a clientului nu distorsionează ajustarea
      const base = Math.round(Number(clientData.currentPlanCalories));
      const adj  = Math.max(-500, Math.min(500, Math.round(clientData.calorieAdjustment)));
      targetCalories = base + adj;
      console.log(`[Generate Plan] Regenerare cu ajustare AI: ${base} ${adj >= 0 ? '+' : ''}${adj} = ${targetCalories} kcal`);
    } else {
      // Prima generare (sau regenerare manuală fără ajustare) — calculează din profil
      targetCalories = calculateTargetCalories(clientData);
      if (hasAdjustment) {
        const adj = Math.max(-500, Math.min(500, Math.round(clientData.calorieAdjustment)));
        console.log(`[Generate Plan] Ajustare AI (fără bază anterioară): ${targetCalories} ${adj >= 0 ? '+' : ''}${adj} = ${targetCalories + adj} kcal`);
        targetCalories = targetCalories + adj;
      } else {
        console.log(`[Generate Plan] Prima generare — calorii calculate din profil: ${targetCalories} kcal`);
      }
    }
    const weightKg = parseFloat(clientData.weight);
    const macros = calculateMacros(clientData.goal, weightKg, targetCalories);
    const proteinGrams = macros.protein;
    const carbsGrams = macros.carbs;
    const fatGrams = macros.fat;

    const { name, age, weight, height, goal, activityLevel, allergies, mealsPerDay, dietType } = clientData;
    const sex = clientData.gender === 'M' ? 'Masculin' : 'Feminin';
    const mealsNum = parseInt(mealsPerDay) || 3;

    // mealDistribution calculat la nevoie în getMealDistribution(mealsNum)

    const dayNames = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
    const targets = {
      calories: Math.round(targetCalories),
      protein:  Math.round(proteinGrams),
      carbs:    Math.round(carbsGrams),
      fat:      Math.round(fatGrams),
    };

    // dietType folosit direct de getRecipeForMeal pentru filtrarea rețetelor

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        const sendEvent = (obj) => {
          if (streamClosed) return; // clientul s-a deconectat — continuăm generarea în tăcere
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch {
            streamClosed = true; // stream închis — nu mai trimitem, dar generăm în continuare
          }
        };
        const closeStream = () => {
          if (!streamClosed) { streamClosed = true; try { controller.close(); } catch {} }
        };
        let loggedCancelled = false;
        const logCancelled = (details) => {
          if (loggedCancelled) return;
          loggedCancelled = true;
          logActivity({
            action: 'meal_plan.generate',
            status: 'cancelled',
            userId: auth.userId,
            email: auth.email,
            ipAddress: ip,
            userAgent,
            details,
          });
        };
        try {
    // ── Încarcă alimentele și rețetele DIN DB (o singură dată) ──
    const [allFoods, allRecipesRaw] = await Promise.all([
      loadFoodsFromSupabase(),
      loadRecipesFromSupabase(),
    ]);
    const foodsMap        = buildFoodsMap(allFoods);
    const parsedPrefs     = parsePreferences(clientData.foodPreferences || clientData.preferences || '');
    console.log(`[generate] Preferințe parsate:`, { includes: parsedPrefs.includes, excludes: parsedPrefs.excludes, special: parsedPrefs.specialMeals });
    const eligibleRecipes = filterRecipesByDiet(allRecipesRaw, dietType, clientData.allergies || [], parsedPrefs.excludes);
    console.log(`[generate] ${allFoods.length} alimente | ${allRecipesRaw.length} rețete | ${eligibleRecipes.length} eligibile (${dietType})`);
    if (eligibleRecipes.length === 0) {
      throw new Error(`Nu există rețete disponibile pentru dieta "${dietType}". Adăugați rețete în baza de date.`);
    }

    const weightKg = parseFloat(clientData.weight) || 70;
    const heightCm = parseFloat(clientData.height) || 175;
    const maxGramsMap = getMaxGramsByCategory(weightKg, heightCm);

    const mealDistForPlan = getMealDistribution(mealsNum);
    const allRecipesMap   = new Map(allRecipesRaw.map(r => [r.id, r]));

    // Macro targets per masă (proporțional cu distribuția calorică)
    // Fiecare masă are propria cotă din proteine, grăsimi, carbohidrați
    const mealMacroTargets = new Map(
      mealDistForPlan.map(([slot, pct]) => [slot, {
        calories: Math.round(targets.calories * pct),
        protein:  Math.round(targets.protein  * pct),
        carbs:    Math.round(targets.carbs    * pct),
        fat:      Math.round(targets.fat      * pct),
      }])
    );
    // ── PROMPT 1: O singură cerere AI pentru toate cele 7 zile ──
    sendEvent({ type: 'progress', day: 0, total: 7, message: 'Selectare rețete AI...' });
    const weeklySelection = await selectRecipesWithAI(eligibleRecipes, clientData, targets, mealDistForPlan, parsedPrefs);
    console.log(`[generate] Selecție AI completă: ${weeklySelection.length} zile`);

    const days = [];

    // ── Helper: construiește o zi cu o combinație specifică de rețete (indexate per slot) ──
    const buildDayPlan = (dayNumber, dayIndex, slotRecipeMap) => {
      const dayMeals = [];
      for (const [mealLabel, pct] of mealDistForPlan) {
        const mealCal  = Math.round(targets.calories * pct);
        const mealType = MEAL_TYPE_MAP[mealLabel] || 'snack';
        const recipe   = slotRecipeMap.get(mealLabel);
        if (!recipe) throw new Error(`Nicio rețetă pentru slotul "${mealLabel}".`);

        const foods = scaleRecipeToTarget(recipe, mealCal, foodsMap, maxGramsMap);
        if (foods.length === 0) throw new Error(`Gramaje nule pentru rețeta "${recipe.name}".`);

        dayMeals.push({
          name:        recipe.name,
          mealType,
          foods,
          preparation: recipe.preparation || '',
          mealTotals:  { calories: 0, protein: 0, carbs: 0, fat: 0 },
        });
      }
      const plan = { day: dayNumber, meals: dayMeals, dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
      recalculateDayTotals(plan);
      adjustDayTotals(plan, targets, mealMacroTargets, foodsMap, maxGramsMap);
      return plan;
    };

    // ── Helper: verifică dacă toate macrourile zilei sunt în toleranțe ──
    const dayInTolerance = (plan) => {
      const t = plan.dailyTotals;
      return (
        Math.abs(t.calories - targets.calories) / Math.max(targets.calories, 1) <= TOLERANCES.calories &&
        Math.abs(t.protein  - targets.protein)  / Math.max(targets.protein,  1) <= TOLERANCES.protein  &&
        Math.abs(t.fat      - targets.fat)       / Math.max(targets.fat,      1) <= TOLERANCES.fat
      );
    };

    // Set cu recipe_id-urile deja folosite în zilele finalizate — previne repetițiile inter-zile
    const usedRecipeIds = new Set();

    // ── Helper: construiește harta slot→rețetă (AI sau fallback) ──
    // attemptIndex permite rotirea rețetelor la fiecare retry (0 = prima alegere AI)
    // usedInWeek este Set-ul global al ID-urilor deja acceptate în planul final
    const buildSlotRecipeMap = (dayIndex, daySelection, attemptIndex, usedInWeek) => {
      const map             = new Map();
      const usedInThisDay   = new Set(); // previne duplicarea în aceeași zi

      for (const [mealLabel] of mealDistForPlan) {
        const mealType = MEAL_TYPE_MAP[mealLabel] || 'snack';

        // La prima încercare folosim selecția AI
        let recipe = null;
        if (attemptIndex === 0) {
          const slot = (daySelection.meals || []).find(m => m.slot === mealLabel);
          const candidate = slot
            ? (allRecipesMap.get(slot.recipe_id) || eligibleRecipes.find(r => r.id === slot.recipe_id))
            : null;
          // Acceptăm propunerea AI doar dacă nu e deja în săptămână
          if (candidate && !usedInWeek.has(candidate.id) && !usedInThisDay.has(candidate.id)) {
            recipe = candidate;
          }
        }

        if (!recipe) {
          // Pool filtrat: tipul corect + preferință proteică + nefolosit în săptămână
          const psOptions     = (mealType === 'breakfast' || mealType === 'snack') ? null : PROTEIN_SOURCE_BY_DAY[dayIndex];
          const dbProteinKeys = psOptions ? psOptions.map(p => PROTEIN_SOURCE_TO_DB_KEY[p]).filter(Boolean) : null;

          const buildPool = (excludeUsedWeek) => eligibleRecipes.filter(r =>
            r.meal_type === mealType &&
            (!dbProteinKeys || !r.protein_source || dbProteinKeys.includes(r.protein_source)) &&
            !usedInThisDay.has(r.id) &&
            (!excludeUsedWeek || !usedInWeek.has(r.id))
          );

          // Încearcă mai întâi pool fără rețetele din săptămână
          let pool = buildPool(true);

          // Dacă pool-ul e gol (toate rețetele de tip au fost deja folosite), relaxăm constrângerea săptămânii
          if (pool.length === 0) pool = buildPool(false);

          // Dacă tot gol, fallback total (orice rețetă de tipul respectiv)
          if (pool.length === 0) pool = eligibleRecipes.filter(r => r.meal_type === mealType);
          if (pool.length === 0) throw new Error(`Nu există rețete pentru tipul "${mealType}".`);

          // Shuffle determinist bazat pe dayIndex + attemptIndex pentru varietate între zile și retry-uri
          // Bonus: rețetele care conțin cuvinte cheie din preferințe sunt urcate în față
          // Extinde keywords prin sinonime (ex: 'pudra' → 'shake proteic', 'pudra de proteine')
          const rawPrefKeywords = [
            ...(parsedPrefs?.includes || []),
            ...(parsedPrefs?.specialMeals || []),
            ...(clientData.foodPreferences || clientData.preferences || '')
              .toLowerCase().split(/[,\s]+/).filter(w => w.length > 3),
          ];
          const prefKeywords = [
            ...rawPrefKeywords,
            ...rawPrefKeywords.flatMap(kw => PREF_INGREDIENT_SYNONYMS[kw] || []),
          ];
          const seed   = dayIndex * 37 + attemptIndex * 13;
          const sorted = [...pool].sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            const prefA = prefKeywords.some(kw => nameA.includes(kw)) ? -1000 : 0;
            const prefB = prefKeywords.some(kw => nameB.includes(kw)) ? -1000 : 0;
            if (prefA !== prefB) return prefA - prefB;
            const ha = (a.id.charCodeAt(0) + seed) % 97;
            const hb = (b.id.charCodeAt(0) + seed) % 97;
            return ha - hb;
          });
          recipe = sorted[0];
        }

        map.set(mealLabel, recipe);
        usedInThisDay.add(recipe.id);
      }
      return map;
    };

    const MAX_DAY_RETRIES = 8;

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayNumber = dayIndex + 1;
      const dayName   = dayNames[dayIndex];
      console.log(`Generare ziua ${dayNumber}/7 (${dayName})...`);
      sendEvent({ type: 'progress', day: dayNumber, total: 7 });

      if (clientData.clientId) {
        try {
          const supabaseProgress = getSupabase();
          await supabaseProgress
            .from('generation_status')
            .update({ current_step: dayNumber, updated_at: new Date().toISOString() })
            .eq('client_id', clientData.clientId)
            .eq('trainer_id', auth.userId)
            .eq('status', 'generating');
        } catch {}
      }

      const daySelection = weeklySelection[dayIndex] || { day: dayNumber, meals: [] };

      let bestPlan   = null;
      let bestScore  = Infinity; // scor = suma erorilor procentuale absolute

      for (let attempt = 0; attempt < MAX_DAY_RETRIES; attempt++) {
        let plan;
        try {
          const slotMap = buildSlotRecipeMap(dayIndex, daySelection, attempt, usedRecipeIds);
          plan = buildDayPlan(dayNumber, dayIndex, slotMap);
        } catch (err) {
          console.warn(`[Day ${dayNumber}] Attempt ${attempt + 1} eroare: ${err.message}`);
          continue;
        }

        const t     = plan.dailyTotals;
        const score =
          Math.abs(t.calories - targets.calories) / Math.max(targets.calories, 1) +
          Math.abs(t.protein  - targets.protein)  / Math.max(targets.protein,  1) +
          Math.abs(t.fat      - targets.fat)       / Math.max(targets.fat,      1);

        console.log(`[Day ${dayNumber}] Attempt ${attempt + 1}: ${t.calories}kcal | P:${t.protein}g | F:${t.fat}g | score:${(score * 100).toFixed(1)}%`);

        if (score < bestScore) {
          bestScore = score;
          bestPlan  = plan;
        }

        if (dayInTolerance(plan)) {
          console.log(`[Day ${dayNumber}] ✓ în toleranțe la attempt ${attempt + 1}`);
          break;
        }
      }

      if (!dayInTolerance(bestPlan)) {
        console.warn(`[Day ${dayNumber}] ⚠ cel mai bun plan după ${MAX_DAY_RETRIES} încercări: score ${(bestScore * 100).toFixed(1)}%`);
      }

      console.log(`Day ${dayNumber}: Done (${bestPlan.dailyTotals.calories} kcal | P:${bestPlan.dailyTotals.protein}g | C:${bestPlan.dailyTotals.carbs}g | F:${bestPlan.dailyTotals.fat}g)`);

      // Marchează rețetele zilei acceptate ca folosite în săptămână
      bestPlan.meals.forEach(m => {
        const recipeEntry = eligibleRecipes.find(r => r.name === m.name);
        if (recipeEntry) usedRecipeIds.add(recipeEntry.id);
      });

      days.push(bestPlan);
    }

    const plan = { clientName: name, dailyTargets: targets, days };

    // Salvează planul în Supabase dacă există clientId
    let savedPlanId = null;
    if (clientData.clientId) {
      const supabase = getSupabase();
      const { data: insertedData, error: saveError } = await supabase
        .from('meal_plans')
        .insert({
          client_id: clientData.clientId,
          trainer_id: auth.userId,
          plan_data: plan,
          daily_targets: targets,
        })
        .select('id')
        .single();
      if (saveError) {
        console.error('Eroare la salvarea planului în Supabase:', saveError.message);
      } else {
        savedPlanId = insertedData?.id;
        console.log('Plan salvat cu succes în Supabase pentru clientul', clientData.clientId, 'ID:', savedPlanId);
      }
    }

    logActivity({
      action: 'meal_plan.generate',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: clientData.clientId || null, clientName: clientData.name },
    });

    // Marchează generarea ca finalizată în generation_status
    if (clientData.clientId) {
      const supabase2 = getSupabase();
      await supabase2
        .from('generation_status')
        .update({
          status: 'completed',
          current_step: 7,
          completed_at: new Date().toISOString(),
          plan_id: savedPlanId,
        })
        .eq('client_id', clientData.clientId)
        .eq('trainer_id', auth.userId)
        .eq('status', 'generating');
    }

    sendEvent({ type: 'complete', plan, nutritionalNeeds: targets, planId: savedPlanId });
    console.log('[generate-meal-plan] Sent complete event with planId:', savedPlanId);
        } catch (err) {
          logActivity({
            action: 'meal_plan.generate',
            status: 'failure',
            userId: auth.userId,
            email: auth.email,
            ipAddress: ip,
            userAgent,
            details: { clientId: clientData.clientId || null, clientName: clientData.name, error: err.message },
          });
          sendEvent({ type: 'error', message: err.message });
        } finally {
          closeStream();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[Generate Plan] Unhandled error:', error);
    console.error('[Generate Plan] Error stack:', error.stack);
    const { ip: errIp, userAgent: errUA } = getRequestMeta(request);
    logActivity({
      action: 'meal_plan.generate',
      status: 'failure',
      userId: null,
      email: null,
      ipAddress: errIp,
      userAgent: errUA,
      details: { error: error.message, stack: error.stack },
    });
    return NextResponse.json(
      {
        error: 'Eroare la generarea planului alimentar. Vă rog încercați din nou.',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Rotunjește gramajul alimentului la cel mai apropiat multiplu de 5
 */
function roundToNearest5(value) {
  return Math.round(value / 5) * 5;
}

// ─── HELPERS COMUNE ───────────────────────────────────────────────────────────

const FOOD_FALLBACK_LIMITS = [
  { keywords: ['ou intreg', 'ou', 'oua', 'albus'], max: 120 },
  { keywords: ['lapte'], max: 250 },
  { keywords: ['iaurt'], max: 200 },
  { keywords: ['smantana'], max: 40 },
  { keywords: ['parmezan'], max: 25 },
  { keywords: ['ulei', 'unt de arahide'], max: 15 },
  { keywords: ['seminte de chia', 'seminte de in'], max: 15 },
  { keywords: ['seminte'], max: 20 },
];

// ─── TOLERANȞE NUTRIȚIONALE ────────────────────────────────────────────────
const TOLERANCES = {
  calories: 0.05,  // ±5%
  protein:  0.08,  // ±8%
  carbs:    0.10,  // ±10%
  fat:      0.10,  // ±10%
};

function normalizeName(name) {
  return (name || '').toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't');
}

function getFoodMaxAmount(food, dbLimits) {
  const n = normalizeName(food.name);
  if (dbLimits[n]) return dbLimits[n];
  for (const rule of FOOD_FALLBACK_LIMITS) {
    if (rule.keywords.some(k => n.includes(k))) return rule.max;
  }
  return null; // fără limită
}

function isAtLimit(food, dbLimits) {
  const max = getFoodMaxAmount(food, dbLimits);
  return max !== null && food.amount >= max * 0.95;
}

// ─── FUNCȚII DE AJUSTARE ──────────────────────────────────────────────────────

/**
 * Aplică limite maxime de gramaj după scalare.
 */
function enforceFoodLimits(day, _dbLimits = {}) {
  if (!day.meals) return;
  day.meals.forEach(meal => {
    if (!meal.foods) return;
    meal.foods.forEach(food => {
      const fb  = getNutritionFallback(food.name);
      const max = fb.max || 500;
      if (food.amount > max) {
        const s       = max / food.amount;
        food.calories = Math.round(food.calories * s);
        food.protein  = Math.round(food.protein  * s);
        food.carbs    = Math.round(food.carbs    * s);
        food.fat      = Math.round(food.fat      * s);
        food.amount   = max;
      }
    });
  });
}

/**
 * Fine-tuning zilnic: scalează proporțional alimentele din mesele principale
 * ca totalurile zilnice să se încadreze în toleranțe (±5% kcal, ±8% proteină).
 *
 * Nu face niciun lookup în DB — lucrează exclusiv cu datele nutriționale
 * estimate de GPT și stocate în obiectele food.
 *
 * Strategia (max 6 iterații):
 *   1. Scalează TOATE alimentele din mesele principale cu factor = mainTarget/mainCal
 *   2. Dacă proteina e în afara toleranței, scalează suplimentar alimentele proteice
 *   Gustările rămân fixe (nu se modifică).
 */
function fineTuneDayToTargets(day, targets) {
  if (!day.meals) return;

  // Clasificare din macros ale food-ului (nu din DB)
  const classifyFood = (food) => {
    const cal = food.calories || 1;
    const amt = food.amount   || 100;
    const fat100 = (food.fat     || 0) / amt * 100;
    const p100   = (food.protein || 0) / amt * 100;
    const c100   = (food.carbs   || 0) / amt * 100;
    const fPct   = (food.fat     * 9) / cal;
    const pPct   = (food.protein * 4) / cal;
    const cPct   = (food.carbs   * 4) / cal;
    if (fat100 >= 40 || (fat100 >= 15 && fPct >= 0.45)) return 'fat_dense';
    if (cal / amt * 100 < 60 && p100 < 8)               return 'vegetable';
    if (p100 >= 15 && pPct >= 0.35)                      return 'protein';
    if (c100 >= 30 && cPct >= 0.50)                      return 'carb';
    return 'mixed';
  };

  const getTotals = () => {
    let cal = 0, p = 0, c = 0, f = 0;
    day.meals.forEach(m => (m.foods || []).forEach(food => {
      cal += food.calories || 0; p += food.protein || 0;
      c   += food.carbs    || 0; f += food.fat     || 0;
    }));
    return { cal, p, c, f };
  };

  const snackCals = day.meals
    .filter(m => m.mealType === 'snack')
    .reduce((s, m) => s + (m.foods || []).reduce((ms, f) => ms + (f.calories || 0), 0), 0);
  const mainTarget = targets.calories - snackCals;

  // Aplică un factor de scalare pe toate alimentele din mesele principale
  const scaleMainMeals = (factor) => {
    const sf = Math.max(0.3, Math.min(3.5, factor));
    if (Math.abs(sf - 1) < 0.015) return false;
    day.meals.forEach(meal => {
      if (meal.mealType === 'snack') return;
      (meal.foods || []).forEach(food => {
        const fb     = getNutritionFallback(food.name);
        const max    = fb.max || 500;
        const newAmt = roundToNearest5(Math.min(food.amount * sf, max));
        const s      = newAmt / (food.amount || 1);
        food.amount   = newAmt;
        food.calories = Math.round((food.calories || 0) * s);
        food.protein  = Math.round((food.protein  || 0) * s);
        food.carbs    = Math.round((food.carbs    || 0) * s);
        food.fat      = Math.round((food.fat      || 0) * s);
      });
    });
    return true;
  };

  // Aplică un factor doar pe alimentele proteice din mesele principale
  const scaleProteinFoods = (factor) => {
    const sf = Math.max(0.4, Math.min(2.5, factor));
    if (Math.abs(sf - 1) < 0.02) return;
    day.meals.forEach(meal => {
      if (meal.mealType === 'snack') return;
      (meal.foods || []).forEach(food => {
        if (classifyFood(food) !== 'protein') return;
        const fb     = getNutritionFallback(food.name);
        const max    = fb.max || 300;
        const newAmt = roundToNearest5(Math.min(food.amount * sf, max));
        const s      = newAmt / (food.amount || 1);
        food.amount   = newAmt;
        food.calories = Math.round((food.calories || 0) * s);
        food.protein  = Math.round((food.protein  || 0) * s);
        food.carbs    = Math.round((food.carbs    || 0) * s);
        food.fat      = Math.round((food.fat      || 0) * s);
      });
    });
  };

  console.log(`[fineTune] Start: ${getTotals().cal}/${targets.calories} kcal | snackFix:${snackCals} | mainTarget:${mainTarget}`);

  // ── Pas 1: Ajustare calorică proporțională ──
  for (let i = 0; i < 6; i++) {
    let mainCal = 0;
    day.meals.forEach(m => {
      if (m.mealType !== 'snack') (m.foods || []).forEach(f => mainCal += f.calories || 0);
    });
    if (mainCal < 1) break;
    if (Math.abs(mainCal - mainTarget) / Math.max(mainTarget, 1) <= TOLERANCES.calories) break;
    if (!scaleMainMeals(mainTarget / mainCal)) break;
  }

  // ── Pas 2: Fine-tune proteină ──
  for (let i = 0; i < 4; i++) {
    const { p } = getTotals();
    if (Math.abs(p - targets.protein) / targets.protein <= TOLERANCES.protein) break;
    let protCal = 0;
    day.meals.forEach(m => {
      if (m.mealType === 'snack') return;
      (m.foods || []).forEach(f => { if (classifyFood(f) === 'protein') protCal += f.calories || 0; });
    });
    if (protCal < 10) break;
    const deficit = targets.protein - p;
    scaleProteinFoods((protCal + deficit * 4) / protCal);
  }

  // ── Pas 3: Corectare grăsimi — reduce fat_dense dacă fat > target + toleranță ──
  // Iterăm max 5 ori; după fiecare reducere reechilibrăm caloriile cu carbohidrați.
  for (let i = 0; i < 5; i++) {
    const { f: currentFat, cal: currentCal } = getTotals();
    const fatExcess = currentFat - targets.fat * (1 + TOLERANCES.fat);
    if (fatExcess <= 0) break; // grăsimile sunt în toleranță

    // Calculează caloriile din fat_dense în mesele principale
    let fatDenseCal = 0;
    day.meals.forEach(m => {
      if (m.mealType === 'snack') return;
      (m.foods || []).forEach(f => { if (classifyFood(f) === 'fat_dense') fatDenseCal += f.calories || 0; });
    });
    if (fatDenseCal < 5) break; // nimic de redus

    // Factor de scalare pentru a elimina excesul de grăsime
    // fatExcess grame * 9 kcal/g = calorii de eliminat din fat_dense
    const calToRemove = fatExcess * 9;
    const scaleFat = Math.max(0.1, (fatDenseCal - calToRemove) / fatDenseCal);

    // Aplică reducerea pe fat_dense din mesele principale
    day.meals.forEach(meal => {
      if (meal.mealType === 'snack') return;
      (meal.foods || []).forEach(food => {
        if (classifyFood(food) !== 'fat_dense') return;
        const sf     = Math.max(0.1, scaleFat);
        const newAmt = roundToNearest5(Math.max(food.amount * sf, 5));
        const s      = newAmt / Math.max(food.amount, 1);
        food.amount   = newAmt;
        food.calories = Math.round((food.calories || 0) * s);
        food.protein  = Math.round((food.protein  || 0) * s);
        food.carbs    = Math.round((food.carbs    || 0) * s);
        food.fat      = Math.round((food.fat      || 0) * s);
      });
    });

    // Compensare calorică: recuperează caloriile pierdute prin reducerea fat_dense
    // adaugând la sursele de carb existente (sau inserând Orez alb dacă nu există niciuna)
    const { cal: calAfterFatCut } = getTotals();
    let remaining = Math.round(currentCal - calAfterFatCut); // calorii de recuperat
    if (remaining > 30) {
      // Pass 1: mărește carbohidrații existente în mesele principale
      for (const meal of day.meals) {
        if (meal.mealType === 'snack' || remaining <= 10) break;
        for (const food of (meal.foods || [])) {
          if (classifyFood(food) !== 'carb' || remaining <= 10) continue;
          const fb     = getNutritionFallback(food.name);
          const maxAmt = fb.max || 300;
          if (food.amount >= maxAmt) continue;
          const extraAmt = roundToNearest5(Math.min(
            remaining / Math.max(fb.cal / 100, 1),
            maxAmt - food.amount
          ));
          if (extraAmt < 5) continue;
          const s = extraAmt / 100;
          food.amount   += extraAmt;
          food.calories += Math.round(fb.cal * s);
          food.protein  += Math.round(fb.p   * s);
          food.carbs    += Math.round(fb.c   * s);
          food.fat      += Math.round(fb.f   * s);
          remaining -= Math.round(fb.cal * s);
        }
      }

      // Pass 2: nicio sursă carb găsită sau tot mai e deficit — adaugă carb la prânz/cină (NICIODATĂ la mic dejun)
      if (remaining > 50) {
        const targetMeal = day.meals.find(m => m.mealType === 'lunch' || m.mealType === 'dinner');
        if (targetMeal) {
          const existing = (targetMeal.foods || []).find(f => normalizeName(f.name).includes('orez'));
          const riceFb   = { cal: 365, p: 7, c: 80, f: 1, max: 150 }; // Orez alb crud
          const addGrams = roundToNearest5(Math.min(remaining / (riceFb.cal / 100), riceFb.max));
          if (addGrams >= 10) {
            const s = addGrams / 100;
            if (existing) {
              const safe = Math.min(addGrams, riceFb.max - existing.amount);
              if (safe >= 5) {
                existing.amount   += safe;
                existing.calories += Math.round(riceFb.cal * safe / 100);
                existing.protein  += Math.round(riceFb.p   * safe / 100);
                existing.carbs    += Math.round(riceFb.c   * safe / 100);
                existing.fat      += Math.round(riceFb.f   * safe / 100);
              }
            } else {
              targetMeal.foods.push({
                name: 'Orez alb', amount: addGrams, unit: 'g',
                calories: Math.round(riceFb.cal * s), protein: Math.round(riceFb.p * s),
                carbs:    Math.round(riceFb.c   * s), fat:     Math.round(riceFb.f * s),
              });
            }
          }
        }
        // Dacă nu există prânz sau cină (plan cu 3 mese fără prânz dedicat), lăsăm Pas 4 să compenseze
      }
    }
  }

  // ── Pas 4: Recalibrare finală a caloriilor — după tăierile de grăsime din Pas 3
  // Scalează DOAR prânz și cină (nu mic dejun / gustare) pentru a nu contamina mese contextual corecte.
  for (let i = 0; i < 6; i++) {
    let mainCal = 0;
    day.meals.forEach(m => {
      if (m.mealType !== 'snack') (m.foods || []).forEach(f => mainCal += f.calories || 0);
    });
    if (mainCal < 1) break;
    if (Math.abs(mainCal - mainTarget) / Math.max(mainTarget, 1) <= TOLERANCES.calories) break;
    const sf = Math.max(0.4, Math.min(3.0, mainTarget / mainCal));
    if (Math.abs(sf - 1) < 0.015) break;
    day.meals.forEach(meal => {
      // Scalează DOAR prânz și cină; mic dejunul și gustarea își păstrează ingredientele originale
      if (meal.mealType !== 'lunch' && meal.mealType !== 'dinner') return;
      (meal.foods || []).forEach(food => {
        if (classifyFood(food) === 'fat_dense') return; // nu reintroduc grăsimile tăiate
        const fb     = getNutritionFallback(food.name);
        const max    = fb.max || 500;
        const newAmt = roundToNearest5(Math.min(food.amount * sf, max));
        const s      = newAmt / Math.max(food.amount, 1);
        food.amount   = newAmt;
        food.calories = Math.round((food.calories || 0) * s);
        food.protein  = Math.round((food.protein  || 0) * s);
        food.carbs    = Math.round((food.carbs    || 0) * s);
        food.fat      = Math.round((food.fat      || 0) * s);
      });
    });
  }
  recalculateDayTotals(day);
  const t = day.dailyTotals;
  const calErr = Math.round(Math.abs(t.calories - targets.calories) / targets.calories * 100);
  const pErr   = Math.round(Math.abs(t.protein  - targets.protein)  / targets.protein  * 100);
  const fErr   = Math.round(Math.abs(t.fat       - targets.fat)       / targets.fat       * 100);
  console.log(`[fineTune] Final: ${t.calories}/${targets.calories} kcal (±${calErr}%) | P:${t.protein}/${targets.protein}g (±${pErr}%) | F:${t.fat}/${targets.fat}g (±${fErr}%)`);
}

/**
 * Scalează alimentele fără limită pentru a acoperi deficitul zilnic.
 * Iterează de max 4 ori; se oprește la toleranță de ±3%.
 */
function compensateDeficit(day, targets, dbLimits = {}) {
  if (!day.meals) return;

  for (let iter = 0; iter < 4; iter++) {
    let actualCal = 0;
    day.meals.forEach(m => m.foods.forEach(f => { actualCal += f.calories || 0; }));

    const deficit = targets.calories - actualCal;
    if (Math.abs(deficit) / targets.calories <= TOLERANCES.calories) break;
    if (deficit <= 0) break;

    // Găsește caloriile totale ale alimentelor libere (nu la limită) din mesele PRINCIPALE (non-snack)
    // Snack-urile au porții mici cu limite stricte — nu scalez snack-urile, las mesele principale să absoarbă deficitul
    let freeCal = 0;
    day.meals.forEach(m => {
      if (m.mealType === 'snack') return; // sări snack-urile
      m.foods.forEach(f => {
        if (!isAtLimit(f, dbLimits)) freeCal += f.calories || 0;
      });
    });
    // Dacă nu avem calorii libere în mese principale, încearcă cu toate mesele
    if (freeCal === 0) {
      day.meals.forEach(m => m.foods.forEach(f => {
        if (!isAtLimit(f, dbLimits)) freeCal += f.calories || 0;
      }));
    }

    if (freeCal === 0) break; // totul e la limită — addFillerFoods va gestiona

    const scaleFactor = (freeCal + deficit) / freeCal;

    day.meals.forEach(m => {
      if (m.mealType === 'snack') return; // snack-urile nu se scalează în compensare
      m.foods.forEach(f => {
        if (isAtLimit(f, dbLimits)) return;
        const max = getFoodMaxAmount(f, dbLimits);
        const newAmt = max ? Math.min(f.amount * scaleFactor, max) : f.amount * scaleFactor;
        const s = newAmt / (f.amount || 1);
        f.amount   = roundToNearest5(newAmt);
        f.calories = Math.round((f.calories || 0) * s);
        f.protein  = Math.round((f.protein  || 0) * s);
        f.carbs    = Math.round((f.carbs    || 0) * s);
        f.fat      = Math.round((f.fat      || 0) * s);
      });
    });
  }
}

/**
 * Completează deficitele nutriționale în ordine strictă:
 * 1. Proteină → până la (target - 5g)
 * 2. Grăsimi  → până la target exact
 * 3. Carbohidrați → până când caloriile totale ating targetul
 */
async function addFillerFoods(day, targets, dbLimits = {}, dietType = 'omnivore', allergies = []) {
  if (!day.meals) return;

  const isVegan = dietType === 'vegan';
  const isVegetarian = dietType === 'vegetarian' || isVegan;
  const allergyNorm = allergies.map(a => normalizeName(a));

  // Alimente filler per tip de masă și categorie
  // Vegetarian: fără carne/pește | Vegan: fără carne/pește/ouă/lactate
  const FILLER_NAMES_BY_MEAL_TYPE = {
    breakfast: {
      protein: isVegan
        ? ['Tofu', 'Linte rosie', 'Naut fiert']
        : isVegetarian
        ? ['Ou intreg', 'Iaurt grecesc', 'Branza cottage']
        : ['Ou intreg', 'Iaurt grecesc', 'Branza cottage'],
      fat:     ['Migdale', 'Unt de arahide', 'Nuci'],
      carb:    ['Fulgi de ovaz', 'Banana', 'Paine integrala'],
    },
    snack: {
      protein: isVegan
        ? ['Naut fiert', 'Unt de arahide']
        : isVegetarian
        ? ['Iaurt grecesc', 'Branza cottage']
        : ['Iaurt grecesc', 'Branza cottage'],
      fat:     ['Migdale', 'Nuci'],
      carb:    ['Banana', 'Mar', 'Fulgi de ovaz'],
    },
    lunch: {
      protein: isVegan
        ? ['Tofu', 'Linte rosie', 'Naut fiert', 'Fasole neagra']
        : isVegetarian
        ? ['Ou intreg', 'Branza cottage', 'Linte rosie']
        : ['Piept de pui', 'Ton conserva', 'Branza cottage'],
      fat:     ['Ulei de masline', 'Unt de arahide'],
      carb:    ['Orez alb', 'Cartofi dulci', 'Paine integrala'],
    },
    dinner: {
      protein: isVegan
        ? ['Tofu', 'Linte rosie', 'Naut fiert']
        : isVegetarian
        ? ['Ou intreg', 'Branza cottage']
        : ['Piept de pui', 'Ton conserva', 'Ou intreg'],
      fat:     ['Ulei de masline', 'Nuci'],
      carb:    ['Cartofi dulci', 'Orez alb'],
    },
  };

  // Cache nutritional pentru fillers — fetch din DB o singură dată per nume
  const fillerNutritionCache = {};
  const getNutritionForFiller = async (name) => {
    if (!fillerNutritionCache[name]) {
      fillerNutritionCache[name] = await getNutritionalData(name);
    }
    return fillerNutritionCache[name];
  };

  const getFillersForMeal = (meal, category) => {
    const mt = meal.mealType || 'lunch';
    const byType = FILLER_NAMES_BY_MEAL_TYPE[mt] || FILLER_NAMES_BY_MEAL_TYPE.lunch;
    return byType[category] || [];
  };

  const MEAT_FISH_KEYWORDS = ['pui', 'ton', 'somon', 'macrou', 'vita', 'porc', 'curcan', 'sardine'];

  // Detectează dacă masa are ouă (pentru a ști că pâinea/legumele sunt ok, ovăzul NU)
  const mealHasEggs = (meal) => meal.foods.some(f => normalizeName(f.name).includes('ou '));
  // Detectează dacă masa are deja cereale/carbohidrați grei (orez, paste, cartofi, pâine, ovăz)
  const HEAVY_CARB_KEYWORDS = ['orez', 'paste', 'cartofi', 'paine', 'ovaz', 'fulgi', 'quinoa', 'bulgur', 'malai'];
  const mealHasHeavyCarb = (meal) => meal.foods.some(f =>
    HEAVY_CARB_KEYWORDS.some(kw => normalizeName(f.name).includes(kw))
  );

  // Fillers care NU se potrivesc cu o masă care are ouă (mic dejun tip omletă)
  const INCOMPATIBLE_WITH_EGGS = ['fulgi de ovaz', 'ovaz', 'oatmeal', 'orez', 'paste', 'quinoa'];

  // Adaugă sau mărește un ingredient filler corespunzător tipului mesei cu cel mai mare deficit
  const applyFiller = async (category, neededMacroGrams, macroKey) => {
    const mealTarget = targets.calories / day.meals.length;

    // Preferă mese principale (non-snack) pentru a absorbi deficitul caloric
    // Snack-urile au limite mici de porție și nu pot absorbi calorii mari
    const mainMeals = day.meals.filter(m => m.mealType !== 'snack');
    const candidateMeals = mainMeals.length > 0 ? mainMeals : day.meals;

    let chosen = candidateMeals[0];
    let maxDef = -Infinity;
    candidateMeals.forEach(m => {
      const mCal = m.foods.reduce((s, f) => s + (f.calories || 0), 0);
      if (mealTarget - mCal > maxDef) { maxDef = mealTarget - mCal; chosen = m; }
    });
    // Dacă nicio masă principală nu are deficit, alege cea mai mare masă (prânz sau cină)
    if (maxDef <= 0 && mainMeals.length > 0) {
      chosen = mainMeals.reduce((best, m) => {
        const mCal = m.foods.reduce((s, f) => s + (f.calories || 0), 0);
        const bestCal = best.foods.reduce((s, f) => s + (f.calories || 0), 0);
        return (m.mealType === 'lunch' || (m.mealType !== 'lunch' && mCal > bestCal)) ? m : best;
      }, mainMeals[0]);
    }

    // PRIORITATE 1: mărește porțiile alimentelor deja existente în masă
    // (dacă masa are ou/legume și are deficit caloric, mărim ouăle sau legumele, nu adăugăm ovăz)
    // Pentru gustari: NICIODATĂ nu adaugăm ingrediente noi — doar mărim porțiile existente
    const isSnack = chosen.mealType === 'snack';
    for (const existingFood of chosen.foods) {
      const nd = await getNutritionForFiller(existingFood.name);
      if (!nd) continue;
      const macroFieldMap = { p: 'protein_per_100g', c: 'carbs_per_100g', f: 'fat_per_100g' };
      const macroPer100 = nd[macroFieldMap[macroKey]] || 0;
      if (macroPer100 < 5) continue; // nu mări alimente fără macro relevant
      const maxLimit = nd.max_amount_per_meal || getFoodMaxAmount({ name: nd.name }, dbLimits) || 300;
      const addAmt = roundToNearest5(Math.min(neededMacroGrams / (macroPer100 / 100), maxLimit - existingFood.amount));
      if (addAmt < 10) continue;
      const s = addAmt / 100;
      existingFood.amount   += addAmt;
      existingFood.calories += Math.round(nd.calories_per_100g   * s);
      existingFood.protein  += Math.round(nd.protein_per_100g    * s);
      existingFood.carbs    += Math.round(nd.carbs_per_100g      * s);
      existingFood.fat      += Math.round(nd.fat_per_100g        * s);
      return true;
    }

    // PRIORITATE 2: adaugă un filler contextual (compatibil cu masa)
    // Gustare: NICIODATĂ nu adaugăm ingrediente noi (max 2 ingrediente per gustare)
    if (isSnack) return false;

    const fillerNames = getFillersForMeal(chosen, category);
    const mealHasMeatOrFish = chosen.foods.some(f =>
      MEAT_FISH_KEYWORDS.some(kw => normalizeName(f.name).includes(kw))
    );
    const hasEggs = mealHasEggs(chosen);
    const hasHeavyCarb = mealHasHeavyCarb(chosen);

    for (const fillerName of fillerNames) {
      const nd = await getNutritionForFiller(fillerName);
      if (!nd) continue;

      const ndNorm = normalizeName(nd.name);

      // Filtrează alergenele
      if (allergyNorm.some(a => ndNorm.includes(a))) continue;
      // Filtrează carne/pește pentru vegetarieni/vegani
      if (isVegetarian && MEAT_FISH_KEYWORDS.some(kw => ndNorm.includes(kw))) continue;
      // Nu adăuga alt tip de carne/pește dacă masa are deja carne/pește
      if (mealHasMeatOrFish && MEAT_FISH_KEYWORDS.some(kw => ndNorm.includes(kw))) continue;
      // Dacă masa are ouă (omletă etc.), nu adăuga ovăz/orez/paste — sunt incompatibile
      if (hasEggs && INCOMPATIBLE_WITH_EGGS.some(kw => ndNorm.includes(kw))) continue;
      // Nu adăuga alt carbohidrat greu dacă masa are deja unul (evită orez + pâine în aceeași masă)
      if (hasHeavyCarb && HEAVY_CARB_KEYWORDS.some(kw => ndNorm.includes(kw))) {
        const alreadyHasThisCarb = chosen.foods.some(f => normalizeName(f.name).includes(ndNorm.split(' ')[0]));
        if (!alreadyHasThisCarb) continue; // nu adăuga altul, doar mărește pe cel existent
      }

      const macroFieldMap = { p: 'protein_per_100g', c: 'carbs_per_100g', f: 'fat_per_100g' };
      const macroPerG = (nd[macroFieldMap[macroKey]] || 0) / 100;
      if (macroPerG <= 0) continue;

      const calPer100 = nd.calories_per_100g || 0;
      const gramsNeeded = Math.min(neededMacroGrams / macroPerG, 150);
      const amount = roundToNearest5(gramsNeeded);
      if (amount < 10) continue;

      const maxLimit = nd.max_amount_per_meal || getFoodMaxAmount({ name: nd.name }, dbLimits) || 300;
      const existing = chosen.foods.find(f =>
        normalizeName(f.name).includes(normalizeName(nd.name).split(' ')[0])
      );

      if (existing) {
        const addAmt = Math.min(amount, maxLimit - existing.amount);
        if (addAmt <= 0) continue;
        const s = addAmt / 100;
        existing.amount   += addAmt;
        existing.calories += Math.round(calPer100              * s);
        existing.protein  += Math.round(nd.protein_per_100g   * s);
        existing.carbs    += Math.round(nd.carbs_per_100g     * s);
        existing.fat      += Math.round(nd.fat_per_100g       * s);
        return true;
      } else {
        const capped = Math.min(amount, maxLimit);
        const s = capped / 100;
        chosen.foods.push({
          name:     nd.name,
          amount:   capped,
          unit:     'g',
          calories: Math.round(calPer100            * s),
          protein:  Math.round(nd.protein_per_100g  * s),
          carbs:    Math.round(nd.carbs_per_100g    * s),
          fat:      Math.round(nd.fat_per_100g      * s),
        });
        return true;
      }
    }
    return false;
  };

  const getTotals = () => {
    let cal = 0, p = 0, c = 0, f = 0;
    day.meals.forEach(m => m.foods.forEach(food => {
      cal += food.calories || 0; p += food.protein || 0;
      c   += food.carbs    || 0; f += food.fat     || 0;
    }));
    return { cal, p, c, f };
  };

  const calUpperBound = targets.calories * (1 + TOLERANCES.calories);

  // 1. Proteină
  for (let i = 0; i < 6; i++) {
    const { p, cal } = getTotals();
    if (cal >= calUpperBound) break;
    const deficit = targets.protein * (1 - TOLERANCES.protein) - p;
    if (deficit <= 2) break;
    if (!await applyFiller('protein', deficit, 'p')) break;
  }

  // 2. Grăsimi
  for (let i = 0; i < 6; i++) {
    const { f, cal } = getTotals();
    if (cal >= calUpperBound) break;
    const deficit = targets.fat * (1 - TOLERANCES.fat) - f;
    if (deficit <= 2) break;
    if (!await applyFiller('fat', deficit, 'f')) break;
  }

  // 3. Carbohidrați
  for (let i = 0; i < 6; i++) {
    const { cal } = getTotals();
    const calDeficit = targets.calories * (1 - TOLERANCES.calories) - cal;
    if (calDeficit < 50) break;
    const maxCalToAdd = calUpperBound - cal;
    if (maxCalToAdd <= 0) break;
    const carbGramsNeeded = Math.min(calDeficit, maxCalToAdd) / 4;
    if (!await applyFiller('carb', carbGramsNeeded, 'c')) break;
  }
}

function adjustDayToTargets(day, targets) {

  let actualCal = 0, actualCarbs = 0, actualProtein = 0, actualFat = 0;

  day.meals.forEach(meal => {
    meal.foods.forEach(food => {
      actualCal     += food.calories || 0;
      actualCarbs   += food.carbs    || 0;
      actualProtein += food.protein  || 0;
      actualFat     += food.fat      || 0;
    });
  });

  const calFactor     = actualCal     > 0 ? targets.calories / actualCal     : 1;
  const proteinFactor = actualProtein > 0 ? targets.protein  / actualProtein : 1;
  const carbsFactor   = actualCarbs   > 0 ? targets.carbs    / actualCarbs   : 1;
  const fatFactor     = actualFat     > 0 ? targets.fat      / actualFat     : 1;

  day.meals.forEach(meal => {
    meal.foods.forEach(food => {
      // Gramajul se rotunjește la multiplu de 5
      food.amount   = roundToNearest5((food.amount   || 0) * calFactor);
      // Macros se rotunjesc normal
      food.calories = Math.round((food.calories || 0) * calFactor);
      food.protein  = Math.round((food.protein  || 0) * proteinFactor);
      food.carbs    = Math.round((food.carbs    || 0) * carbsFactor);
      food.fat      = Math.round((food.fat      || 0) * fatFactor);
    });
  });

  recalculateDayTotals(day);
  return day;
}

/**
 * Crește sursele de carbohidrați (și dacă e nevoie proteine) cu câte 10g pe rând
 * în mesele principale, până când totalul caloric zilnic ajunge în range-ul target ±5%.
 * Cache-uiește datele nutriționale la start pentru a evita apeluri DB repetate.
 */
async function boostCarbsToTarget(day, targets) {
  if (!day.meals) return;

  const CARB_KEYWORDS    = ['orez', 'paste', 'cartofi', 'paine', 'fulgi', 'quinoa', 'bulgur', 'malai', 'hrisca', 'couscous'];
  const PROTEIN_KEYWORDS = ['pui', 'curcan', 'vita', 'porc', 'somon', 'ton', 'cod', 'macrou', 'sardine', 'ou', 'naut', 'linte'];
  const calTarget = targets.calories;
  const calLower  = calTarget * (1 - TOLERANCES.calories); // -5%
  const calUpper  = calTarget * (1 + TOLERANCES.calories); // +5%

  const getDayCal = () => day.meals.reduce((s, m) =>
    s + (m.foods || []).reduce((ms, f) => ms + (f.calories || 0), 0), 0);

  try {
    // ── Pasul 1: Pre-cache date nutriționale pentru TOATE alimentele din mese ──
    const ndCache = {};
    for (const meal of day.meals) {
      if (meal.mealType === 'snack' || !meal.foods) continue;
      for (const food of meal.foods) {
        if (!ndCache[food.name]) {
          const nd = await getNutritionalData(food.name);
          if (nd) ndCache[food.name] = nd;
        }
      }
    }

    // Adaugă orez alb în cache dacă nu e deja (pentru fallback)
    if (!ndCache['Orez alb (crud)']) {
      const nd = await getNutritionalData('Orez alb (crud)');
      if (nd) ndCache['Orez alb (crud)'] = nd;
    }

    console.log(`[boostCarbsToTarget] Start: ${getDayCal()} kcal (target: ${calTarget}, lower: ${Math.round(calLower)})`);

    // ── Pasul 2: Boost carbohidrați 10g pe rând ──
    const MEAL_PRIORITY = ['lunch', 'dinner', 'breakfast'];

    for (let iter = 0; iter < 150; iter++) {
      const currentCal = getDayCal();
      if (currentCal >= calLower) break; // în range

      // Caută o sursă de carbo neblocată — prioritate prânz > cină > mic dejun
      let boosted = false;
      const sortedMeals = [...day.meals].sort((a, b) => {
        const ia = MEAL_PRIORITY.indexOf(a.mealType);
        const ib = MEAL_PRIORITY.indexOf(b.mealType);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      // Faza 1: crește carbo existente
      for (const meal of sortedMeals) {
        if (meal.mealType === 'snack' || !meal.foods) continue;
        for (const food of meal.foods) {
          const fn = normalizeName(food.name);
          if (!CARB_KEYWORDS.some(kw => fn.includes(kw))) continue;
          const nd = ndCache[food.name];
          if (!nd) continue;
          // Nu creşte alimente cu densitate calorică scăzută (legume, condimente etc.)
          if ((nd.calories_per_100g || 0) < 60) continue;
          const maxLimit = nd.max_amount_per_meal || 500;
          if ((food.amount || 0) >= maxLimit) continue;
          const actualAdd = Math.min(10, maxLimit - (food.amount || 0));
          if (actualAdd <= 0) continue;
          const s = actualAdd / 100;
          food.amount   = (food.amount   || 0) + actualAdd;
          food.calories = (food.calories || 0) + Math.round(nd.calories_per_100g * s);
          food.protein  = (food.protein  || 0) + Math.round(nd.protein_per_100g  * s);
          food.carbs    = (food.carbs    || 0) + Math.round(nd.carbs_per_100g    * s);
          food.fat      = (food.fat      || 0) + Math.round(nd.fat_per_100g      * s);
          boosted = true;
          break;
        }
        if (boosted) break;
      }

      // Faza 2: dacă nu găsim carbo existente cu spațiu, adaugă Orez alb (crud) la prânz/cină
      if (!boosted) {
        const targetMeal = sortedMeals.find(m => m.mealType === 'lunch' || m.mealType === 'dinner');
        if (targetMeal && ndCache['Orez alb (crud)']) {
          const nd  = ndCache['Orez alb (crud)'];
          const existing = (targetMeal.foods || []).find(f => normalizeName(f.name).includes('orez'));
          const maxLimit  = nd.max_amount_per_meal || 120;
          if (existing && (existing.amount || 0) < maxLimit) {
            const s = 10 / 100;
            existing.amount   = (existing.amount   || 0) + 10;
            existing.calories = (existing.calories || 0) + Math.round(nd.calories_per_100g * s);
            existing.protein  = (existing.protein  || 0) + Math.round(nd.protein_per_100g  * s);
            existing.carbs    = (existing.carbs    || 0) + Math.round(nd.carbs_per_100g    * s);
            existing.fat      = (existing.fat      || 0) + Math.round(nd.fat_per_100g      * s);
            boosted = true;
          } else if (!existing) {
            const deficit2 = calTarget - getDayCal();
            const initGrams = Math.min(Math.ceil(deficit2 / nd.calories_per_100g * 100 / 10) * 10, maxLimit);
            if (initGrams > 0) {
              const s = initGrams / 100;
              targetMeal.foods.push({
                name:     nd.name,
                amount:   initGrams,
                unit:     'g',
                calories: Math.round(nd.calories_per_100g * s),
                protein:  Math.round(nd.protein_per_100g  * s),
                carbs:    Math.round(nd.carbs_per_100g    * s),
                fat:      Math.round(nd.fat_per_100g      * s),
              });
              boosted = true;
            }
          }
        }
      }

      // Faza 3 (ultimă resursă): crește proteinele existente dacă carbo sunt maxate
      if (!boosted) {
        for (const meal of sortedMeals) {
          if (meal.mealType === 'snack' || !meal.foods) continue;
          for (const food of meal.foods) {
            const fn = normalizeName(food.name);
            if (!PROTEIN_KEYWORDS.some(kw => fn.includes(kw))) continue;
            const nd = ndCache[food.name];
            if (!nd) continue;
            const maxLimit = nd.max_amount_per_meal || 300;
            if ((food.amount || 0) >= maxLimit) continue;
            const actualAdd = Math.min(10, maxLimit - (food.amount || 0));
            if (actualAdd <= 0) continue;
            const s = actualAdd / 100;
            food.amount   = (food.amount   || 0) + actualAdd;
            food.calories = (food.calories || 0) + Math.round(nd.calories_per_100g * s);
            food.protein  = (food.protein  || 0) + Math.round(nd.protein_per_100g  * s);
            food.carbs    = (food.carbs    || 0) + Math.round(nd.carbs_per_100g    * s);
            food.fat      = (food.fat      || 0) + Math.round(nd.fat_per_100g      * s);
            boosted = true;
            break;
          }
          if (boosted) break;
        }
      }

      if (!boosted) {
        console.warn(`[boostCarbsToTarget] Nu mai există surse de crescut la iter ${iter}. Oprire.`);
        break;
      }
    }
  } catch (err) {
    console.error('[boostCarbsToTarget] Eroare:', err.message);
  }

  recalculateDayTotals(day);
  const finalCal = day.dailyTotals.calories;
  console.log(`[boostCarbsToTarget] Final: ${finalCal} kcal (target: ${calTarget}, range: ${Math.round(calLower)}-${Math.round(calUpper)})`);
}

function recalculateDayTotals(day) {
  let dayCal = 0, dayP = 0, dayC = 0, dayF = 0;

  if (!day.meals) return;

  day.meals.forEach((meal) => {
    let mealCal = 0, mealP = 0, mealC = 0, mealF = 0;

    if (meal.foods && Array.isArray(meal.foods)) {
      meal.foods.forEach((food) => {
        mealCal += food.calories || 0;
        mealP   += food.protein  || 0;
        mealC   += food.carbs    || 0;
        mealF   += food.fat      || 0;
      });
    }

    // Totalurile meselor și zilei se rotunjesc normal
    meal.mealTotals = {
      calories: Math.round(mealCal),
      protein:  Math.round(mealP),
      carbs:    Math.round(mealC),
      fat:      Math.round(mealF),
    };

    dayCal += mealCal;
    dayP   += mealP;
    dayC   += mealC;
    dayF   += mealF;
  });

  day.dailyTotals = {
    calories: Math.round(dayCal),
    protein:  Math.round(dayP),
    carbs:    Math.round(dayC),
    fat:      Math.round(dayF),
  };
}

function calculateTargetCalories(clientData) {
  const weight = parseFloat(clientData.weight);
  const height = parseFloat(clientData.height);
  const age    = parseFloat(clientData.age);
  const gender = clientData.gender;
  const activityLevel = clientData.activityLevel;

  let bmr;
  if (gender === 'M') {
    bmr = 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age;
  } else {
    bmr = 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age;
  }

  const activityMultipliers = {
    sedentary:   1.2,
    light:       1.375,
    moderate:    1.55,
    very_active: 1.725,
  };

  const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);

  const goalAdjustments = {
    weight_loss:   0.85,
    muscle_gain:   1.1,
    maintenance:   1.0,
    recomposition: 0.95,
  };

  return Math.round(tdee * (goalAdjustments[clientData.goal] || 1.0));
}

function getMacroSplit(goal) {
  // Grăsimi: 1g/kg corp pentru toate obiectivele
  const splits = {
    weight_loss:   { proteinPerKg: 2.25, fatPerKg: 1.0 },
    muscle_gain:   { proteinPerKg: 1.9,  fatPerKg: 1.0 },
    maintenance:   { proteinPerKg: 1.9,  fatPerKg: 1.0 },
    recomposition: { proteinPerKg: 2.25, fatPerKg: 1.0 },
  };
  return splits[goal] || splits.maintenance;
}

function calculateMacros(goal, weightKg, targetCalories) {
  const split = getMacroSplit(goal);

  const proteinGrams = Math.round(split.proteinPerKg * weightKg);
  const fatGrams     = Math.round(split.fatPerKg * weightKg);

  const proteinCalories   = proteinGrams * 4;
  const fatCalories       = fatGrams * 9;
  const remainingCalories = targetCalories - proteinCalories - fatCalories;
  const carbsGrams        = Math.round(Math.max(remainingCalories, 0) / 4);

  return { protein: proteinGrams, carbs: carbsGrams, fat: fatGrams };
}

function getGoalLabel(goal) {
  const labels = {
    weight_loss:   'Slăbit',
    muscle_gain:   'Creștere masă musculară',
    maintenance:   'Menținere',
    recomposition: 'Recompoziție corporală',
  };
  return labels[goal] || 'Menținere';
}

function getDietLabel(diet) {
  const labels = {
    omnivore:   'Omnivor',
    vegetarian: 'Vegetarian',
    vegan:      'Vegan',
  };
  return labels[diet] || 'Omnivor';
}

function getMealDistribution(mealsPerDay) {
  // Ordinea FIXA: Mic Dejun → Gustare 1 → Prânz → Gustare 2 → Cină
  // Folosim array de perechi pentru a garanta ordinea la iterare
  const distributions = {
    3: [['Mic Dejun', 0.30], ['Prânz', 0.40], ['Cină', 0.30]],
    4: [['Mic Dejun', 0.25], ['Gustare 1', 0.15], ['Prânz', 0.35], ['Cină', 0.25]],
    5: [['Mic Dejun', 0.20], ['Gustare 1', 0.15], ['Prânz', 0.30], ['Gustare 2', 0.15], ['Cină', 0.20]],
  };
  return distributions[mealsPerDay] || distributions[3];
}

/**
 * Ajustare macro la nivel de ZI — simplu, robust, production-ready.
 *
 * 1. Scalează sursele de PROTEINE (toate mesele) → atingere target proteină
 * 2. Scalează sursele de GRĂSIMI DENSE (toate mesele) → atingere target grăsimi
 * 3. Scalează sursele de CARBOHIDRAȚI (toate mesele) → atingere target caloric rezidual
 * Repetă max 6 cicluri. NU scalează legume/fructe.
 */
function adjustDayTotals(day, targets, _mealMacroTargets, _foodsMap, maxGramsMap) {
  if (!day.meals) return;
  const MG = maxGramsMap || BASE_MAX_GRAMS_BY_CATEGORY;
  recalculateDayTotals(day);

  const MAX = {
    protein:   Math.max(MG.protein  || 250, 150),
    fat_dense: Math.max(MG.fats     || 20,   20),
    carb:      Math.max(MG.grains   || 100, 100),   // max 100g orez/paste crud per masă — surplusul merge la gustări
    mixed:     Math.max(MG.dairy    || 300, 200),
    default:   Math.max(MG.default  || 250, 150),
  };

  const classify = (food) => {
    const cal  = Math.max(food.calories || 1, 1);
    const amt  = Math.max(food.amount   || 100, 1);
    const f100 = (food.fat     || 0) / amt * 100;
    const p100 = (food.protein || 0) / amt * 100;
    const c100 = (food.carbs   || 0) / amt * 100;
    const fPct = (food.fat     || 0) * 9 / cal;
    const pPct = (food.protein || 0) * 4 / cal;
    const cPct = (food.carbs   || 0) * 4 / cal;
    if (f100 >= 40 || (f100 >= 15 && fPct >= 0.45)) return 'fat_dense';
    if (cal / amt * 100 < 60 && p100 < 8)           return 'vegetable';
    if (p100 >= 15 && pPct >= 0.35)                  return 'protein';
    if (c100 >= 30 && cPct >= 0.50)                  return 'carb';
    return 'mixed';
  };

  const allFoods = () => day.meals.flatMap(m => m.foods || []);

  // Alimentele din mesele principale (mic dejun, prânz, cină) — gustarile NU se scalează
  const mainFoods = () => day.meals
    .filter(m => m.mealType !== 'snack')
    .flatMap(m => m.foods || []);

  const totals = () => {
    let cal = 0, p = 0, f = 0, c = 0;
    for (const fd of allFoods()) { cal+=fd.calories||0; p+=fd.protein||0; f+=fd.fat||0; c+=fd.carbs||0; }
    return { cal, p, f, c };
  };

  const scaleByRole = (role, factor) => {
    const sf = Math.max(0.05, Math.min(6.0, factor));
    if (Math.abs(sf - 1) < 0.015) return;
    for (const fd of allFoods()) {
      if (classify(fd) !== role) continue;
      const maxG   = MAX[role] || MAX.default;
      const newAmt = roundToNearest5(Math.max(Math.min(fd.amount * sf, maxG), 5));
      if (newAmt === fd.amount) continue;
      const s = newAmt / fd.amount;
      fd.amount   = newAmt;
      fd.calories = Math.round((fd.calories || 0) * s);
      fd.protein  = Math.round((fd.protein  || 0) * s);
      fd.carbs    = Math.round((fd.carbs    || 0) * s);
      fd.fat      = Math.round((fd.fat      || 0) * s);
    }
  };

  console.log(`[adj] Ziua ${day.day} START: ${totals().cal}kcal P${totals().p}g F${totals().f}g → targets: ${targets.calories}kcal P${targets.protein}g F${targets.fat}g`);

  for (let cycle = 0; cycle < 6; cycle++) {
    const t0 = totals();
    const pOk  = Math.abs(t0.p   - targets.protein)  / Math.max(targets.protein,  1) <= TOLERANCES.protein;
    const fOk  = Math.abs(t0.f   - targets.fat)       / Math.max(targets.fat,      1) <= TOLERANCES.fat;
    const calOk= Math.abs(t0.cal - targets.calories)  / Math.max(targets.calories, 1) <= TOLERANCES.calories;
    if (pOk && fOk && calOk) break;

    // Pas 1: Proteine — scalează protein + mixed din mesele PRINCIPALE
    if (!pOk) {
      const t = totals();
      const scalableP = mainFoods()
        .filter(fd => classify(fd)==='protein'||classify(fd)==='mixed')
        .reduce((s,fd)=>s+(fd.protein||0), 0);
      if (scalableP > 1) {
        const neededP = targets.protein - (t.p - scalableP);
        if (neededP > 0) { scaleByRole('protein', neededP/scalableP); scaleByRole('mixed', neededP/scalableP); }
      }
    }

    // Pas 2: Grăsimi — scalează fat_dense din mesele PRINCIPALE (nuci/semințe la gustare nu se ating)
    if (!fOk) {
      const t = totals();
      const scalableF = mainFoods()
        .filter(fd => classify(fd)==='fat_dense')
        .reduce((s,fd)=>s+(fd.fat||0), 0);
      if (scalableF > 0) {
        const neededF = targets.fat - (t.f - scalableF);
        scaleByRole('fat_dense', neededF > 0 ? neededF/scalableF : 0.1);
      }
    }

    // Pas 3: Calorii — scalează alimentele non-proteice non-lipidice din mesele PRINCIPALE
    // Gustarile rămân la gramajele fixate de scaleRecipeToTarget
    {
      const t = totals();
      if (Math.abs(t.cal - targets.calories) / Math.max(targets.calories, 1) > TOLERANCES.calories) {
        const scalableFoods = mainFoods().filter(fd => {
          const role = classify(fd);
          return role !== 'protein' && role !== 'fat_dense';
        });
        const scalableCal = scalableFoods.reduce((s,fd)=>s+(fd.calories||0), 0);
        if (scalableCal > 0) {
          // Calorii fixe = proteine + grăsimi (deja la target)
          const fixedCal   = t.cal - scalableCal;
          const neededCal  = targets.calories - fixedCal;
          if (neededCal > 0) {
            const sf = neededCal / scalableCal;
            // Aplică factorul per rol cu limita corespunzătoare
            const roleLimits = {
              carb:      MAX.carb,
              mixed:     MAX.mixed,
              vegetable: 400,    // legume — mai generos
              default:   MAX.default,
            };
            const sfClamped = Math.max(0.1, Math.min(4.0, sf));
            for (const fd of scalableFoods) {
              const role   = classify(fd);
              const maxG   = roleLimits[role] || roleLimits.default;
              const newAmt = roundToNearest5(Math.max(Math.min(fd.amount * sfClamped, maxG), 5));
              if (newAmt === fd.amount) continue;
              const s = newAmt / fd.amount;
              fd.amount   = newAmt;
              fd.calories = Math.round((fd.calories || 0) * s);
              fd.protein  = Math.round((fd.protein  || 0) * s);
              fd.carbs    = Math.round((fd.carbs    || 0) * s);
              fd.fat      = Math.round((fd.fat      || 0) * s);
            }
          } else if (neededCal < 0) {
            // Surplus caloric — reduce proporțional toate alimentele scalabile
            const sf = Math.max(0.3, neededCal / scalableCal);
            for (const fd of scalableFoods) {
              const newAmt = roundToNearest5(Math.max(fd.amount * sf, 5));
              if (newAmt === fd.amount) continue;
              const s = newAmt / fd.amount;
              fd.amount   = newAmt;
              fd.calories = Math.round((fd.calories || 0) * s);
              fd.protein  = Math.round((fd.protein  || 0) * s);
              fd.carbs    = Math.round((fd.carbs    || 0) * s);
              fd.fat      = Math.round((fd.fat      || 0) * s);
            }
          }
        }
      }
    }
  }

  recalculateDayTotals(day);
  const t = day.dailyTotals;
  const cE = Math.round(Math.abs(t.calories-targets.calories)/Math.max(targets.calories,1)*100);
  const pE = Math.round(Math.abs(t.protein -targets.protein) /Math.max(targets.protein, 1)*100);
  const fE = Math.round(Math.abs(t.fat     -targets.fat)     /Math.max(targets.fat,     1)*100);
  console.log(`[adj] Ziua ${day.day} FINAL: ${t.calories}/${targets.calories}kcal(±${cE}%) P${t.protein}/${targets.protein}g(±${pE}%) F${t.fat}/${targets.fat}g(±${fE}%)`);
}