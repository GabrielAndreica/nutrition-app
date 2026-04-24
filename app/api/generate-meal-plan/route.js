import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { checkRateLimit, requestQueue, generateRequestId } from '@/app/lib/rateLimiter';
import { cachedCalculateCalories, cachedCalculateMacros, getCachedMealDistribution } from '@/app/lib/nutritionCache';
import { sanitizeText, sanitizeFoodRestrictions, sanitizeFoodPreferences, sanitizeNumber } from '@/app/lib/sanitize';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache pentru alimentele din baza de date (se reîmprospătează la fiecare 5 minute)
let foodsCache = null;
let foodsCacheTimestamp = 0;
const FOODS_CACHE_TTL = 5 * 60 * 1000; // 5 minute

// Cache rețete
let recipesCache = null;
let recipesCacheTimestamp = 0;

// Map: nume slot masă → meal_type din tabelul recipes
const DISPLAY_TO_MEAL_TYPE = {
  'Mic dejun': 'breakfast',
  'Gustare 1': 'snack',
  'Gustare 2': 'snack',
  'Prânz':     'lunch',
  'Cină':      'dinner',
};

// Capuri maxime pe categorii (gramaj per ingredient per masă)
const MAX_GRAMS_BY_CATEGORY = {
  meat:       150, // 150g carne — restul proteinei din lactate/ouă
  fish:       150, // la fel
  eggs:       120, // ~2 ouă 
  dairy:      150,
  grains:      70, // 70g crude = ~200g fiert — realist
  legumes:     80,
  starch:     150,
  vegetables: 150,
  fruits:     150,
  nuts:        30,
  fats:        12,
  other:       80,
};

/**
 * Normalizează un string pentru căutare în foodsMap:
 * lowercase + fără diacritice + elimină calificatoare (crud), (fiert), etc.
 */
function normalizeKey(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[ăâ]/g, 'a')
    .replace(/î/g, 'i')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // elimină (crud), (fiert), (0%), etc.
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Încarcă alimentele din Supabase, filtrate după tipul de dietă și alergii
 * @param {string} dietType - 'omnivore', 'vegetarian', 'vegan'
 * @param {string} allergiesText - text cu alergii separate prin virgulă
 * @returns {Promise<Array>} - lista de alimente filtrate
 */
async function loadFoodsFromSupabase(dietType = 'omnivore', allergiesText = '') {
  const now = Date.now();
  
  // Verifică dacă cache-ul e valid
  if (foodsCache && (now - foodsCacheTimestamp) < FOODS_CACHE_TTL) {
    return filterFoods(foodsCache, dietType, allergiesText);
  }
  const supabase = getSupabase();
  const { data: foods, error } = await supabase
    .from('foods')
    .select('name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal')
    .eq('is_active', true)
    .order('category')
    .order('name');
  
  if (error) {
    console.error('Eroare la încărcarea alimentelor din Supabase:', error.message);
    return [];
  }
  
  // Actualizează cache-ul
  foodsCache = foods;
  foodsCacheTimestamp = now;
  
  return filterFoods(foods, dietType, allergiesText);
}

/**
 * Filtrează alimentele după tipul de dietă și alergii
 */
function filterFoods(foods, dietType, allergiesText) {
  // Parsează alergiile din text
  const allergyKeywords = allergiesText
    ? allergiesText.toLowerCase().split(/[,;\s]+/).filter(a => a.trim())
    : [];
  
  return foods.filter(food => {
    // Verifică dacă alimentul e compatibil cu dieta
    if (!food.diet_types.includes(dietType)) {
      return false;
    }
    
    // Verifică dacă alimentul conține alergeni
    if (allergyKeywords.length > 0 && food.allergens && food.allergens.length > 0) {
      const hasAllergen = food.allergens.some(allergen => 
        allergyKeywords.some(keyword => 
          allergen.toLowerCase().includes(keyword) || keyword.includes(allergen.toLowerCase())
        )
      );
      if (hasAllergen) return false;
    }
    
    return true;
  });
}

/**
 * Încarcă rețetele din Supabase, filtrate după tipul de dietă
 */
async function loadRecipesFromSupabase(dietType = 'omnivore') {
  const now = Date.now();
  if (recipesCache && (now - recipesCacheTimestamp) < FOODS_CACHE_TTL) {
    return filterRecipes(recipesCache, dietType);
  }
  const supabase = getSupabase();
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('id, name, meal_type, diet_types, protein_source, preparation, ingredients')
    .order('meal_type')
    .order('name');
  if (error) {
    console.error('Eroare la încărcarea rețetelor din Supabase:', error.message);
    return [];
  }
  recipesCache = recipes;
  recipesCacheTimestamp = now;
  return filterRecipes(recipes, dietType);
}

function filterRecipes(recipes, dietType) {
  return recipes.filter(r => Array.isArray(r.diet_types) && r.diet_types.includes(dietType));
}

/**
 * Generează contextul text al rețetelor disponibile pentru GPT (grupate pe tip masă)
 */
function buildRecipesContext(recipes, mealSlots) {
  const usedTypes = new Set(mealSlots.map(slot => DISPLAY_TO_MEAL_TYPE[slot] || 'lunch'));
  const byType = { breakfast: [], lunch: [], dinner: [], snack: [] };
  recipes.forEach(r => { if (byType[r.meal_type]) byType[r.meal_type].push(r); });
  const typeLabels = { breakfast: 'MIC DEJUN', lunch: 'PRÂNZ', dinner: 'CINĂ', snack: 'GUSTARE' };
  let ctx = '';
  for (const mealType of usedTypes) {
    ctx += `\n=== ${typeLabels[mealType] || mealType.toUpperCase()} ===\n`;
    (byType[mealType] || []).forEach(r => {
      ctx += `[${r.id}] ${r.name} (proteină: ${r.protein_source || 'mixed'})\n`;
    });
  }
  return ctx;
}

/**
 * Scalează o rețetă la un număr țintă de calorii folosind ratio_pct per ingredient.
 * Gramaj ingredient = (targetCalories × ratio_pct) / (calorii_per_100g / 100)
 */
// Categorii de garnish — cantități fixe (nu se scalează cu caloriile targetate)
// Legumele/fructele au densitate calorică mică (18-40kcal/100g) → scalarea calorică produce gramaje absurde
const GARNISH_CATEGORIES = new Set(['vegetables', 'fruits']);

/**
 * Returnează gramajul fix pentru un ingredient de garnish, bazat pe ratio_pct.
 * Nu se scalează cu targetul caloric.
 */
function getGarnishBaseGrams(ratioPct, maxGrams) {
  // ratio_pct → ghidează proporția relativă, nu cantitatea absolută
  let base;
  if (ratioPct <= 0.05)      base = 60;
  else if (ratioPct <= 0.10) base = 100;
  else if (ratioPct <= 0.15) base = 130;
  else                       base = 150;
  return roundToNearest5(Math.min(base, maxGrams));
}

function scaleRecipeToCalories(recipe, targetCalories, foodsMap) {
  const garnishItems = [];
  const mainItems = [];

  for (const ing of (recipe.ingredients || [])) {
    const food = foodsMap[ing.food_name] || foodsMap[normalizeKey(ing.food_name)];
    if (!food || !food.calories_per_100g) continue;
    const entry = { food, ratio: ing.ratio_pct };
    if (GARNISH_CATEGORIES.has(food.category)) garnishItems.push(entry);
    else mainItems.push(entry);
  }

  // Pas 1: stabilesc cantitățile fixe pentru garnish (legume/fructe)
  let garnishCalTotal = 0;
  const garnishFoods = garnishItems.map(({ food, ratio }) => {
    const maxGrams = food.max_amount_per_meal || MAX_GRAMS_BY_CATEGORY[food.category] || 150;
    const grams = getGarnishBaseGrams(ratio, maxGrams);
    garnishCalTotal += food.calories_per_100g * grams / 100;
    return { food, grams };
  });

  // Pas 2: distribui caloriile rămase ingredientelor principale (proteină, cereale, grăsimi)
  const remainingCal = Math.max(targetCalories - garnishCalTotal, targetCalories * 0.5);
  const mainRatioSum = mainItems.reduce((s, i) => s + i.ratio, 0) || 1;

  // Primul sub-pas: calculează gramajele fără capuri
  const mainFoodsRaw = mainItems.map(({ food, ratio }) => {
    const myCal  = remainingCal * (ratio / mainRatioSum);
    const gramsRaw = myCal / (food.calories_per_100g / 100);
    return { food, ratio, gramsRaw };
  });

  // Al doilea sub-pas: aplică capuri + redistribuie deficitul către ingredientele necăpățite
  let cappedCal = 0;
  let uncappedRatioSum = 0;
  const mainFoodsIntermediate = mainFoodsRaw.map(item => {
    const maxGrams = item.food.max_amount_per_meal || MAX_GRAMS_BY_CATEGORY[item.food.category] || 300;
    if (item.gramsRaw > maxGrams) {
      cappedCal += maxGrams * item.food.calories_per_100g / 100;
      return { ...item, grams: maxGrams, capped: true };
    }
    uncappedRatioSum += item.ratio;
    return { ...item, capped: false };
  });

  const redistributeCal = remainingCal - cappedCal;
  const mainFoods = mainFoodsIntermediate.map(item => {
    if (item.capped) return { food: item.food, grams: item.grams };
    const maxGrams = item.food.max_amount_per_meal || MAX_GRAMS_BY_CATEGORY[item.food.category] || 300;
    const myCal    = uncappedRatioSum > 0 ? redistributeCal * (item.ratio / uncappedRatioSum) : 0;
    const gramsRaw = myCal / (item.food.calories_per_100g / 100);
    return { food: item.food, grams: Math.min(Math.max(5, gramsRaw), maxGrams) };
  });

  // Construiește lista finală de ingrediente
  const foods = [];
  for (const { food, grams } of [...mainFoods, ...garnishFoods]) {
    const g = roundToNearest5(grams);
    const factor = g / 100;
    foods.push({
      name:      food.name,
      amount:    g,
      unit:      'g',
      calories:  Math.round(food.calories_per_100g * factor),
      protein:   Math.round((food.protein_per_100g  || 0) * factor),
      carbs:     Math.round((food.carbs_per_100g    || 0) * factor),
      fat:       Math.round((food.fat_per_100g      || 0) * factor),
      _category: food.category,
      // Densitate per gram — necesar pentru ajustări precise de macro în adjustDayToTargets
      _calPerG:  food.calories_per_100g / 100,
      _protPerG: (food.protein_per_100g  || 0) / 100,
      _carbPerG: (food.carbs_per_100g    || 0) / 100,
      _fatPerG:  (food.fat_per_100g      || 0) / 100,
    });
  }
  return {
    mealType:    recipe.name,
    preparation: recipe.preparation || '',
    foods,
    mealTotals: {
      calories: foods.reduce((s, f) => s + f.calories, 0),
      protein:  foods.reduce((s, f) => s + f.protein,  0),
      carbs:    foods.reduce((s, f) => s + f.carbs,    0),
      fat:      foods.reduce((s, f) => s + f.fat,      0),
    },
  };
}

