const MEAL_SLOTS = [
  { label: 'Mic Dejun', mealType: 'breakfast', pct: 0.2 },
  { label: 'Gustare 1', mealType: 'snack', pct: 0.15 },
  { label: 'Prânz', mealType: 'lunch', pct: 0.3 },
  { label: 'Gustare 2', mealType: 'snack', pct: 0.15 },
  { label: 'Cină', mealType: 'dinner', pct: 0.2 },
];

const DAY_NAMES = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];

const LIMITS = {
  caloriesPct: 0.1,
  proteinG: 5,
  carbsG: 10,
  fatG: 5,
};

const DEFAULT_MAX_GRAMS = {
  protein: 250,
  carb: 120,
  fat: 25,
  mixed: 300,
  low: 180,
  default: 250,
};

function normalizeName(value = '') {
  return String(value).toLowerCase()
    .replace(/\s*\(crud[aă]?\)/gi, '')
    .replace(/\s*\(fiert[aă]?\)/gi, '')
    .replace(/\s*\(fiartă\)/gi, '')
    .replace(/\s*\(la (tigaie|cuptor|grătar|gratar|abur)\)/gi, '')
    .replace(/\s*\(copt[aă]?\)/gi, '')
    .replace(/\s*\(conserv[aă]\)/gi, '')
    .replace(/\s*\(\d+%\)/gi, '')
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/ş/g, 's').replace(/ţ/g, 't')
    .replace(/[()%]/g, '')
    .trim();
}

function roundToNearest5(value) {
  return Math.max(5, Math.round((Number(value) || 5) / 5) * 5);
}

function shuffle(items) {
  const copy = [...(items || [])];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function calculateTargetCalories(profile) {
  const weight = Number(profile.weight) || 70;
  const height = Number(profile.height) || 175;
  const age = Number(profile.age) || 30;
  const gender = String(profile.gender || 'M').toUpperCase();
  const activityLevel = profile.activityLevel || profile.activity_level || 'moderate';

  const bmr = gender === 'M'
    ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age
    : 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age;

  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.65,
    very_active: 1.725,
  };

  const goalAdjustments = {
    weight_loss: 0.85,
    muscle_gain: 1.1,
    maintenance: 1,
    recomposition: 0.95,
    endurance: 1.05,
  };

  return Math.round(
    bmr *
    (activityMultipliers[activityLevel] || 1.55) *
    (goalAdjustments[profile.goal] || 1)
  );
}

function calculateMacros(profile, targetCalories) {
  const weight = Number(profile.weight) || 70;
  const goal = profile.goal || 'maintenance';
  const proteinPerKg = goal === 'weight_loss' || goal === 'recomposition' ? 2.25 : 1.9;
  const fatPerKg = 1;
  const protein = Math.round(proteinPerKg * weight);
  const fat = Math.round(fatPerKg * weight);
  const carbs = Math.round(Math.max(targetCalories - protein * 4 - fat * 9, 0) / 4);
  return { protein, carbs, fat };
}

function classifyFood(food) {
  const calories = Math.max(Number(food.calories_per_100g) || 1, 1);
  const proteinPct = ((Number(food.protein_per_100g) || 0) * 4) / calories;
  const carbsPct = ((Number(food.carbs_per_100g) || 0) * 4) / calories;
  const fatPct = ((Number(food.fat_per_100g) || 0) * 9) / calories;
  if ((Number(food.fat_per_100g) || 0) >= 15 && fatPct >= 0.45) return 'fat';
  if (calories < 60 && (Number(food.protein_per_100g) || 0) < 8) return 'low';
  if ((Number(food.protein_per_100g) || 0) >= 15 && proteinPct >= 0.35) return 'protein';
  if ((Number(food.carbs_per_100g) || 0) >= 25 && carbsPct >= 0.45) return 'carb';
  return 'mixed';
}

function getMaxAmount(food) {
  const name = normalizeName(food.name);
  if (name.includes('ulei')) return 15;
  if (name.includes('ou')) return 120;
  if (name.includes('iaurt')) return 300;
  if (name.includes('paine')) return 140;
  if (name.includes('orez') || name.includes('paste') || name.includes('ovaz')) return 120;
  if (name.includes('pui') || name.includes('curcan') || name.includes('vita') || name.includes('peste') || name.includes('somon')) return 230;
  if (name.includes('nuci') || name.includes('migdale') || name.includes('arahide')) return 40;
  return Number(food.max_amount_per_meal) || DEFAULT_MAX_GRAMS[classifyFood(food)] || DEFAULT_MAX_GRAMS.default;
}

