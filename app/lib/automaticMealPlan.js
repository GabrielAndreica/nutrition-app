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

function normalizeForMatch(value = '') {
  return normalizeName(value)
    .replace(/\s*\/.*$/, '')
    .replace(/\s{2,}/g, ' ')
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

function buildFoodsMap(foods = []) {
  const map = new Map();
  for (const food of foods || []) {
    if (!food?.name) continue;
    map.set(food.name, food);
    map.set(normalizeForMatch(food.name), food);
  }
  return map;
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parseList(parsed);
    } catch {}
    return trimmed
      .replace(/[{}"]/g, '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseRecipeIngredients(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRecipeMealType(value) {
  const key = normalizeForMatch(value).replace(/\s+/g, '_');
  if (['breakfast', 'mic_dejun', 'micdejun'].includes(key)) return 'breakfast';
  if (['lunch', 'pranz', 'prânz'].includes(key)) return 'lunch';
  if (['dinner', 'cina', 'cină'].includes(key)) return 'dinner';
  if (['snack', 'gustare'].includes(key)) return 'snack';
  return key || 'snack';
}

function recipeMatchesDiet(recipe, dietType = 'omnivore') {
  if (!dietType || dietType === 'omnivore') return true;
  const dietTypes = parseList(recipe.diet_types).map(item => normalizeForMatch(item));
  if (dietType === 'vegetarian') return dietTypes.includes('vegetarian') || dietTypes.includes('vegan');
  return dietTypes.includes(normalizeForMatch(dietType));
}

function recipeContainsBlockedTerm(recipe, blockedTerms = []) {
  if (!blockedTerms.length) return false;
  const haystack = [
    recipe.name,
    recipe.protein_source,
    ...parseRecipeIngredients(recipe.ingredients).map(ingredient => ingredient.food_name || ingredient.name || ''),
  ].map(normalizeForMatch).join(' ');
  return blockedTerms.some(term => haystack.includes(normalizeForMatch(term)));
}

function getEligibleRecipesByType(recipes = [], profile = {}) {
  const blockedTerms = [
    ...parseList(profile.allergies),
    ...parseList(profile.foodPreferences || profile.preferences)
      .filter(item => /fara|fără|nu |evit|exclude/i.test(item)),
  ];

  const byType = { breakfast: [], lunch: [], snack: [], dinner: [] };
  for (const recipe of recipes || []) {
    const mealType = normalizeRecipeMealType(recipe.meal_type);
    if (!byType[mealType]) continue;
    if (!recipeMatchesDiet(recipe, profile.dietType || profile.diet_type || 'omnivore')) continue;
    if (recipeContainsBlockedTerm(recipe, blockedTerms)) continue;
    byType[mealType].push({
      ...recipe,
      meal_type: mealType,
      ingredients: parseRecipeIngredients(recipe.ingredients),
    });
  }
  return byType;
}

function pickRecipeVariants(pool = [], count = 3) {
  const shuffled = shuffle(pool);
  if (shuffled.length === 0) return [];
  return Array.from({ length: count }, (_, index) => shuffled[index % shuffled.length]);
}

function resolveIngredientFood(ingredient, foodsMap) {
  const rawName = ingredient.food_name || ingredient.name || ingredient.food || ingredient.foodName;
  if (!rawName) return null;
  return foodsMap.get(rawName) || foodsMap.get(normalizeForMatch(rawName)) || null;
}

function getIngredientBaseAmount(ingredient, food) {
  let amount = Number(ingredient.base_amount_g ?? ingredient.amount_g ?? ingredient.amount ?? ingredient.grams);
  if (!amount && ingredient.ratio_pct) {
    const cal100 = Math.max(Number(food?.calories_per_100g) || 100, 1);
    amount = Math.round((Number(ingredient.ratio_pct) * 500) / (cal100 / 100));
  }
  return Math.max(5, Number.isFinite(amount) ? amount : 100);
}

function makeRecipeFoodItem(food, amount) {
  return makeDbFoodItem(food, amount);
}

function scaleRecipeToMealTarget(recipe, mealTargetCalories, foodsMap) {
  const ingredients = parseRecipeIngredients(recipe.ingredients);
  const items = [];

  for (const ingredient of ingredients) {
    const food = resolveIngredientFood(ingredient, foodsMap);
    if (!food || !Number(food.calories_per_100g)) continue;
    const baseAmount = getIngredientBaseAmount(ingredient, food);
    const category = food.category || classifyFood(food);
    const isLowDensity = category === 'vegetables' || category === 'fruits' || Number(food.calories_per_100g) < 60;
    items.push({
      food,
      baseAmount,
      isLowDensity,
      maxAmount: getMaxAmount(food),
    });
  }

  if (!items.length) return [];

  const scalableBaseCalories = items.reduce((sum, item) => {
    if (item.isLowDensity) return sum;
    return sum + (item.baseAmount / 100) * Number(item.food.calories_per_100g);
  }, 0);
  const scaleFactor = scalableBaseCalories > 0 ? mealTargetCalories / scalableBaseCalories : 1;

  const foods = items.map(item => {
    const rawAmount = item.isLowDensity
      ? item.baseAmount
      : item.baseAmount * scaleFactor;
    const amount = Math.min(rawAmount, item.maxAmount);
    return makeRecipeFoodItem(item.food, amount);
  });

  let currentCalories = foods.reduce((sum, food) => sum + (Number(food.calories) || 0), 0);
  const deficit = mealTargetCalories - currentCalories;
  if (deficit > mealTargetCalories * 0.05) {
    const candidates = foods
      .filter(food => Number(food._per100?.calories) >= 60)
      .sort((a, b) => b._per100.calories - a._per100.calories);

    for (const food of candidates) {
      if (currentCalories >= mealTargetCalories * 0.98) break;
      const room = Math.max(0, (food._maxAmount || 250) - food.amount);
      if (room < 5) continue;
      const needed = (mealTargetCalories - currentCalories) / Math.max(food._per100.calories / 100, 0.01);
      const extra = Math.min(room, needed);
      if (extra >= 5) {
        setFoodAmount(food, food.amount + extra);
        currentCalories = foods.reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
      }
    }
  }

  return foods;
}

function buildRecipeMeal(slot, recipe, targets, foodsMap) {
  const mealTargets = {
    calories: Math.round(targets.calories * slot.pct),
    protein: Math.round(targets.protein * slot.pct),
    carbs: Math.round(targets.carbs * slot.pct),
    fat: Math.round(targets.fat * slot.pct),
  };
  const foods = scaleRecipeToMealTarget(recipe, mealTargets.calories, foodsMap);
  if (!foods.length) throw new Error(`Rețeta "${recipe?.name || slot.label}" nu are ingrediente potrivite în foods.`);

  return {
    name: recipe.name || slot.label,
    mealType: slot.mealType,
    recipeId: recipe.id || null,
    foods,
    preparation: recipe.preparation || 'Pregătește rețeta conform ingredientelor și gramajelor afișate.',
    targetCalories: mealTargets.calories,
    macroTargets: mealTargets,
    mealTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  };
}

function cloneDayForIndex(day, dayIndex) {
  return {
    ...JSON.parse(JSON.stringify(day)),
    day: dayIndex + 1,
    dayName: DAY_NAMES[dayIndex] || `Ziua ${dayIndex + 1}`,
  };
}

function buildRecipePatternDay(patternIndex, targets, recipeVariants, foodsMap) {
  const meals = MEAL_SLOTS.map(slot => {
    const variants = recipeVariants[slot.mealType] || [];
    const variantIndex = slot.mealType === 'snack' && slot.label.includes('2')
      ? patternIndex + 1
      : patternIndex;
    const recipe = variants[variantIndex % Math.max(variants.length, 1)];
    if (!recipe) throw new Error(`Nu există rețete disponibile pentru ${slot.label}.`);
    return buildRecipeMeal(slot, recipe, targets, foodsMap);
  });

  const day = {
    day: patternIndex + 1,
    dayName: DAY_NAMES[patternIndex] || `Ziua ${patternIndex + 1}`,
    meals,
    dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  };

  recalculateDay(day);
  tuneDayToTargets(day, targets);
  return cleanForStorage(day);
}

function buildRecipeWeekDays(targets, recipeVariants, foodsMap) {
  const patternDays = [0, 1, 2].map(patternIndex =>
    buildRecipePatternDay(patternIndex, targets, recipeVariants, foodsMap)
  );
  const dayPattern = [0, 0, 1, 1, 2, 2, 0];
  return dayPattern.map((patternIndex, dayIndex) => cloneDayForIndex(patternDays[patternIndex], dayIndex));
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

  const [{ data: foods, error: foodsError }, { data: recipes, error: recipesError }] = await Promise.all([
    supabase
    .from('foods')
      .select('name, category, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, max_amount_per_meal'),
    supabase
      .from('recipes')
      .select('id, name, meal_type, diet_types, protein_source, preparation, ingredients'),
  ]);

  if (foodsError) throw new Error(`Nu am putut încărca alimentele: ${foodsError.message}`);
  if (recipesError) throw new Error(`Nu am putut încărca rețetele: ${recipesError.message}`);

  const foodPools = buildFoodPools(foods || []);
  if (!foodPools.all.length) throw new Error('Nu există alimente disponibile pentru planul automat.');

  const foodsMap = buildFoodsMap(foods || []);
  const eligibleByType = getEligibleRecipesByType(recipes || [], profile);
  const recipeVariants = {};

  for (const mealType of ['breakfast', 'lunch', 'snack', 'dinner']) {
    const pool = (eligibleByType[mealType] || []).filter(recipe =>
      parseRecipeIngredients(recipe.ingredients).some(ingredient => resolveIngredientFood(ingredient, foodsMap))
    );
    if (!pool.length) {
      throw new Error(`Nu există rețete disponibile pentru ${mealType} cu ingrediente mapate în foods.`);
    }
    recipeVariants[mealType] = pickRecipeVariants(pool, 3);
  }

  const days = buildRecipeWeekDays(targets, recipeVariants, foodsMap);

  const plan = {
    clientName: profile.name || 'Utilizator',
    dailyTargets: targets,
    recipeRotation: {
      pattern: [1, 1, 2, 2, 3, 3, 1],
      breakfastRecipeIds: recipeVariants.breakfast.map(recipe => recipe.id),
      lunchRecipeIds: recipeVariants.lunch.map(recipe => recipe.id),
      snackRecipeIds: recipeVariants.snack.map(recipe => recipe.id),
      dinnerRecipeIds: recipeVariants.dinner.map(recipe => recipe.id),
    },
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