/**
 * Calculează ajustarea calorică în funcție de rata reală de schimbare a greutății.
 *
 * Principiu: ajustarea e proporțională cu abaterea față de intervalul optim.
 * 1 kg ≈ 7700 kcal; o abatere de ~0.5%/săptămână față de optim → ~100-150 kcal diferență.
 *
 * @param {'weight_loss'|'muscle_gain'|'maintenance'} goal
 * @param {number} weightChangePercent - schimbarea greutății în % față de greutatea inițială
 * @returns {{ adjustment: number, reason: string }}
 */
function calculateCalorieAdjustment(goal, weightChangePercent, weekNumber = 99) {
  const pct = weightChangePercent; // alias scurt

  if (goal === 'weight_loss') {
    const isEarlyCut = weekNumber <= 2;
    if (isEarlyCut) {
      if (pct >= 1.0)  return { adjustment: -350, reason: 'Creștere rapidă în greutate (+≥1%) — deficit caloric mare necesar.' };
      if (pct >= 0.5)  return { adjustment: -275, reason: 'Creștere moderată (+0.5…1%) — deficit caloric semnificativ.' };
      if (pct >= 0.0)  return { adjustment: -200, reason: 'Greutate stabilă sau ușor crescută — deficit caloric moderat.' };
      if (pct >= -0.2) return { adjustment: -150, reason: 'Pierdere foarte lentă (0…0.2%) — deficit ușor crescut.' };
      if (pct >= -2.5) return { adjustment:    0, reason: `Săpt. ${weekNumber} de cut — pierdere rapidă (${Math.abs(pct).toFixed(1)}%) e normală în faza inițială (apă + glicogen). Planul se menține.` };
      if (pct >= -3.5) return { adjustment: +150, reason: `Săpt. ${weekNumber} de cut — pierdere foarte rapidă (${Math.abs(pct).toFixed(1)}%) chiar și în faza inițială — creștere moderată de calorii.` };
      return              { adjustment: +250, reason: `Săpt. ${weekNumber} de cut — pierdere extremă (${Math.abs(pct).toFixed(1)}%) — creștere importantă de calorii.` };
    }
    // Săpt. 3+: interval normal -0.2% … -1.0%
    if (pct >= 1.0)  return { adjustment: -350, reason: 'Creștere rapidă în greutate (+≥1%) — deficit caloric mare necesar.' };
    if (pct >= 0.5)  return { adjustment: -275, reason: 'Creștere moderată (+0.5…1%) — deficit caloric semnificativ.' };
    if (pct >= 0.0)  return { adjustment: -200, reason: 'Greutate stabilă sau ușor crescută — deficit caloric moderat.' };
    if (pct >= -0.2) return { adjustment: -150, reason: 'Pierdere foarte lentă (0…0.2%) — deficit ușor crescut.' };
    if (pct >= -1.3) return { adjustment: +100, reason: 'Pierdere ușor prea rapidă (1.0…1.3%) — creștere mică de calorii.' };
    if (pct >= -1.8) return { adjustment: +175, reason: 'Pierdere rapidă (1.3…1.8%) — creștere moderată de calorii.' };
    if (pct >= -2.5) return { adjustment: +250, reason: 'Pierdere foarte rapidă (1.8…2.5%) — creștere importantă de calorii.' };
    return              { adjustment: +325, reason: `Pierdere extremă (>${Math.abs(pct).toFixed(1)}%) — creștere mare de calorii pentru a preveni catabolismul.` };
  }

  if (goal === 'muscle_gain') {
    const isEarlyBulk = weekNumber <= 2;
    if (isEarlyBulk) {
      if (pct <= -0.5) return { adjustment: +300, reason: 'Pierdere în greutate pe masă (≤-0.5%) — surplus caloric mare necesar.' };
      if (pct <= 0.0)  return { adjustment: +225, reason: 'Greutate stabilă sau ușor scăzută pe masă — surplus caloric semnificativ.' };
      if (pct <= 0.25) return { adjustment: +150, reason: 'Creștere prea lentă (0…0.25%) — surplus caloric moderat.' };
      if (pct <= 1.5)  return { adjustment:    0, reason: `Săpt. ${weekNumber} de bulk — creștere rapidă (${pct.toFixed(1)}%) e normală în faza inițială (glicogen + apă). Planul se menține.` };
      if (pct <= 2.0)  return { adjustment: -125, reason: `Săpt. ${weekNumber} de bulk — creștere excesivă (${pct.toFixed(1)}%) chiar și în faza inițială — reducere mică de calorii.` };
      return              { adjustment: -200, reason: `Săpt. ${weekNumber} de bulk — creștere extremă (${pct.toFixed(1)}%) — reducere importantă de calorii.` };
    }
    // Săpt. 3+: interval normal +0.25% … +0.5%
    if (pct <= -0.5) return { adjustment: +300, reason: 'Pierdere în greutate pe masă (≤-0.5%) — surplus caloric mare necesar.' };
    if (pct <= 0.0)  return { adjustment: +225, reason: 'Greutate stabilă sau ușor scăzută pe masă — surplus caloric semnificativ.' };
    if (pct <= 0.25) return { adjustment: +150, reason: 'Creștere prea lentă (0…0.25%) — surplus caloric moderat.' };
    if (pct <= 0.75) return { adjustment: -100, reason: 'Creștere ușor prea rapidă (0.5…0.75%) — reducere mică de calorii.' };
    if (pct <= 1.0)  return { adjustment: -150, reason: 'Creștere rapidă (0.75…1%) — reducere moderată pentru a controla grăsimea.' };
    return              { adjustment: -200, reason: `Creștere excesivă (>${pct.toFixed(1)}%) — reducere semnificativă pentru a limita acumularea de grăsime.` };
  }

  if (goal === 'maintenance') {
    if (pct >= 1.0)  return { adjustment: -225, reason: 'Creștere rapidă în greutate (≥1%) pe menținere.' };
    if (pct >= 0.5)  return { adjustment: -175, reason: 'Creștere moderată (0.5…1%) pe menținere.' };
    if (pct >= 0.3)  return { adjustment: -100, reason: 'Ușoară creștere (0.3…0.5%) pe menținere.' };
    // Interval optim: -0.3% … +0.3%
    if (pct >= -0.5) return { adjustment: +100, reason: 'Ușoară scădere (0.3…0.5%) pe menținere.' };
    if (pct >= -1.0) return { adjustment: +175, reason: 'Scădere moderată (0.5…1%) pe menținere.' };
    return              { adjustment: +225, reason: `Scădere rapidă (>${Math.abs(pct).toFixed(1)}%) pe menținere.` };
  }

  return { adjustment: 0, reason: 'Obiectiv necunoscut — fără ajustare.' };
}

/**
 * Generează contextul cu alimentele pentru prompt
 */
function generateFoodsContext(foods) {
  if (!foods || foods.length === 0) {
    return 'Nu există alimente disponibile în baza de date.';
  }
  
  // Grupează alimentele pe categorii
  const categories = {
    meat: 'CARNE',
    fish: 'PEȘTE ȘI FRUCTE DE MARE',
    eggs: 'OUĂ',
    dairy: 'LACTATE',
    grains: 'CEREALE',
    starch: 'AMIDON (CARTOFI)',
    legumes: 'LEGUMINOASE',
    vegetables: 'LEGUME',
    fruits: 'FRUCTE',
    nuts: 'NUCI ȘI SEMINȚE',
    fats: 'ULEIURI ȘI GRĂSIMI',
    other: 'ALTELE'
  };
  
  const grouped = {};
  foods.forEach(food => {
    const cat = food.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(food);
  });
  
  let context = '';
  for (const [catKey, catName] of Object.entries(categories)) {
    if (grouped[catKey] && grouped[catKey].length > 0) {
      context += `\n── ${catName} ──\n`;
      grouped[catKey].forEach(food => {
        const maxNote = food.max_amount_per_meal ? ` [MAX ${food.max_amount_per_meal}g per masă]` : '';
        context += `- ${food.name}: ${food.calories_per_100g} kcal, ${food.protein_per_100g}g P, ${food.carbs_per_100g}g C, ${food.fat_per_100g}g G per 100g${maxNote}\n`;
      });
    }
  }
  
  return context;
}

// Funcție pentru sanitizarea textului înainte de trimitere la OpenAI
function sanitizeForPrompt(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .trim();
}

// Configurare pentru generare paralelă
const PARALLEL_CONFIG = {
  // Numărul de zile generate în paralel (2-3 e optim pentru OpenAI rate limits)
  PARALLEL_DAYS: 2,
  // Timeout per zi (ms)
  DAY_TIMEOUT_MS: 30000,
  // Retry attempts per zi
  MAX_RETRIES: 2,
};

