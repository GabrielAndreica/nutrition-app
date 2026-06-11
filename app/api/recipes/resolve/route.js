import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

const DEFAULT_TARGET = { breakfast: 400, lunch: 500, dinner: 500, snack: 200 };
const ROUND5 = (v) => Math.max(5, Math.round(v / 5) * 5);
const ROUND_KCAL  = (v) => Math.round(Number(v) || 0);
const ROUND_MACRO = (v) => Math.round((Number(v) || 0) * 10) / 10;

function normalizeForMatch(str) {
  return (str || '').toLowerCase()
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

/**
 * POST /api/recipes/resolve
 * Body: { recipeId, targetCalories? }
 * Returns resolved meal: { name, mealType, preparation, foods[], mealTotals }
 */
export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'trainer') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { recipeId, targetCalories } = body;
  if (!recipeId) return NextResponse.json({ error: 'recipeId este obligatoriu.' }, { status: 400 });

  const supabase = getSupabase();

  // Load recipe + foods in parallel
  const [recipeRes, foodsRes] = await Promise.all([
    supabase.from('recipes').select('id, name, meal_type, preparation, ingredients').eq('id', recipeId).single(),
    supabase.from('foods').select('name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, max_amount_per_meal, category'),
  ]);

  if (recipeRes.error || !recipeRes.data) {
    return NextResponse.json({ error: 'Rețeta nu a fost găsită.' }, { status: 404 });
  }
  const recipe = recipeRes.data;
  const foodRows = foodsRes.data || [];

  // Build foods map (name + aliases + normalized)
  const foodsMap = new Map();
  for (const f of foodRows) {
    foodsMap.set(f.name, f);
    foodsMap.set(normalizeForMatch(f.name), f);
    const aliases = Array.isArray(f.aliases)
      ? f.aliases
      : (typeof f.aliases === 'string' ? f.aliases.replace(/[{}"]/g, '').split(',') : []);
    aliases.map(a => String(a || '').trim()).filter(Boolean).forEach(alias => {
      foodsMap.set(alias, f);
      foodsMap.set(normalizeForMatch(alias), f);
    });
  }

  // Determine target calories
  const mealCal = targetCalories || DEFAULT_TARGET[recipe.meal_type] || 450;
  const ingredients = recipe.ingredients || [];

  // Resolve ingredients → items with baseAmount
  let items = ingredients.map(ing => {
    const food = foodsMap.get(ing.food_name) || foodsMap.get(normalizeForMatch(ing.food_name));
    let baseAmount = Number(ing.base_amount_g) || 0;
    if (!baseAmount && ing.ratio_pct) {
      const cal100 = food?.calories_per_100g || 100;
      baseAmount = Math.max(5, Math.round((ing.ratio_pct * 500) / (cal100 / 100)));
    }
    if (!baseAmount) baseAmount = 100;

    if (!food || !food.calories_per_100g) {
      return {
        name: ing.food_name, baseAmount, isVeg: false,
        cal100: 100, p100: 5, c100: 10, f100: 3,
        maxGrams: 200,
      };
    }

    const cat   = food.category || 'default';
    const isVeg = cat === 'vegetables' || cat === 'fruits' || food.calories_per_100g < 60;
    const maxGrams = food.max_amount_per_meal || (cat === 'grains' ? 120 : cat === 'meat' || cat === 'fish' ? 200 : 150);

    return {
      name: food.name, baseAmount, isVeg,
      cal100: food.calories_per_100g,
      p100:   food.protein_per_100g,
      c100:   food.carbs_per_100g,
      f100:   food.fat_per_100g,
      maxGrams,
    };
  }).filter(Boolean);

  // Deduplicate by normalized name
  {
    const seen = new Map();
    for (const item of items) {
      const key = normalizeForMatch(item.name);
      if (seen.has(key)) seen.get(key).baseAmount += item.baseAmount;
      else seen.set(key, item);
    }
    items = Array.from(seen.values());
  }

  // Scale to target calories
  const baseCal = items.reduce((s, i) => s + (i.isVeg ? 0 : (i.baseAmount / 100) * i.cal100), 0);
  const scale   = baseCal > 1 ? mealCal / baseCal : 1;

  for (const item of items) {
    if (item.isVeg) {
      item.finalGrams = ROUND5(Math.min(item.baseAmount, item.maxGrams));
    } else {
      item.finalGrams = ROUND5(Math.max(Math.min(item.baseAmount * scale, item.maxGrams), 5));
    }
  }

  // Build foods array for the meal
  const foods = items.map(i => ({
    name:         i.name,
    amount:       i.finalGrams,
    unit:         'g',
    displayAmount: `${i.finalGrams}g`,
    calories:     ROUND_KCAL((i.finalGrams / 100) * i.cal100),
    protein:      ROUND_MACRO((i.finalGrams / 100) * i.p100),
    carbs:        ROUND_MACRO((i.finalGrams / 100) * i.c100),
    fat:          ROUND_MACRO((i.finalGrams / 100) * i.f100),
    _per100g: {
      calories: i.cal100,
      protein:  i.p100,
      carbs:    i.c100,
      fat:      i.f100,
    },
  }));

  const mealTotals = foods.reduce(
    (acc, f) => ({
      calories: acc.calories + f.calories,
      protein:  acc.protein  + f.protein,
      carbs:    acc.carbs    + f.carbs,
      fat:      acc.fat      + f.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  mealTotals.calories = ROUND_KCAL(mealTotals.calories);
  mealTotals.protein  = ROUND_MACRO(mealTotals.protein);
  mealTotals.carbs    = ROUND_MACRO(mealTotals.carbs);
  mealTotals.fat      = ROUND_MACRO(mealTotals.fat);

  return NextResponse.json({
    meal: {
      name:        recipe.name,
      mealType:    recipe.meal_type,
      preparation: recipe.preparation || '',
      foods,
      mealTotals,
    },
  });
}