function recalculateDay(day) {
  for (const meal of day.meals || []) {
    const mealTotals = (meal.foods || []).reduce((acc, food) => ({
      calories: acc.calories + (Number(food.calories) || 0),
      protein: acc.protein + (Number(food.protein) || 0),
      carbs: acc.carbs + (Number(food.carbs) || 0),
      fat: acc.fat + (Number(food.fat) || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
    meal.mealTotals = {
      calories: Math.round(mealTotals.calories),
      protein: Math.round(mealTotals.protein),
      carbs: Math.round(mealTotals.carbs),
      fat: Math.round(mealTotals.fat),
    };
  }

  const dailyTotals = (day.meals || []).reduce((acc, meal) => ({
    calories: acc.calories + (meal.mealTotals?.calories || 0),
    protein: acc.protein + (meal.mealTotals?.protein || 0),
    carbs: acc.carbs + (meal.mealTotals?.carbs || 0),
    fat: acc.fat + (meal.mealTotals?.fat || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  day.dailyTotals = {
    calories: Math.round(dailyTotals.calories),
    protein: Math.round(dailyTotals.protein),
    carbs: Math.round(dailyTotals.carbs),
    fat: Math.round(dailyTotals.fat),
  };
}

function setFoodAmount(food, amount) {
  const nextAmount = roundToNearest5(amount);
  const scale = nextAmount / 100;
  food.amount = nextAmount;
  food.calories = Math.round(food._per100.calories * scale);
  food.protein = Math.round(food._per100.protein * scale);
  food.carbs = Math.round(food._per100.carbs * scale);
  food.fat = Math.round(food._per100.fat * scale);
}

function scoreTotals(totals, targets) {
  const calTolerance = targets.calories * LIMITS.caloriesPct;
  const penalties = [
    Math.max(0, Math.abs(totals.calories - targets.calories) - calTolerance) / Math.max(calTolerance, 1),
    Math.max(0, Math.abs(totals.protein - targets.protein) - LIMITS.proteinG) / LIMITS.proteinG,
    Math.max(0, Math.abs(totals.carbs - targets.carbs) - LIMITS.carbsG) / LIMITS.carbsG,
    Math.max(0, Math.abs(totals.fat - targets.fat) - LIMITS.fatG) / LIMITS.fatG,
  ];
  return penalties.reduce((sum, value) => sum + value * value, 0);
}

function isWithinTargets(totals, targets) {
  return (
    Math.abs(totals.calories - targets.calories) <= targets.calories * LIMITS.caloriesPct &&
    Math.abs(totals.protein - targets.protein) <= LIMITS.proteinG &&
    Math.abs(totals.carbs - targets.carbs) <= LIMITS.carbsG &&
    Math.abs(totals.fat - targets.fat) <= LIMITS.fatG
  );
}

function tuneDayToTargets(day, targets) {
  recalculateDay(day);
  const foods = day.meals.flatMap(meal => meal.foods || []);

  for (let i = 0; i < 500; i += 1) {
    const currentScore = scoreTotals(day.dailyTotals, targets);
    if (currentScore === 0 || isWithinTargets(day.dailyTotals, targets)) break;

    let best = null;
    for (const food of foods) {
      const originalAmount = food.amount;
      const maxAmount = Math.max(food._maxAmount || 250, 5);
      for (const delta of [-5, 5]) {
        const nextAmount = originalAmount + delta;
        if (nextAmount < 5 || nextAmount > maxAmount) continue;
        setFoodAmount(food, nextAmount);
        recalculateDay(day);
        const nextScore = scoreTotals(day.dailyTotals, targets);
        if (nextScore + 0.0001 < currentScore && (!best || nextScore < best.score)) {
          best = { food, amount: nextAmount, score: nextScore };
        }
      }
      setFoodAmount(food, originalAmount);
      recalculateDay(day);
    }

    if (!best) break;
    setFoodAmount(best.food, best.amount);
    recalculateDay(day);
  }
}

function cleanForStorage(day) {
  for (const meal of day.meals || []) {
    for (const food of meal.foods || []) {
      food.displayAmount = `${food.amount}${food.unit || 'g'}`;
      delete food._per100;
      delete food._maxAmount;
    }
  }
  return day;
}

function makeDbFoodItem(food, amount) {
  const scale = roundToNearest5(amount) / 100;
  return {
    name: food.name,
    amount: Math.round(scale * 100),
    unit: 'g',
    calories: Math.round((Number(food.calories_per_100g) || 0) * scale),
    protein: Math.round((Number(food.protein_per_100g) || 0) * scale),
    carbs: Math.round((Number(food.carbs_per_100g) || 0) * scale),
    fat: Math.round((Number(food.fat_per_100g) || 0) * scale),
    _per100: {
      calories: Number(food.calories_per_100g) || 0,
      protein: Number(food.protein_per_100g) || 0,
      carbs: Number(food.carbs_per_100g) || 0,
      fat: Number(food.fat_per_100g) || 0,
    },
    _maxAmount: getMaxAmount(food),
  };
}

function pickFood(pool, fallbackPool = []) {
  const source = pool?.length ? pool : fallbackPool;
  return shuffle(source)[0] || null;
}

function buildFoodPools(foods = []) {
  const usable = foods.filter(food =>
    food?.name &&
    Number(food.calories_per_100g) > 0 &&
    Number.isFinite(Number(food.protein_per_100g)) &&
    Number.isFinite(Number(food.carbs_per_100g)) &&
    Number.isFinite(Number(food.fat_per_100g))
  );
  const byRole = {
    protein: usable.filter(food => classifyFood(food) === 'protein'),
    carb: usable.filter(food => classifyFood(food) === 'carb'),
    fat: usable.filter(food => classifyFood(food) === 'fat'),
    low: usable.filter(food => classifyFood(food) === 'low'),
    mixed: usable.filter(food => classifyFood(food) === 'mixed'),
    all: usable,
  };
  return byRole;
}

function prettifyFoodName(name = '') {
  return String(name)
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildMealName(slot, foods) {
  const names = (foods || [])
    .map(food => prettifyFoodName(food.name))
    .filter(Boolean);
  if (slot.mealType === 'snack') {
    return names.slice(0, 2).join(' + ') || slot.label;
  }
  if (slot.mealType === 'breakfast') {
    return names.slice(0, 2).join(' cu ') || slot.label;
  }
  const protein = names[0] || slot.label;
  const side = names[1] ? ` cu ${names[1]}` : '';
  return `${protein}${side}`;
}

function buildFallbackMeal(slot, foodPools) {
  const foods = [];
  const add = (food, amount) => {
    if (food) foods.push(makeDbFoodItem(food, amount));
  };

  if (slot.mealType === 'snack') {
    add(pickFood(foodPools.mixed, foodPools.all), 180);
    add(pickFood(foodPools.carb, foodPools.all), 80);
  } else if (slot.mealType === 'breakfast') {
    add(pickFood([...foodPools.mixed, ...foodPools.protein], foodPools.all), 160);
    add(pickFood(foodPools.carb, foodPools.all), 60);
    add(pickFood(foodPools.low, foodPools.all), 80);
  } else {
    add(pickFood(foodPools.protein, foodPools.all), 160);
    add(pickFood(foodPools.carb, foodPools.all), slot.mealType === 'lunch' ? 85 : 65);
    add(pickFood(foodPools.low, foodPools.all), 120);
    add(pickFood(foodPools.fat, foodPools.all), 10);
  }

  return {
    name: buildMealName(slot, foods),
    mealType: slot.mealType,
    foods,
    preparation: 'Ajustează simplu ingredientele și servește masa conform gramajelor afișate.',
    targetCalories: 0,
    macroTargets: null,
    mealTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  };
}

function buildFallbackDay(dayIndex, targets, foodPools) {
  const meals = MEAL_SLOTS.map(slot => buildFallbackMeal(slot, foodPools));
  const day = {
    day: dayIndex + 1,
    dayName: DAY_NAMES[dayIndex] || `Ziua ${dayIndex + 1}`,
    meals,
    dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  };
  recalculateDay(day);
  tuneDayToTargets(day, targets);
  return cleanForStorage(day);
}

function buildBestFoodDay(dayIndex, targets, foodPools) {
  let bestDay = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = buildFallbackDay(dayIndex, targets, foodPools);
    const score = scoreTotals(candidate.dailyTotals, targets);
    if (score < bestScore) {
      bestScore = score;
      bestDay = candidate;
    }
    if (isWithinTargets(candidate.dailyTotals, targets)) break;
  }

  if (!bestDay) throw new Error(`Nu am putut construi ziua ${dayIndex + 1} din alimentele disponibile.`);
  return bestDay;
}

export async function createAutomaticMealPlanForUser({ supabase, userId, profile }) {
  if (!supabase || !userId || !profile) {
    throw new Error('Date insuficiente pentru planul alimentar automat.');
  }

  const targetCalories = calculateTargetCalories(profile);
  const macros = calculateMacros(profile, targetCalories);
  const targets = {
    calories: Math.round(targetCalories),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  };

  const { data: foods, error: foodsError } = await supabase
    .from('foods')
    .select('name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, max_amount_per_meal');

  if (foodsError) throw new Error(`Nu am putut încărca alimentele: ${foodsError.message}`);

  const foodPools = buildFoodPools(foods || []);
  if (!foodPools.all.length) throw new Error('Nu există alimente disponibile pentru planul automat.');

  const days = Array.from({ length: 7 }, (_, index) => buildBestFoodDay(index, targets, foodPools));

  const plan = {
    clientName: profile.name || 'Utilizator',
    dailyTargets: targets,
    days,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('meal_plans')
    .insert({
      client_id: userId,
      plan_data: plan,
      daily_targets: targets,
    })
    .select('id')
    .single();

  if (insertError) throw new Error(`Nu am putut salva planul alimentar: ${insertError.message}`);

  return {
    mealPlanId: inserted?.id || null,
    targets,
    plan,
  };
}