export async function POST(request) {
  const supabase = getSupabase();
  const requestId = generateRequestId();
  
  try {
    const auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (auth.role !== 'trainer') {
      return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
    }

    // ─── Database Rate Limiting (PRIORITATE - previne abuse) ────
    try {
      const { data: rateLimitResult, error: rateLimitError } = await supabase
        .rpc('check_rate_limit', {
          p_user_id: String(auth.userId),  // Convert to TEXT for DB
          p_endpoint: 'generate-meal-plan',
          p_max_requests: 10,  // Max 10 planuri per oră
          p_window_minutes: 60
        });

      if (rateLimitError) {
        console.error('Eroare la verificare rate limit:', rateLimitError);
        // Continuă execuția - nu blocăm pentru erori de rate limit
      } else if (rateLimitResult && rateLimitResult.length > 0) {
        const { allowed, remaining, reset_at } = rateLimitResult[0];
        
        if (!allowed) {
          const resetDate = new Date(reset_at);
          const minutesRemaining = Math.ceil((resetDate - new Date()) / 60000);
          
          await logActivity({
            action: 'meal_plan.generate',
            status: 'rate_limited',
            userId: auth.userId,
            email: auth.email,
            details: { reset_at, remaining: 0 }
          });
          
          return NextResponse.json(
            { 
              error: `Ai atins limita de 10 planuri pe oră. Poți genera un nou plan în ${minutesRemaining} minute.`,
              retryAfter: minutesRemaining * 60
            },
            { 
              status: 429,
              headers: { 
                'Retry-After': String(minutesRemaining * 60),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': reset_at
              }
            }
          );
        }
      }
    } catch (rateLimitCheckError) {
      console.error('Excepție la verificare rate limit:', rateLimitCheckError);
      // Continuă - nu blocăm pentru erori
    }

    // ─── Rate Limiting ───────────────────────────────────────────
    const rateCheck = checkRateLimit(auth.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason },
        { 
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfter) }
        }
      );
    }

    // ─── Request Queue (concurrency control) ─────────────────────
    try {
      await requestQueue.waitForSlot(requestId);
    } catch (queueError) {
      return NextResponse.json(
        { error: queueError.message },
        { status: 503 }
      );
    }

    const { ip, userAgent } = getRequestMeta(request);

    let clientData;
    try {
      clientData = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Body-ul cererii este invalid sau lipsă. Trimiteți un JSON valid.' },
        { status: 400 }
      );
    }

    // ─── Sanitizare input-uri (XSS Protection) ───────────────────
    try {
      if (clientData.name) clientData.name = sanitizeText(clientData.name);
      if (clientData.allergies) clientData.allergies = sanitizeFoodRestrictions(clientData.allergies);
      if (clientData.foodPreferences) clientData.foodPreferences = sanitizeFoodPreferences(clientData.foodPreferences);
      if (clientData.notes) clientData.notes = sanitizeText(clientData.notes);
      
      // Sanitizare numere
      if (clientData.age) clientData.age = sanitizeNumber(clientData.age, { min: 10, max: 120, allowFloat: false });
      if (clientData.weight) clientData.weight = sanitizeNumber(clientData.weight, { min: 20, max: 300 });
      if (clientData.height) clientData.height = sanitizeNumber(clientData.height, { min: 100, max: 250, allowFloat: false });
      
      // Sanitizare progress data
      if (clientData.progress) {
        if (clientData.progress.currentWeight) {
          clientData.progress.currentWeight = sanitizeNumber(clientData.progress.currentWeight, { min: 20, max: 300 });
        }
        if (clientData.progress.notes) {
          clientData.progress.notes = sanitizeText(clientData.progress.notes);
        }
      }
    } catch (sanitizeError) {
      return NextResponse.json(
        { error: `Date invalide: ${sanitizeError.message}` },
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

    // Progresul clientului (dacă e regenerare pe baza progresului)
    const progress = clientData.progress || null;
    const { name, age, weight, height, goal, activityLevel, allergies, mealsPerDay, dietType, foodPreferences } = clientData;

    // ─── OWNERSHIP VERIFICATION ──────────────────────────────────
    // Dacă există clientId, verifică că clientul aparține trainer-ului autentificat
    if (clientData.clientId) {
      const { data: clientOwnership, error: ownershipError } = await supabase
        .from('clients')
        .select('id, trainer_id')
        .eq('id', clientData.clientId)
        .eq('trainer_id', auth.userId)
        .single();

      if (ownershipError || !clientOwnership) {
        await logActivity({
          action: 'meal_plan.generate',
          status: 'unauthorized',
          userId: auth.userId,
          email: auth.email,
          ipAddress: ip,
          userAgent,
          details: { 
            clientId: clientData.clientId, 
            reason: 'client_not_owned',
            message: 'Tentativă de generare plan pentru client care nu aparține trainer-ului'
          },
        });

        return NextResponse.json(
          { error: 'Clientul nu a fost găsit sau nu ai acces la el.' },
          { status: 403 }
        );
      }
    }

    // Verifică dacă progresul e în intervalul optim pentru obiectiv (nu necesită regenerare)
    if (progress?.currentWeight && clientData.clientId) {
      const oldWeight = parseFloat(weight);
      const newWeight = parseFloat(progress.currentWeight);
      const weightChangePercent = ((newWeight - oldWeight) / oldWeight) * 100;
      

      
      // Log: începe evaluarea progresului
      logActivity({
        action: 'progress.evaluation_start',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { 
          clientId: clientData.clientId, 
          clientName: name,
          oldWeight,
          newWeight,
          weightChangePercent: weightChangePercent.toFixed(2),
          goal,
          hungerLevel: progress.hungerLevel || 'normal',
          energyLevel: progress.energyLevel || 'normal',
          weeksNoChange: progress.weeksNoChange || '0'
        },
      });

      // Extrage datele de foame și stagnare
      const hungerLevel = progress.hungerLevel || 'normal';
      const energyLevel = progress.energyLevel || 'normal';
      const weeksNoChange = parseInt(progress.weeksNoChange) || 0;
      const adherence = progress.adherence || 'complet'; // 'complet', 'partial', 'deloc'
      
      // ─── Cazuri speciale de foame și energie ───────────────────
      let hungerAdjustment = 0;
      let needsCarbRedistribution = false;
      let hungerMessage = '';

      // Foame extremă + energie scăzută → +100 kcal SAU redistribuție carbo
      if (hungerLevel === 'extrem' && energyLevel === 'scazut') {
        hungerAdjustment = 100;
        needsCarbRedistribution = true;
        hungerMessage = 'Foame extremă cu energie scăzută detectată - se adaugă +100 kcal și se redistribuie carbohidrații.';
      }
      // Foame constantă → +100 kcal
      else if (hungerLevel === 'crescut' || hungerLevel === 'extrem') {
        hungerAdjustment = 100;
        hungerMessage = 'Foame crescută detectată - se adaugă +100 kcal.';
      }

      // ─── Stagnare 2+ săptămâni cu greutate stabilă → ±150-200 kcal ───
      let stagnationAdjustment = 0;
      let stagnationMessage = '';
      const isWeightStable = Math.abs(weightChangePercent) < 0.3;
      
      if (weeksNoChange >= 2 && isWeightStable) {
        // La stagnare, ajustăm în funcție de obiectiv
        if (goal === 'weight_loss') {
          stagnationAdjustment = -175; // scade 150-200 kcal
          stagnationMessage = 'Stagnare 2+ săptămâni pe cut - se scad 175 kcal pentru a relansa progresul.';
        } else if (goal === 'muscle_gain') {
          stagnationAdjustment = 175; // adaugă 150-200 kcal
          stagnationMessage = 'Stagnare 2+ săptămâni pe masă - se adaugă 175 kcal pentru a relansa creșterea.';
        }
      }

      let isOptimalProgress = false;
      let progressMessage = '';

      // Verifică intervalele optime DOAR dacă nu avem cazuri speciale de foame/stagnare
      const hasSpecialCase = hungerAdjustment !== 0 || stagnationAdjustment !== 0;
      
      // Dacă antrenorul a cerut explicit regenerare, nu verificăm progres optim
      const forceRegenerate = progress?.forceRegenerate === true;

      // ─── CAZ SPECIAL: Adherență DELOC - nu se regenerează planul dacă obiectivul nu e îndeplinit ───
      if (adherence === 'deloc') {
        // Dacă clientul nu a respectat planul deloc, problema nu e planul, ci respectarea lui
        // Actualizăm doar greutatea și returnăm mesaj că trebuie să respecte planul
        const { error: updateError } = await supabase
          .from('clients')
          .update({ weight: newWeight })
          .eq('id', clientData.clientId);

        if (updateError) {
          console.error('Eroare la actualizarea greutății clientului:', updateError.message);
        }

        // Salvează în weight_history chiar dacă nu se regenerează planul
        const { error: whErrDeloc } = await supabase
          .from('weight_history')
          .insert({
            client_id: clientData.clientId,
            weight: newWeight,
            notes: 'Actualizare progres - plan neresprectat',
          });
        if (whErrDeloc) {
          console.error('[weight_history] Eroare la inserare (deloc):', whErrDeloc.message);
        }

        logActivity({
          action: 'client.weight_update',
          status: 'success',
          userId: auth.userId,
          email: auth.email,
          ipAddress: ip,
          userAgent,
          details: { 
            clientId: clientData.clientId, 
            clientName: name,
            oldWeight,
            newWeight,
            changePercent: weightChangePercent.toFixed(2),
            goal,
            adherence: 'deloc',
            noRegeneration: true
          },
        });

        return NextResponse.json({
          type: 'optimal_progress',
          message: 'Planul nu a fost respectat. Pentru rezultate, te rog respectă planul alimentar actual înainte de a genera unul nou.',
          weightUpdated: true,
          oldWeight,
          newWeight,
          changePercent: weightChangePercent.toFixed(2)
        });
      }

      // ─── CAZ SPECIAL: Adherență PARȚIALĂ - marja mai permisivă ───
      let weightToleranceMultiplier = 1.0; // Factor de multiplicare pentru toleranță
      if (adherence === 'partial') {
        weightToleranceMultiplier = 1.5; // Marja cu 50% mai permisivă
      }

      // Menținere cu greutate stabilă = succes DOAR dacă nu avem cazuri speciale SAU regenerare forțată
      if (goal === 'maintenance' && isWeightStable && !hasSpecialCase && !forceRegenerate) {
        isOptimalProgress = true;
        progressMessage = `Greutate stabilă! Variație de doar ${weightChangePercent >= 0 ? '+' : ''}${weightChangePercent.toFixed(2)}% — perfect pentru menținere${weeksNoChange >= 2 ? ' (greutate menținută constant, planul funcționează excelent)' : ''}.`;
      }

      if (!isOptimalProgress && !hasSpecialCase && !forceRegenerate) {
        if (goal === 'weight_loss') {
          // Cut: -0.2% până la -1.0% pe săptămână e progres bun
          // Săpt. 1-2: extins la -2.5% (water weight + glicogen — e normal în faza inițială)
          const isEarlyCut = weekNumber <= 2;
          const minLoss = isEarlyCut
            ? -2.5 * weightToleranceMultiplier
            : -1.0 * weightToleranceMultiplier;
          const maxLoss = -0.2 / weightToleranceMultiplier;
          if (weightChangePercent >= minLoss && weightChangePercent <= maxLoss) {
            isOptimalProgress = true;
            const earlyNote = isEarlyCut && weightChangePercent < -1.0
              ? ' (pierdere rapidă normală în faza inițială — apă + glicogen)'
              : '';
            progressMessage = `Progres excelent! Ai slăbit ${Math.abs(weightChangePercent).toFixed(2)}% (${(newWeight - oldWeight).toFixed(1)} kg) - planul funcționează, continuă!${earlyNote}${adherence === 'partial' ? ' Încearcă să respecți mai bine planul pentru rezultate mai constante.' : ''}`;
          }
        } else if (goal === 'maintenance') {
          // Menținere: ±0.3% e stabil (cu ajustare pentru adherență)
          const tolerance = 0.3 * weightToleranceMultiplier; // poate fi ±0.45% dacă adherență parțială
          if (weightChangePercent >= -tolerance && weightChangePercent <= tolerance) {
            isOptimalProgress = true;
            progressMessage = `Greutate stabilă! Variație de doar ${weightChangePercent >= 0 ? '+' : ''}${weightChangePercent.toFixed(2)}% - perfect pentru menținere.${adherence === 'partial' ? ' Încearcă să respecți mai bine planul pentru menținere mai ușoară.' : ''}`;
          }
        } else if (goal === 'muscle_gain') {
          // Masă musculară: +0.25% până la +0.50% pe săptămână e optim (cu ajustare pentru adherență)
          const minGain = 0.25 / weightToleranceMultiplier; // poate fi +0.17% dacă adherență parțială
          const maxGain = 0.50 * weightToleranceMultiplier; // poate fi +0.75% dacă adherență parțială
          if (weightChangePercent >= minGain && weightChangePercent <= maxGain) {
            isOptimalProgress = true;
            progressMessage = `Progres excelent! Ai luat ${weightChangePercent.toFixed(2)}% (${(newWeight - oldWeight).toFixed(1)} kg) - în intervalul optim pentru creștere musculară.${adherence === 'partial' ? ' Încearcă să respecți mai bine planul pentru creștere mai controlată.' : ''}`;
          }
        }
      }

      if (isOptimalProgress) {
        // Actualizează doar greutatea clientului în baza de date
        const { error: updateError } = await supabase
          .from('clients')
          .update({ weight: newWeight })
          .eq('id', clientData.clientId);

        if (updateError) {
          console.error('Eroare la actualizarea greutății clientului:', updateError.message);
        } else {

        }

        // Salvează în weight_history chiar dacă nu se regenerează planul
        const { error: whErrOptimal } = await supabase
          .from('weight_history')
          .insert({
            client_id: clientData.clientId,
            weight: newWeight,
            notes: 'Progres optim - plan menținut',
          });
        if (whErrOptimal) {
          console.error('[weight_history] Eroare la inserare (optimal):', whErrOptimal.message);
        } else {
        }

        logActivity({
          action: 'client.weight_update',
          status: 'success',
          userId: auth.userId,
          email: auth.email,
          ipAddress: ip,
          userAgent,
          details: { 
            clientId: clientData.clientId, 
            clientName: name,
            oldWeight,
            newWeight,
            changePercent: weightChangePercent.toFixed(2),
            goal,
            optimalProgress: true
          },
        });

        // Returnează răspuns special - nu regenera planul
        return NextResponse.json({
          type: 'optimal_progress',
          message: progressMessage,
          weightUpdated: true,
          oldWeight,
          newWeight,
          changePercent: weightChangePercent.toFixed(2)
        });
      }

      // Progresul NU e în intervalul optim - calculează ajustarea de calorii
      // Log: se decide regenerarea planului
      logActivity({
        action: 'progress.regeneration_needed',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { 
          clientId: clientData.clientId, 
          clientName: name,
          oldWeight,
          newWeight,
          weightChangePercent: weightChangePercent.toFixed(2),
          goal,
          reason: hasSpecialCase ? 'special_case' : 'suboptimal_progress',
          hungerAdjustment,
          stagnationAdjustment,
          hungerMessage: hungerMessage || null,
          stagnationMessage: stagnationMessage || null
        },
      });

      // ─── Determină săptămâna de cut (nr. de intrări în weight_history pentru acest client) ───
      let weekNumber = 99; // implicit: nu e în faza inițială
      if (goal === 'weight_loss') {
        const { count: whCount } = await supabase
          .from('weight_history')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', clientData.clientId);
        // whCount e numărul de intrări EXISTENTE înainte de actualizarea curentă
        // +1 pentru că intrarea curentă nu a fost încă adăugată
        weekNumber = (whCount || 0) + 1;
      }

      // ─── Ajustare calorică proporțională cu rata reală de schimbare ───
      const { adjustment: weightBasedAdjustment, reason: weightAdjustReason } = calculateCalorieAdjustment(goal, weightChangePercent, weekNumber);
      let calorieAdjustment = weightBasedAdjustment;

      // ─── Adaugă ajustările speciale de foame și stagnare ───
      // Foamea adaugă întotdeauna (se cumulează cu ajustarea bazată pe greutate)
      if (hungerAdjustment > 0) {
        calorieAdjustment += hungerAdjustment;
      }

      // Stagnarea înlocuiește ajustarea bazată pe greutate DOAR dacă
      // ajustarea calculată e mai mică în magnitudine decât cea de stagnare
      if (stagnationAdjustment !== 0 && Math.abs(weightBasedAdjustment) < Math.abs(stagnationAdjustment)) {
        calorieAdjustment = stagnationAdjustment + (hungerAdjustment || 0);
      }

      // ─── CAP ±350 kcal per sesiune de ajustare (previne schimbări prea drastice) ───
      const MAX_ADJUSTMENT = 350;
      if (Math.abs(calorieAdjustment) > MAX_ADJUSTMENT) {
        const cappedSign = calorieAdjustment > 0 ? 1 : -1;
        calorieAdjustment = cappedSign * MAX_ADJUSTMENT;
      }

      // Log detaliat pentru transparență
      logActivity({
        action: 'progress.calorie_adjustment_calculated',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: {
          clientId: clientData.clientId,
          clientName: name,
          goal,
          weightChangePercent: weightChangePercent.toFixed(2),
          weekNumber,
          weightBasedAdjustment,
          weightAdjustReason,
          hungerAdjustment,
          stagnationAdjustment,
          finalCalorieAdjustment: calorieAdjustment,
        },
      });

      // Stochează flag-ul pentru redistribuție carbo (foame extremă + energie scăzută)
      if (needsCarbRedistribution) {
        clientData._needsCarbRedistribution = true;
      }

      // Construiește mesajul complet de recomandare (pentru prompt + log)
      const adjustmentReasonParts = [weightAdjustReason];
      if (hungerMessage) adjustmentReasonParts.push(hungerMessage);
      if (stagnationMessage) adjustmentReasonParts.push(stagnationMessage);
      if (Math.abs(calorieAdjustment) === MAX_ADJUSTMENT && Math.abs(weightBasedAdjustment + (hungerAdjustment || 0)) > MAX_ADJUSTMENT) {
        adjustmentReasonParts.push(`Ajustare limitată la ±${MAX_ADJUSTMENT} kcal per sesiune pentru siguranță.`);
      }
      clientData._adjustmentReason = adjustmentReasonParts.filter(Boolean).join(' ');
      clientData._calorieAdjustment = calorieAdjustment;
    }

    // Dacă avem greutate nouă din progres, recalculăm caloriile
    let targetCalories, proteinGrams, carbsGrams, fatGrams;
    const effectiveWeight = progress?.currentWeight ? parseFloat(progress.currentWeight) : parseFloat(clientData.weight);
    const effectiveClientData = progress?.currentWeight ? { ...clientData, weight: String(effectiveWeight) } : clientData;
    
    // Dacă avem o ajustare de calorii și știm caloriile planului curent,
    // aplicăm ajustarea față de planul curent (nu față de recalculul pentru greutatea nouă)
    // IMPORTANT: verificăm !== undefined (nu && ) pentru că ajustarea 0 e validă (nu e falsy)
    if (clientData._calorieAdjustment !== undefined && clientData.currentPlanCalories) {
      targetCalories = clientData.currentPlanCalories + clientData._calorieAdjustment;
    } else {
      // Fără progres sau fără plan curent — calculează normal din formula
      targetCalories = cachedCalculateCalories(effectiveClientData, calculateTargetCalories);
      if (clientData._calorieAdjustment !== undefined) {
        targetCalories += clientData._calorieAdjustment;
      }
    }

    // ─── PODEA MINIMĂ DE CALORII (safety guard) ───
    // Sub aceste valori riscul de deficit de macronutrienți și catabolism e ridicat
    const CALORIE_FLOOR = clientData.gender === 'M' ? 1500 : 1300;
    if (targetCalories < CALORIE_FLOOR) {
      clientData._floorApplied = true;
      clientData._floorValue = CALORIE_FLOOR;
      clientData._adjustmentReason = (clientData._adjustmentReason || '') +
        ` Plan ajustat la minimul de siguranță de ${CALORIE_FLOOR} kcal (${clientData.gender === 'M' ? 'bărbat' : 'femeie'}) — sub această valoare riscul de deficit nutritiv e ridicat.`;
      targetCalories = CALORIE_FLOOR;
    }
    
    // Folosește cache pentru macros
    const macros = cachedCalculateMacros(clientData.goal, effectiveWeight, targetCalories, calculateMacros);
    proteinGrams = macros.protein;
    carbsGrams = macros.carbs;
    fatGrams = macros.fat;

    console.log(`[TARGETS] goal=${clientData.goal} weight=${effectiveWeight}kg cal=${targetCalories} → P:${proteinGrams}g C:${carbsGrams}g F:${fatGrams}g`);

    const sex = clientData.gender === 'M' ? 'Masculin' : 'Feminin';
    const mealsNum = parseInt(mealsPerDay) || 3;

    // Folosește cache pentru distribuția meselor
    const mealDistribution = getCachedMealDistribution(mealsNum);
    const mealTargetsStr = Object.entries(mealDistribution)
      .map(([meal, pct]) => {
        const cal = Math.round(targetCalories * pct);
        const p   = Math.round(proteinGrams * pct);
        const c   = Math.round(carbsGrams * pct);
        const f   = Math.round(fatGrams * pct);
        return `- ${meal}: ~${cal} kcal (P:${p}g C:${c}g G:${f}g)`;
      })
      .join('\n');

    const dayNames = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
    const targets = {
      calories: Math.round(targetCalories),
      protein:  Math.round(proteinGrams),
      carbs:    Math.round(carbsGrams),
      fat:      Math.round(fatGrams),
    };

    // Încarcă alimentele și rețetele din Supabase
    const availableFoods = await loadFoodsFromSupabase(dietType || 'omnivore', allergies || '');
    const availableRecipes = await loadRecipesFromSupabase(dietType || 'omnivore');

    // Map food_name → food object (O(1) lookup pentru scalare)
    // Indexează după: nume exact, nume normalizat, fiecare alias, fiecare alias normalizat
    const foodsMap = {};
    availableFoods.forEach(f => {
      foodsMap[f.name] = f;
      const normName = normalizeKey(f.name);
      if (normName) foodsMap[normName] = f;
      if (Array.isArray(f.aliases)) {
        f.aliases.forEach(alias => {
          if (alias) {
            foodsMap[alias] = f;
            const normAlias = normalizeKey(alias);
            if (normAlias) foodsMap[normAlias] = f;
          }
        });
      }
    });

    // foodMaxMap pentru adjustDayToTargets (corectare macro zilnică)
    const foodMaxMap = {};
    availableFoods.forEach(food => {
      const key = food.name.toLowerCase();
      foodMaxMap[key] = food.max_amount_per_meal ||
        MAX_GRAMS_BY_CATEGORY[food.category] || null;
    });

    // Map recipe_id → recipe object
    const recipesById = {};
    availableRecipes.forEach(r => { recipesById[r.id] = r; });

    // Anti-repetiție pe durata generării întregii săptămâni
    const usedRecipeIds = { breakfast: new Set(), lunch: new Set(), dinner: new Set(), snack: new Set() };

    // Context rețete pentru GPT (grupate pe tip masă)
    const mealSlots = Object.keys(mealDistribution);
    const recipesContext = buildRecipesContext(availableRecipes, mealSlots);

    // Surse de proteine rotative pe zile — forțează varietatea
    const proteinSources = [
      'DOAR pui sau curcan — nicio altă carne',
      'DOAR pește sau fructe de mare — fără carne de pui sau vită',
      'DOAR ouă și lactate — fără nicio carne sau pește',
      'DOAR carne roșie (vită sau porc slab) — fără pui sau pește',
      'DOAR leguminoase și tofu — fără nicio carne sau pește',
      'DOAR pește sau ton — fără pui sau carne roșie',
      'Mix liber — dar diferit față de toate zilele anterioare',
    ];

    const dietRestrictions = {
      vegetarian: `DIETĂ VEGETARIANĂ — INTERZIS: carne de pui, vită, porc, pește, fructe de mare, gelatină.
                  PERMIS: ouă, lactate, legume, fructe, cereale, leguminoase, tofu, tempeh.`,
      vegan: `DIETĂ VEGANĂ — INTERZIS: orice produs animal (carne, pește, ouă, lapte, brânză, iaurt, miere, unt).
              PERMIS DOAR: legume, fructe, cereale, leguminoase, tofu, tempeh, lapte vegetal, nuci, semințe.`,
      omnivore: '',
    };

    // ─── System message STATIC (trimis o dată, cache-uit de OpenAI pentru batch-urile următoare) ───
    const staticSystemMessage = [
      `Ești un nutriționist AI expert. Selectezi rețete pre-definite pentru un plan alimentar săptămânal.`,
      `Returnezi EXCLUSIV ID-uri de rețete din lista furnizată. Nu inventezi rețete sau cantități.`,
      ``,
      `CLIENT: ${name}, ${age} ani, ${sex}, ${weight}kg, ${height}cm`,
      `Obiectiv: ${goal === 'weight_loss' ? 'Slăbit' : goal === 'muscle_gain' ? 'Creștere masă musculară' : goal === 'maintenance' ? 'Menținere' : 'Recompoziție corporală'}`,
      `Dietă: ${getDietLabel(dietType)}${dietType === 'vegetarian' ? ' (Fără carne și pește)' : dietType === 'vegan' ? ' (Fără orice produs animal)' : ''}`,
      allergies ? `Alergii/restricții: ${sanitizeForPrompt(allergies)}` : '',
      dietRestrictions[dietType] || '',
      ``,
      `NECESAR ZILNIC: ${targets.calories} kcal | P:${targets.protein}g | C:${targets.carbs}g | G:${targets.fat}g`,
      ``,
      foodPreferences ? [
        `═══ PREFERINȚE ALIMENTARE ═══`,
        sanitizeForPrompt(foodPreferences),
        `═══ SFÂRȘIT PREFERINȚE ═══`,
      ].join('\n') : '',
      progress ? [
        `═══ CONTEXT PROGRES CLIENT ═══`,
        `Greutate curentă: ${progress.currentWeight || weight}kg`,
        `Respectare plan anterior: ${progress.adherence || 'N/A'}`,
        `Nivel energie: ${progress.energyLevel || 'N/A'} | Foame: ${progress.hungerLevel || 'N/A'}`,
        progress.notes ? `Observații antrenor: ${sanitizeForPrompt(progress.notes)}` : '',
        clientData._adjustmentReason ? [
          `═══ RECOMANDARE SISTEM ═══`,
          clientData._adjustmentReason,
          `Calorii ajustate la: ${targets.calories} kcal/zi${clientData._floorApplied ? ` (minim siguranță ${clientData._floorValue} kcal)` : ''}`,
          `═══ SFÂRȘIT RECOMANDARE ═══`,
        ].join('\n') : '',
        `═══ SFÂRȘIT CONTEXT PROGRES ═══`,
      ].filter(Boolean).join('\n') : '',
      ``,
      `═══ REGULI DE SELECȚIE ═══`,
      `1. Selectezi EXACT câte o rețetă per masă per zi — câte un recipe_id din lista furnizată în user message`,
      `2. VARIETATE MAXIMĂ — nu repeta aceeași rețetă în aceeași săptămână dacă există alternative`,
      `3. Respectă orientativ sursa de proteină indicată pentru fiecare zi`,
      `4. Returnezi EXCLUSIV JSON ARRAY pur, fără text suplimentar, fără markdown`,
      `═══ SFÂRȘIT REGULI ═══`,
    ].filter(s => s !== '').join('\n');

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        const sendEvent = (obj) => {
          if (streamClosed) return; // clientul s-a deconectat, dar generarea continuă
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch (e) {
            streamClosed = true; // stream închis extern
          }
        };
        const closeStream = () => {
          if (!streamClosed) { streamClosed = true; try { controller.close(); } catch(e) {} }
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
    const days = [];

    // Scrie imediat în DB că generarea a început — AWAIT pentru a garanta că e în DB
    // înainte ca clientul să poată naviga înapoi și să facă polling
    if (clientData.clientId) {
      const { error: initErr } = await supabase
        .from('generation_status')
        .upsert({
          client_id: clientData.clientId,
          trainer_id: auth.userId,
          status: 'generating',
          current_step: 0,
          total_steps: 7,
        }, { onConflict: 'client_id,trainer_id' });
      if (initErr) console.error('[generation_status] Init failed:', initErr);
    }

    // Retry helper reutilizabil pentru apeluri OpenAI
    const MAX_RETRIES = 5;
    const callOpenAI = async (messages, maxTokens, label) => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.5,
            max_tokens: maxTokens,
          });
          return resp.choices[0].message.content;
        } catch (openaiErr) {
          const isRateLimit = openaiErr.status === 429;
          const isOverloaded = openaiErr.status === 503;
          const isNetwork = openaiErr.code === 'ECONNREFUSED' || openaiErr.code === 'ENOTFOUND' || openaiErr.type === 'request_error';
          const isTimeout = openaiErr.code === 'ETIMEDOUT' || openaiErr.message?.includes('timeout');
          if (isRateLimit && attempt < MAX_RETRIES) {
            const waitMs = attempt * 20000;
            console.log(`[OpenAI] Rate limit la ${label}, attempt ${attempt}/${MAX_RETRIES}. Aștept ${waitMs/1000}s...`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          let msg;
          if (isNetwork || isOverloaded) msg = 'Serviciul OpenAI nu este disponibil momentan. Vă rog încercați din nou.';
          else if (isRateLimit)          msg = `Limita OpenAI depășită după ${MAX_RETRIES} încercări. Așteptați câteva minute.`;
          else if (isTimeout)            msg = `Timeout la ${label}. Reîncercați.`;
          else                           msg = `Eroare OpenAI la ${label}: ${openaiErr.message || 'eroare necunoscută'}`;
          throw new Error(msg);
        }
      }
    };

    const parseJsonArray = (raw, label) => {
      let c = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const s = c.indexOf('['); const e = c.lastIndexOf(']');
      if (s !== -1 && e !== -1) c = c.slice(s, e + 1);
      else { const js = c.indexOf('{'); const je = c.lastIndexOf('}'); if (js !== -1 && je !== -1) c = '[' + c.slice(js, je + 1) + ']'; }
      try { const r = JSON.parse(c); return Array.isArray(r) ? r : [r]; }
      catch { throw new Error(`${label}: răspuns JSON invalid de la OpenAI. Reîncercați.`); }
    };

    // ─── PROMPT 1: Selectare rețete pentru toate 7 zilele (1 apel API) ───────
    sendEvent({ type: 'progress', day: 1, total: 7 });
    if (clientData.clientId) {
      supabase.from('generation_status').upsert({
        client_id: clientData.clientId, trainer_id: auth.userId,
        status: 'generating', current_step: 1, total_steps: 7,
      }, { onConflict: 'client_id,trainer_id' }).then(null, err => console.error('[generation_status]', err));
    }

    const daysInfoAll = dayNames.map((dn, i) =>
      `Ziua ${i+1} (${dn}): proteină preferată = ${proteinSources[i]}`
    ).join('\n');

    const recipeSelectionPrompt = `Selectează rețete pentru toate cele 7 zile.
Returnează JSON ARRAY cu 7 obiecte (fără markdown):
[{"day":1,"meals":[{"meal":"Mic dejun","recipe_id":"uuid"},...]},...]

ZILE:
${daysInfoAll}

MESE PER ZI (în această ordine): ${mealSlots.join(', ')}

RETETE DISPONIBILE:
${recipesContext}
RETURNEAZĂ: JSON ARRAY pur, fără niciun text înainte sau după.`;

    const raw1 = await callOpenAI(
      [{ role: 'system', content: staticSystemMessage }, { role: 'user', content: recipeSelectionPrompt }],
      7 * 400, 'Prompt 1 (selectare rețete)'
    );
    const allSelections = parseJsonArray(raw1, 'Prompt 1');

    // Construiește lista meselor selectate cu rețeta corespunzătoare
    const selectedMealSlots = []; // [{day, slotName, recipe, mealPct}]
    for (const selection of allSelections) {
      const dayNumber = Number(selection.day);
      for (const [mealName, mealPct] of Object.entries(mealDistribution)) {
        const mealTypeKey = DISPLAY_TO_MEAL_TYPE[mealName] || 'lunch';
        const selMeal = selection.meals?.find(m => m.meal === mealName);
        let recipe = selMeal?.recipe_id ? recipesById[selMeal.recipe_id] : null;
        if (!recipe) {
          const typeRecipes = availableRecipes.filter(r => r.meal_type === mealTypeKey);
          const usedSet = usedRecipeIds[mealTypeKey] || new Set();
          const unused = typeRecipes.filter(r => !usedSet.has(r.id));
          recipe = unused.length > 0
            ? unused[Math.floor(Math.random() * unused.length)]
            : typeRecipes[Math.floor(Math.random() * typeRecipes.length)];
        }
        if (recipe) {
          if (!usedRecipeIds[mealTypeKey]) usedRecipeIds[mealTypeKey] = new Set();
          usedRecipeIds[mealTypeKey].add(recipe.id);
          selectedMealSlots.push({ day: dayNumber, slotName: mealName, recipe, mealPct });
        }
      }
    }

    // ─── PROMPT 2: Generare cantități realiste (1 apel API) ──────────────────
    sendEvent({ type: 'progress', day: 2, total: 7 });

    // Construiește contextul pentru Prompt 2: fiecare masă cu ingredientele și targetul caloric
    const quantityLines = [];
    for (const { day, slotName, recipe, mealPct } of selectedMealSlots) {
      const mT = {
        calories: Math.round(targets.calories * mealPct),
        protein:  Math.round(targets.protein  * mealPct),
        carbs:    Math.round(targets.carbs    * mealPct),
        fat:      Math.round(targets.fat      * mealPct),
      };
      quantityLines.push(`Ziua ${day} - ${slotName} (${recipe.name}) | target: ~${mT.calories}kcal P:${mT.protein}g C:${mT.carbs}g G:${mT.fat}g`);
      for (const ing of (recipe.ingredients || [])) {
        const food = foodsMap[ing.food_name] || foodsMap[normalizeKey(ing.food_name)];
        if (!food) continue;
        const maxG = food.max_amount_per_meal || MAX_GRAMS_BY_CATEGORY[food.category] || 200;
        quantityLines.push(`  - ${food.name}: ${food.calories_per_100g}kcal/100g P:${food.protein_per_100g||0}g C:${food.carbs_per_100g||0}g G:${food.fat_per_100g||0}g [MAX:${maxG}g]`);
      }
    }

    const quantitySystemMessage = [
      `Ești un nutriționist AI. Generezi gramaje REALISTE și NATURALE pentru ingredientele meselor unui plan săptămânal.`,
      `REGULI OBLIGATORII:`,
      `1. Alege cantități care arată ca o masă reală: 150g piept pui, 80g orez crud, 150g broccoli, 12g ulei.`,
      `2. NU depăși cantitățile MAX indicate pentru fiecare ingredient.`,
      `3. Încearcă să te apropii de targetul caloric al fiecărei mese (toleranță ±15%).`,
      `4. Returnează EXCLUSIV JSON ARRAY, fără text suplimentar, fără markdown.`,
    ].join('\n');

    const quantityUserPrompt = `Generează gramaje pentru fiecare ingredient al meselor de mai jos.
Returnează JSON ARRAY cu ${allSelections.length} obiecte:
[{"day":1,"meals":[{"meal":"Mic dejun","foods":[{"name":"Ouă","amount":150},...]},...]},...]

MESE:
${quantityLines.join('\n')}

RETURNEAZĂ: JSON ARRAY pur, fără niciun text înainte sau după.`;

    const raw2 = await callOpenAI(
      [{ role: 'system', content: quantitySystemMessage }, { role: 'user', content: quantityUserPrompt }],
      selectedMealSlots.length * 120, 'Prompt 2 (cantități)'
    );
    let quantitySelections;
    try { quantitySelections = parseJsonArray(raw2, 'Prompt 2'); }
    catch { quantitySelections = []; } // fallback la scaleRecipeToCalories dacă GPT eșuează

    // ─── Construiește zilele din cantitățile GPT + corecție matematică ────────
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayNumber = dayIndex + 1;
      const dayPlan = { day: dayNumber, meals: [], dailyTotals: {} };
      const daySel = quantitySelections.find(s => Number(s.day) === dayNumber);

      for (const [mealName, mealPct] of Object.entries(mealDistribution)) {
        const mealSlot = selectedMealSlots.find(sm => sm.day === dayNumber && sm.slotName === mealName);
        if (!mealSlot) continue;

        const mealSel = daySel?.meals?.find(m => m.meal === mealName);
        let foods = [];

        if (mealSel?.foods?.length > 0) {
          // Folosim cantitățile generate de GPT
          for (const foodSel of mealSel.foods) {
            const food = foodsMap[foodSel.name] || foodsMap[normalizeKey(foodSel.name)];
            if (!food) continue;
            const maxG = food.max_amount_per_meal || MAX_GRAMS_BY_CATEGORY[food.category] || 300;
            const g = roundToNearest5(Math.max(5, Math.min(Number(foodSel.amount) || 50, maxG)));
            const factor = g / 100;
            foods.push({
              name:      food.name,
              amount:    g,
              unit:      'g',
              calories:  Math.round(food.calories_per_100g * factor),
              protein:   Math.round((food.protein_per_100g  || 0) * factor),
              carbs:     Math.round((food.carbs_per_100g    || 0) * factor),
              fat:       Math.round((food.fat_per_100g      || 0) * factor),
              _category: food.category,
              _calPerG:  food.calories_per_100g / 100,
              _protPerG: (food.protein_per_100g  || 0) / 100,
              _carbPerG: (food.carbs_per_100g    || 0) / 100,
              _fatPerG:  (food.fat_per_100g      || 0) / 100,
            });
          }
        }

        // Fallback la scaleRecipeToCalories dacă GPT nu a generat cantități pentru această masă
        if (foods.length === 0) {
          const mealTargetCal = Math.round(targets.calories * mealPct);
          const scaled = scaleRecipeToCalories(mealSlot.recipe, mealTargetCal, foodsMap);
          foods = scaled.foods;
        }

        dayPlan.meals.push({
          mealType:    mealSlot.recipe.name,
          slotName:    mealName,
          preparation: mealSlot.recipe.preparation || '',
          foods,
          mealTotals: {
            calories: foods.reduce((s, f) => s + f.calories, 0),
            protein:  foods.reduce((s, f) => s + f.protein,  0),
            carbs:    foods.reduce((s, f) => s + f.carbs,    0),
            fat:      foods.reduce((s, f) => s + f.fat,      0),
          },
        });
      }

      recalculateDayTotals(dayPlan);
      adjustDayToTargets(dayPlan, targets, foodsMap, mealDistribution);
      days.push(dayPlan);

      await new Promise(r => setTimeout(r, 150));
      sendEvent({ type: 'progress', day: dayNumber, total: 7 });
      if (clientData.clientId) {
        supabase.from('generation_status').upsert({
          client_id: clientData.clientId, trainer_id: auth.userId,
          status: 'generating', current_step: dayNumber, total_steps: 7,
        }, { onConflict: 'client_id,trainer_id' }).then(null, err => console.error('[generation_status] Update failed:', err));
      }
    }
    const plan = { clientName: name, dailyTargets: targets, days };

    // Salvează planul în Supabase dacă există clientId
    let savedPlanId = null;
    if (clientData.clientId) {
      const insertData = {
        client_id: clientData.clientId,
        trainer_id: auth.userId,
        plan_data: plan,
        daily_targets: targets,
      };
      
      // Dacă planul e generat din progres, salvează caloriile planului anterior
      if (progress && clientData.currentPlanCalories) {
        insertData.previous_plan_calories = clientData.currentPlanCalories;
      }
      
      const { data: savedPlan, error: saveError } = await supabase
        .from('meal_plans')
        .insert(insertData)
        .select()
        .single();
      if (saveError) {
        console.error('Eroare la salvarea planului în Supabase:', saveError.message);
      } else {
        savedPlanId = savedPlan?.id || null;
        
        // Creează notificare pentru client când antrenorul generează un plan nou
        const { data: clientInfo, error: clientInfoError } = await supabase
          .from('clients')
          .select('user_id, name')
          .eq('id', clientData.clientId)
          .single();

        if (!clientInfoError && clientInfo && clientInfo.user_id) {
          const { error: notificationError } = await supabase
            .from('notifications')
            .insert({
              user_id: clientInfo.user_id,
              type: 'new_meal_plan',
              title: 'Plan alimentar nou',
              message: `Antrenorul tău ți-a creat un plan alimentar nou`,
              related_plan_id: savedPlanId,
              related_client_id: clientData.clientId,
              is_read: false
            });

          if (notificationError) {
            console.error('Eroare la crearea notificării pentru client:', notificationError);
          }
        }
      }

      // Actualizează greutatea clientului și salvează în weight_history dacă avem progres cu greutate nouă
      if (progress?.currentWeight) {
        const newWeight = parseFloat(progress.currentWeight);
        const { error: weightUpdateError } = await supabase
          .from('clients')
          .update({ weight: newWeight })
          .eq('id', clientData.clientId);
        if (weightUpdateError) {
          console.error('Eroare la actualizarea greutății clientului:', weightUpdateError.message);
        } else {

        }

        // Salvează în weight_history DOAR după ce planul a fost generat și salvat cu succes
        const { error: whErr } = await supabase
          .from('weight_history')
          .insert({
            client_id: clientData.clientId,
            weight: newWeight,
            notes: 'Actualizare progres din planul alimentar',
          });
        if (whErr) {
          console.error('[weight_history] Eroare la inserare (progres plan):', whErr.message, whErr);
        } else {

        }
      }
    } else {

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
    
    // Actualizează status în DB ca finalizat (fire-and-forget)
    if (clientData.clientId) {
      supabase
        .from('generation_status')
        .upsert({
          client_id: clientData.clientId,
          trainer_id: auth.userId,
          status: 'completed',
          current_step: 7,
          total_steps: 7,
          plan_id: savedPlanId,
          completed_at: new Date().toISOString(),
        }, { onConflict: 'client_id,trainer_id' })
        .then(null, err => console.error('[generation_status] Complete update failed:', err));

      // Creează notificare pentru trainer — AWAIT ca să fie în DB înainte de sendEvent
      const { error: notifErr } = await supabase
        .from('notifications')
        .insert({
          user_id: auth.userId,
          type: 'plan_generated',
          title: 'Plan alimentar generat',
          message: `Planul alimentar pentru ${clientData.name} a fost generat cu succes`,
          related_client_id: clientData.clientId,
          related_plan_id: savedPlanId,
          is_read: false,
        });
      if (notifErr) console.error('[notifications] Plan generated notification failed:', notifErr);
    }
    
    sendEvent({ type: 'complete', plan, nutritionalNeeds: targets, planId: savedPlanId });
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
          
          // Marchează ca eșuat în DB (fire-and-forget)
          if (clientData.clientId) {
            supabase
              .from('generation_status')
              .upsert({
                client_id: clientData.clientId,
                trainer_id: auth.userId,
                status: 'failed',
                error_message: err.message,
                completed_at: new Date().toISOString(),
              }, { onConflict: 'client_id,trainer_id' })
              .then(null, error => console.error('[generation_status] Error update failed:', error));
          }
          
          sendEvent({ type: 'error', message: err.message });
        } finally {
          closeStream();
          // Eliberează slot-ul din queue pentru scalabilitate
          requestQueue.releaseSlot();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    // Eliberează slot-ul în caz de eroare
    requestQueue.releaseSlot();
    
    console.error('Error generating meal plan:', error);
    const { ip: errIp, userAgent: errUA } = getRequestMeta(request);
    logActivity({
      action: 'meal_plan.generate',
      status: 'failure',
      userId: null,
      email: null,
      ipAddress: errIp,
      userAgent: errUA,
      details: { error: error.message },
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
 * Ex: 126g → 125g, 128g → 130g
 * Folosit DOAR pentru food.amount, nu pentru macros
 */
function roundToNearest5(value) {
  return Math.round(value / 5) * 5;
}

// Limite implicite pe cuvinte cheie din numele alimentului (fallback)
const KEYWORD_MAX_LIMITS = [
  { keywords: ['orez', 'rice', 'paste', 'spaghete', 'penne', 'fusilli', 'tagliatelle', 'quinoa', 'mei', 'hrișcă', 'bulgur', 'couscous', 'fulgi de ovăz', 'ovăz', 'orz'], max: 80 },
  { keywords: ['cartofi dulci', 'cartof dulce', 'cartofi', 'cartof'], max: 200 },
  { keywords: ['pâine', 'toast', 'baghetă', 'lipie', 'tortilla'], max: 80 },
  { keywords: ['piept de pui', 'pulpă de pui', 'pui', 'curcan', 'vită', 'porc', 'miel', 'somon', 'ton', 'tilapia', 'creveți', 'crap', 'păstrăv'], max: 200 },
  { keywords: ['ou', 'ouă'], max: 150 },
  { keywords: ['nuci', 'migdale', 'caju', 'fistic', 'alune', 'semințe', 'unt de arahide', 'unt de migdale'], max: 40 },
  { keywords: ['ulei', 'unt ', 'ghee', 'untură'], max: 15 },
  // Legume — o singură legumă per masă max 150g (adaugă varietate, nu cantitate)
  { keywords: ['castraveți', 'castravete', 'roșii', 'roșie', 'ardei', 'broccoli', 'conopidă', 'dovlecel', 'vinete', 'spanac', 'salată', 'varză', 'morcovi', 'morcov', 'țelină', 'fasole verde', 'mazăre', 'ciuperci', 'ciupercă', 'sfeclă', 'avocado'], max: 150 },
];

function getFoodMaxByKeyword(foodName) {
  const nameLower = (foodName || '').toLowerCase();
  for (const rule of KEYWORD_MAX_LIMITS) {
    if (rule.keywords.some(kw => nameLower.includes(kw))) {
      return rule.max;
    }
  }
  return Infinity;
}

/**
 * Ajustează ziua la targetele macro lucrând PER MASĂ.
 * Fiecare masă primește un sub-target proporțional și fillMacro
 * se aplică doar pe alimentele din acea masă — capurile sunt per masă, nu per zi.
 */
function adjustDayToTargets(day, targets, foodsMap = {}, mealDistribution = {}) {
  if (!day.meals || day.meals.length === 0) return day;

  const VEGGIE_CATS = new Set(['vegetables', 'fruits']);
  const PROT_CATS   = ['meat', 'fish', 'eggs', 'dairy', 'legumes'];
  const CARB_CATS   = ['grains', 'starch', 'legumes'];
  const FAT_CATS    = ['fats', 'nuts'];
  const MIN_G = 5;

  // Capuri realiste PER MASĂ
  const MEAL_MAX = {
    meat: 200, fish: 180, eggs: 150, dairy: 200,
    grains: 130, starch: 220, legumes: 160,
    nuts: 40, fats: 15, other: 100,
  };

  // Slab = fat/prot < 0.5
  const isLean = f =>
    (f._protPerG || 0) >= 0.06 &&
    ((f._protPerG || 0) > 0.001 ? (f._fatPerG || 0) / (f._protPerG || 0) < 0.5 : true);

  const defaultPct = 1 / day.meals.length;

  for (const meal of day.meals) {
    if (!meal.foods || meal.foods.length === 0) continue;

    const mFoods = meal.foods;

    // ── RESET ─────────────────────────────────────────────────────────────
    mFoods.forEach(f => { f.amount = 0; f.calories = 0; f.protein = 0; f.carbs = 0; f.fat = 0; });

    // ── PRUNE duplicates per rol macro (max 1 proteină, max 1 carbo, max 1 grăsime) ──
    {
      const PROT_GROUP = new Set(['meat', 'fish', 'eggs', 'dairy', 'legumes']);
      const CARB_GROUP = new Set(['grains', 'starch']);
      const FAT_GROUP  = new Set(['fats', 'nuts']);

      const pruneGroup = (groupSet, sortFn) => {
        const inGroup = mFoods.filter(f => groupSet.has(f._category));
        if (inGroup.length <= 1) return;
        const sorted = [...inGroup].sort(sortFn);
        const remove = new Set(sorted.slice(1).map(f => f.name));
        const kept = mFoods.filter(f => !remove.has(f.name));
        mFoods.length = 0;
        kept.forEach(f => mFoods.push(f));
        meal.foods = mFoods;
      };

      pruneGroup(PROT_GROUP, (a, b) => {
        // Preferă lean, apoi densitate proteică descrescătoare
        const diff = (isLean(b) ? 1 : 0) - (isLean(a) ? 1 : 0);
        return diff !== 0 ? diff : (b._protPerG || 0) - (a._protPerG || 0);
      });
      pruneGroup(CARB_GROUP, (a, b) => (b._carbPerG || 0) - (a._carbPerG || 0));
      pruneGroup(FAT_GROUP,  (a, b) => (b._fatPerG  || 0) - (a._fatPerG  || 0));
    }

    // ── LEGUME / FRUCTE — portie fixă 80g ────────────────────────────────
    mFoods.forEach(f => {
      if (!VEGGIE_CATS.has(f._category) || !f._calPerG) return;
      f.amount   = 80;
      f.calories = 80 * f._calPerG;
      f.protein  = 80 * (f._protPerG || 0);
      f.carbs    = 80 * (f._carbPerG || 0);
      f.fat      = 80 * (f._fatPerG  || 0);
    });

    const pct = mealDistribution[meal.slotName] ?? defaultPct;
    const mT = {
      calories: targets.calories * pct,
      protein:  targets.protein  * pct,
      carbs:    targets.carbs    * pct,
      fat:      targets.fat      * pct,
    };

    // ── HELPERS ───────────────────────────────────────────────────────────
    const nonVeggie = () => mFoods.filter(f => !VEGGIE_CATS.has(f._category) && f._calPerG);
    const totals = () => mFoods.reduce(
      (a, f) => ({ cal: a.cal + f.calories, prot: a.prot + f.protein, carb: a.carb + f.carbs, fat: a.fat + f.fat }),
      { cal: 0, prot: 0, carb: 0, fat: 0 }
    );

    // Injectează un aliment nou din DB dacă masa nu are o categorie necesară
    const inject = (cats, dbKey, minDens) => {
      const existing = new Set(mFoods.map(f => f.name));
      const pool = Object.values(foodsMap).filter(fd =>
        cats.includes(fd.category) &&
        (fd[dbKey] || 0) / 100 >= minDens &&
        fd.calories_per_100g > 0 &&
        !existing.has(fd.name)
      );
      if (!pool.length) return null;
      pool.sort((a, b) => (b[dbKey] || 0) - (a[dbKey] || 0));
      const p = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
      const nf = {
        name: p.name, amount: 0, unit: 'g',
        calories: 0, protein: 0, carbs: 0, fat: 0,
        _category: p.category,
        _calPerG:  p.calories_per_100g / 100,
        _protPerG: (p.protein_per_100g  || 0) / 100,
        _carbPerG: (p.carbs_per_100g    || 0) / 100,
        _fatPerG:  (p.fat_per_100g      || 0) / 100,
      };
      mFoods.push(nf);
      meal.foods = mFoods;
      return nf;
    };

    /**
     * Scalează o singură ancoră pentru a absorbi `delta` grame de macro (densKey).
     * Respectă MEAL_MAX. Returnează macro-ul efectiv absorbit.
     */
    const scaleAnchor = (food, delta, densKey) => {
      const dens = food[densKey] || 0;
      if (dens < 0.001 || Math.abs(delta) < 0.1) return 0;
      const cap = MEAL_MAX[food._category] || 120;
      let newAmt;
      if (delta > 0) {
        const gramsNeeded = delta / dens;
        newAmt = Math.min(food.amount + gramsNeeded, cap);
      } else {
        const gramsToRemove = (-delta) / dens;
        newAmt = Math.max(MIN_G, food.amount - gramsToRemove);
      }
      const diff = newAmt - food.amount;
      if (Math.abs(diff) < 0.01) return 0;
      food.amount   += diff;
      food.calories += diff * (food._calPerG  || 0);
      food.protein  += diff * (food._protPerG || 0);
      food.carbs    += diff * (food._carbPerG || 0);
      food.fat      += diff * (food._fatPerG  || 0);
      return diff * dens; // macro absorbit efectiv
    };

    /**
     * Waterfall fill: parcurge lista de ancore în ordine.
     * Scala ancora 1 → dacă tot rămâne deficit, scala ancora 2, etc.
     * Dacă toate ancorele primare sunt la cap și tot e deficit, injectează una nouă.
     */
    const waterfallFill = (anchors, delta, densKey, injectCats, injectDbKey, injectMinDens) => {
      let rem = delta;
      // Pasul 1: ancore existente
      for (const food of anchors) {
        if (Math.abs(rem) < 0.5) break;
        rem -= scaleAnchor(food, rem, densKey);
      }
      // Pasul 2: injectează dacă tot mai e deficit și există categorii de injectat
      if (rem > 2 && injectCats) {
        const newFood = inject(injectCats, injectDbKey, injectMinDens);
        if (newFood) rem -= scaleAnchor(newFood, rem, densKey);
      }
      return rem;
    };

    /**
     * Construiește lista de ancore pentru un macro, în ordinea priorităților:
     * [primare sortate desc density, secundare sortate desc density]
     */
    const buildAnchors = (primaryCats, densKey, extraFilter = () => true) => {
      const nv = nonVeggie();
      const primary   = nv.filter(f =>  primaryCats.includes(f._category) && (f[densKey] || 0) >= 0.02 && extraFilter(f))
                          .sort((a, b) => (b[densKey] || 0) - (a[densKey] || 0));
      const secondary = nv.filter(f => !primaryCats.includes(f._category) && (f[densKey] || 0) >= 0.01 && extraFilter(f))
                          .sort((a, b) => (b[densKey] || 0) - (a[densKey] || 0));
      return [...primary, ...secondary];
    };

    // ── WATERFALL + RETRY LOOP (max 7 iterații per masă) ─────────────────
    const MAX_ITER = 7;
    for (let iter = 0; iter < MAX_ITER; iter++) {
      let t = totals();
      const calOk  = Math.abs(t.cal  - mT.calories) <= 20;
      const protOk = Math.abs(t.prot - mT.protein)  <= 4;
      const fatOk  = Math.abs(t.fat  - mT.fat)      <= 3;
      if (calOk && protOk && fatOk) break;

      // ── FAZA 1: PROTEINĂ (numai surse lean, apoi secundare) ─────────────
      const protAnchors = buildAnchors(PROT_CATS, '_protPerG',
        f => iter === 0 ? isLean(f) : true  // prima iterație: numai lean; restul: toate
      );
      if (protAnchors.length === 0 && iter === 0)
        inject(PROT_CATS, 'protein_per_100g', 0.20);

      t = totals();
      const protDelta = mT.protein - t.prot;
      if (Math.abs(protDelta) > 2)
        waterfallFill(buildAnchors(PROT_CATS, '_protPerG', f => iter === 0 ? isLean(f) : true),
          protDelta, '_protPerG', PROT_CATS, 'protein_per_100g', 0.20);

      // ── FAZA 2: GRĂSIMI ─────────────────────────────────────────────────
      t = totals();
      const fatDelta = mT.fat - t.fat;
      if (fatDelta > 2) {
        waterfallFill(buildAnchors(FAT_CATS, '_fatPerG'),
          fatDelta, '_fatPerG', FAT_CATS, 'fat_per_100g', 0.30);
      } else if (fatDelta < -2) {
        // Prea mult fat — reducem cele mai grase non-veggie
        const fattiest = nonVeggie()
          .filter(f => f.amount > MIN_G && (f._fatPerG || 0) > 0.1)
          .sort((a, b) => (b._fatPerG || 0) - (a._fatPerG || 0));
        waterfallFill(fattiest, fatDelta, '_fatPerG');
      }

      // ── FAZA 3: CARBOHIDRAȚI = calorii rămase ───────────────────────────
      t = totals();
      const carbTarget = (mT.calories - t.prot * 4 - t.fat * 9) / 4;
      const carbDelta  = carbTarget - t.carb;
      if (Math.abs(carbDelta) > 2) {
        waterfallFill(buildAnchors(CARB_CATS, '_carbPerG'),
          carbDelta, '_carbPerG', CARB_CATS, 'carbs_per_100g', 0.10);
      }

      // ── FAZA 4: SAFETY NET caloric — scala proporțional toți non-veggie ─
      t = totals();
      const calDiff = mT.calories - t.cal;
      if (Math.abs(calDiff) > 20) {
        const scalable = nonVeggie().filter(f => f.amount > 0);
        const totalCal = scalable.reduce((s, f) => s + f.calories, 0);
        if (totalCal > 0) {
          const factor = (totalCal + calDiff) / totalCal;
          scalable.forEach(f => {
            const cap    = MEAL_MAX[f._category] || 120;
            const newAmt = Math.max(MIN_G, Math.min(f.amount * factor, cap));
            f.amount   = newAmt;
            f.calories = newAmt * (f._calPerG  || 0);
            f.protein  = newAmt * (f._protPerG || 0);
            f.carbs    = newAmt * (f._carbPerG || 0);
            f.fat      = newAmt * (f._fatPerG  || 0);
          });
        }
      }
    }

    // ── ROTUNJIRE LA 5g ───────────────────────────────────────────────────
    mFoods.forEach(food => {
      if (!food._calPerG) return;
      const rounded = roundToNearest5(food.amount);
      const factor  = food.amount > 0 ? rounded / food.amount : 1;
      food.amount   = rounded;
      food.calories = Math.max(0, Math.round(food.calories * factor));
      food.protein  = Math.max(0, Math.round(food.protein  * factor));
      food.carbs    = Math.max(0, Math.round(food.carbs    * factor));
      food.fat      = Math.max(0, Math.round(food.fat      * factor));
    });

    meal.foods = mFoods.filter(f => (f.amount || 0) >= MIN_G);
    meal.mealTotals = {
      calories: meal.foods.reduce((s, f) => s + f.calories, 0),
      protein:  meal.foods.reduce((s, f) => s + f.protein,  0),
      carbs:    meal.foods.reduce((s, f) => s + f.carbs,    0),
      fat:      meal.foods.reduce((s, f) => s + f.fat,      0),
    };
  }

  recalculateDayTotals(day);

  console.log(`[DAY ${day.day}] cal=${day.dailyTotals.calories} P=${day.dailyTotals.protein} C=${day.dailyTotals.carbs} F=${day.dailyTotals.fat} | target cal=${targets.calories} P=${targets.protein} C=${targets.carbs} F=${targets.fat}`);

  return day;
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
    weight_loss:   'Slabit',
    muscle_gain:   'Crestere masa musculara',
    maintenance:   'Mentinere',
    recomposition: 'Recompozitie corporala',
  };
  return labels[goal] || 'Mentinere';
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
  const distributions = {
    3: { 'Masa 1': 0.40, 'Gustare': 0.15, 'Masa 2': 0.45 },
    4: { 'Masa 1': 0.30, 'Gustare 1': 0.10, 'Masa 2': 0.45, 'Gustare 2': 0.15 },
    5: { 'Masa 1': 0.25, 'Gustare 1': 0.10, 'Masa 2': 0.30, 'Gustare 2': 0.10, 'Masa 3': 0.25 },
  };
  return distributions[mealsPerDay] || distributions[3];
}
