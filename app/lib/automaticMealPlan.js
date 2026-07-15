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

const DEFAULT_MIN_GRAMS = {
  protein: 90,
  carb: 35,
  fat: 5,
  mixed: 60,
  low: 30,
  default: 30,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FOOD_SELECT = [
  'id',
  'name',
  'aliases',
  'calories_per_100g',
  'protein_per_100g',
  'carbs_per_100g',
  'fat_per_100g',
  'category',
  'diet_types',
  'allergens',
  'max_amount_per_meal',
  'min_amount_per_meal',
  'daily_max_amount',
  'grams_per_unit',
  'is_active',
].join(', ');
const RECIPE_SELECT = [
  'id',
  'name',
  'meal_type',
  'diet_types',
  'protein_source',
  'preparation',
  'ingredients',
  'is_free',
  'coin_price',
  'image_storage_bucket',
  'image_storage_path',
  'created_at',
].join(', ');
const DEFAULT_RECIPE_IMAGE_BUCKET = 'imagini-mancare';

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

function getBooleanRpcResult(data) {
  if (typeof data === 'boolean') return data;
  if (Array.isArray(data)) return data[0]?.claimed === true || data[0] === true;
  if (data && typeof data === 'object') return data.claimed === true;
  return false;
}

export async function claimAutomaticMealPlanGenerationLock({ supabase, userId, timeoutMinutes = 10 } = {}) {
  if (!supabase || !userId) return { claimed: false, degraded: true };

  const { data, error } = await supabase.rpc('claim_meal_plan_generation_lock', {
    p_user_id: userId,
    p_lock_timeout_minutes: timeoutMinutes,
  });

  if (error) {
    console.error('[automaticMealPlan] generation lock unavailable:', error);
    return { claimed: true, degraded: true };
  }

  return { claimed: getBooleanRpcResult(data), degraded: false };
}

export async function releaseAutomaticMealPlanGenerationLock({ supabase, userId, errorMessage = null } = {}) {
  if (!supabase || !userId) return;

  const { error } = await supabase.rpc('release_meal_plan_generation_lock', {
    p_user_id: userId,
    p_error: errorMessage,
  });

  if (error) {
    console.error('[automaticMealPlan] generation lock release failed:', error);
  }
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

export function calculateTargetCalories(profile) {
  const weight = Number(profile.weight) || 70;
  const targetWeight = Number(profile.targetWeight ?? profile.target_weight);
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

  const maintenanceCalories = bmr * (activityMultipliers[activityLevel] || 1.55);
  let adjustment = 0;

  if (Number.isFinite(targetWeight) && targetWeight >= 30 && targetWeight <= 300) {
    const diffKg = targetWeight - weight;
    const distance = Math.abs(diffKg);
    if (diffKg <= -1) {
      adjustment = -Math.min(500, Math.max(250, distance * 45));
    } else if (diffKg >= 1) {
      adjustment = Math.min(400, Math.max(180, distance * 35));
    }
  } else {
    const fallbackAdjustments = {
      weight_loss: -400,
      muscle_gain: 300,
      maintenance: 0,
      recomposition: -150,
      endurance: 150,
    };
    adjustment = fallbackAdjustments[profile.goal] || 0;
  }

  const minCalories = gender === 'M' ? 1500 : 1200;
  const floor = Math.max(minCalories, bmr * 1.15);
  return Math.round(Math.max(floor, maintenanceCalories + adjustment));
}

export function calculateMacros(profile, targetCalories) {
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
  const calories = Math.max(getPer100(food, 'calories') || 1, 1);
  const protein = getPer100(food, 'protein');
  const carbs = getPer100(food, 'carbs');
  const fat = getPer100(food, 'fat');
  const proteinPct = (protein * 4) / calories;
  const carbsPct = (carbs * 4) / calories;
  const fatPct = (fat * 9) / calories;
  if (fat >= 15 && fatPct >= 0.45) return 'fat';
  if (calories < 60 && protein < 8) return 'low';
  if (protein >= 15 && proteinPct >= 0.35) return 'protein';
  if (carbs >= 25 && carbsPct >= 0.45) return 'carb';
  return 'mixed';
}

function getPer100(food, nutrient) {
  const dbKeys = {
    calories: 'calories_per_100g',
    protein: 'protein_per_100g',
    carbs: 'carbs_per_100g',
    fat: 'fat_per_100g',
  };
  return Number(food?.[dbKeys[nutrient]] ?? food?._per100?.[nutrient]) || 0;
}

function includesAny(value, terms) {
  return terms.some(term => value.includes(term));
}

function getFoodKey(food) {
  return normalizeForMatch(food?.name || food?.id || '');
}

function getFoodLimitProfile(food = {}) {
  const name = normalizeName(food.name);
  const category = normalizeForMatch(food.category || '');
  const role = classifyFood(food);
  let min = DEFAULT_MIN_GRAMS[role] || DEFAULT_MIN_GRAMS.default;
  let max = Number(food.max_amount_per_meal) || DEFAULT_MAX_GRAMS[role] || DEFAULT_MAX_GRAMS.default;
  let dailyMax = null;

  if (includesAny(name, ['ulei', 'unt', 'maioneza'])) {
    min = 5;
    max = 15;
    dailyMax = 25;
  } else if (includesAny(name, ['nuci', 'migdale', 'arahide', 'caju', 'seminte'])) {
    min = 10;
    max = 35;
    dailyMax = 50;
  } else if (name.includes('banana')) {
    min = 80;
    max = 150;
    dailyMax = 200;
  } else if (includesAny(name, ['mar', 'para', 'portocala', 'fructe de padure', 'afine', 'capsuni'])) {
    min = 80;
    max = 180;
    dailyMax = 260;
  } else if (includesAny(name, ['kefir', 'lapte batut', 'iaurt'])) {
    min = 150;
    max = 300;
    dailyMax = 500;
  } else if (includesAny(name, ['paine', 'lipie', 'tortilla'])) {
    min = 40;
    max = 120;
    dailyMax = 180;
  } else if (includesAny(name, ['cascaval', 'mozzarella', 'telemea', 'parmezan'])) {
    min = 25;
    max = 60;
    dailyMax = 90;
  } else if (includesAny(name, ['branza cottage', 'branza de vaci', 'skyr'])) {
    min = 120;
    max = 250;
    dailyMax = 350;
  } else if (name.includes('ou')) {
    min = 50;
    max = 120;
    dailyMax = 180;
  } else if (includesAny(name, ['sunca', 'prosciutto', 'jambon'])) {
    min = 50;
    max = 120;
    dailyMax = 180;
  } else if (includesAny(name, ['pui', 'curcan', 'vita', 'peste', 'somon', 'ton', 'cod'])) {
    min = 100;
    max = 220;
    dailyMax = 320;
  } else if (includesAny(name, ['orez', 'paste', 'ovaz', 'cartof', 'quinoa', 'couscous'])) {
    min = 40;
    max = 120;
    dailyMax = 180;
  } else if (role === 'low' || includesAny(category, ['vegetables', 'legume'])) {
    min = 30;
    max = 250;
    dailyMax = 500;
  }

  if (Number(food.min_amount_per_meal) > 0) min = Number(food.min_amount_per_meal);
  if (Number(food.daily_max_amount) > 0) dailyMax = Number(food.daily_max_amount);

  max = Math.max(5, Math.round(max));
  min = Math.min(Math.max(5, Math.round(min)), max);
  dailyMax = dailyMax ? Math.max(min, Math.round(dailyMax)) : null;
  return { min, max, dailyMax };
}

function getMaxAmount(food) {
  return getFoodLimitProfile(food).max;
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

function setFoodAmount(food, amount, options = {}) {
  const minAmount = options.enforceMin === false ? 5 : Number(food._minAmount) || 5;
  const maxAmount = Number(food._maxAmount) || 500;
  const nextAmount = Math.min(maxAmount, Math.max(minAmount, roundToNearest5(amount)));
  const scale = nextAmount / 100;
  food.amount = nextAmount;
  food.calories = Math.round(food._per100.calories * scale);
  food.protein = Math.round(food._per100.protein * scale);
  food.carbs = Math.round(food._per100.carbs * scale);
  food.fat = Math.round(food._per100.fat * scale);
}

function enforceDailyFoodLimits(day) {
  const groups = new Map();
  for (const meal of day.meals || []) {
    for (const food of meal.foods || []) {
      const dailyMax = Number(food._dailyMaxAmount) || 0;
      const key = food._foodKey || normalizeForMatch(food.name);
      if (!dailyMax || !key) continue;
      if (!groups.has(key)) groups.set(key, { dailyMax, foods: [] });
      groups.get(key).foods.push(food);
    }
  }

  for (const { dailyMax, foods } of groups.values()) {
    const total = foods.reduce((sum, food) => sum + (Number(food.amount) || 0), 0);
    if (total <= dailyMax) continue;

    const minSum = foods.reduce((sum, food) => sum + (Number(food._minAmount) || 5), 0);
    const keepMin = minSum <= dailyMax;
    const adjustable = foods.reduce((sum, food) =>
      sum + Math.max(0, (Number(food.amount) || 0) - (Number(food._minAmount) || 5)), 0);

    for (const food of foods) {
      const minAmount = Number(food._minAmount) || 5;
      const current = Number(food.amount) || minAmount;
      const nextAmount = keepMin && adjustable > 0
        ? minAmount + Math.max(0, current - minAmount) * ((dailyMax - minSum) / adjustable)
        : current * (dailyMax / total);
      setFoodAmount(food, nextAmount, { enforceMin: keepMin });
    }
  }
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
  enforceDailyFoodLimits(day);
  recalculateDay(day);
  const foods = day.meals.flatMap(meal => meal.foods || []);

  for (let i = 0; i < 500; i += 1) {
    const currentScore = scoreTotals(day.dailyTotals, targets);
    if (currentScore === 0 || isWithinTargets(day.dailyTotals, targets)) break;

    let best = null;
    for (const food of foods) {
      const originalAmount = food.amount;
      const minAmount = Math.max(Number(food._minAmount) || 5, 5);
      const maxAmount = Math.max(food._maxAmount || 250, 5);
      const sameFoodAmount = foods
        .filter(item => item !== food && item._foodKey && item._foodKey === food._foodKey)
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const dailyRoom = Number(food._dailyMaxAmount)
        ? Math.max(minAmount, Number(food._dailyMaxAmount) - sameFoodAmount)
        : maxAmount;
      const effectiveMaxAmount = Math.min(maxAmount, dailyRoom);
      for (const delta of [-5, 5]) {
        const nextAmount = originalAmount + delta;
        if (nextAmount < minAmount || nextAmount > effectiveMaxAmount) continue;
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
    enforceDailyFoodLimits(day);
    recalculateDay(day);
  }
}

function cleanForStorage(day) {
  for (const meal of day.meals || []) {
    for (const food of meal.foods || []) {
      food.displayAmount = `${food.amount}${food.unit || 'g'}`;
      delete food._per100;
      delete food._maxAmount;
      delete food._minAmount;
      delete food._dailyMaxAmount;
      delete food._foodKey;
    }
  }
  return day;
}

function makeDbFoodItem(food, amount) {
  const limits = getFoodLimitProfile(food);
  const safeAmount = Math.min(limits.max, Math.max(limits.min, roundToNearest5(amount)));
  const scale = safeAmount / 100;
  return {
    name: food.name,
    amount: safeAmount,
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
    _maxAmount: limits.max,
    _minAmount: limits.min,
    _dailyMaxAmount: limits.dailyMax,
    _foodKey: getFoodKey(food),
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
  const addKey = (key, food) => {
    const rawKey = String(key || '').trim();
    const normalizedKey = normalizeForMatch(rawKey);
    if (!rawKey || !normalizedKey) return;
    map.set(rawKey, food);
    map.set(normalizedKey, food);
  };

  for (const food of foods || []) {
    if (!food?.name) continue;
    if (food.id) addKey(food.id, food);
    addKey(food.name, food);
    parseList(food.aliases).forEach(alias => addKey(alias, food));
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
  const normalizeIngredient = (item, fallbackName = null) => {
    if (!item && !fallbackName) return null;
    if (typeof item === 'string') return { name: item };
    if (typeof item === 'number') return fallbackName ? { name: fallbackName, amount: item } : null;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

    const name = item.food_name ||
      item.foodName ||
      item.food_id ||
      item.foodId ||
      item.food_uuid ||
      item.foodUuid ||
      item.id ||
      item.food ||
      item.ingredient ||
      item.name ||
      item.label ||
      item.title ||
      fallbackName;

    if (!name) return null;

    return {
      ...item,
      name,
      amount: item.amount ??
        item.amount_g ??
        item.base_amount_g ??
        item.quantity ??
        item.quantity_g ??
        item.grams ??
        item.gramaj ??
        item.g,
    };
  };

  if (Array.isArray(value)) {
    return value.map(item => normalizeIngredient(item)).filter(Boolean);
  }
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return parseRecipeIngredients(JSON.parse(trimmed));
    } catch {
      return trimmed
        .split(',')
        .map(item => normalizeIngredient(item.trim()))
        .filter(Boolean);
    }
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.ingredients)) return parseRecipeIngredients(value.ingredients);
    if (Array.isArray(value.foods)) return parseRecipeIngredients(value.foods);
    return Object.entries(value)
      .map(([name, item]) => normalizeIngredient(item, name))
      .filter(Boolean);
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
    ...parseRecipeIngredients(recipe.ingredients).map(ingredient => getIngredientName(ingredient)),
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

function isFreeRecipe(recipe) {
  return recipe?.is_free === true || Number(recipe?.coin_price) <= 0;
}

function isRecipeAvailableForUser(recipe, unlockedRecipeIds, { freeOnly = false } = {}) {
  if (freeOnly) return isFreeRecipe(recipe);
  if (recipe?.is_free === true) return true;
  if (!Object.prototype.hasOwnProperty.call(recipe || {}, 'is_free')) return true;
  return unlockedRecipeIds.has(String(recipe.id));
}

function normalizeFoodId(value) {
  const candidate = String(value || '').trim();
  return UUID_RE.test(candidate) ? candidate : '';
}

function getIngredientFoodId(ingredient) {
  if (typeof ingredient === 'string') return normalizeFoodId(ingredient);
  if (!ingredient || typeof ingredient !== 'object') return '';

  const directId = normalizeFoodId(
    ingredient.food_id ||
    ingredient.foodId ||
    ingredient.food_uuid ||
    ingredient.foodUuid ||
    ingredient.food?.id ||
    ingredient.id ||
    ingredient.name
  );

  return directId;
}

function getIngredientName(ingredient) {
  if (typeof ingredient === 'string') return ingredient;
  return ingredient?.food_name ||
    ingredient?.foodName ||
    ingredient?.food?.name ||
    (typeof ingredient?.food === 'string' ? ingredient.food : '') ||
    ingredient?.ingredient ||
    (!normalizeFoodId(ingredient?.name) ? ingredient?.name : '') ||
    ingredient?.label ||
    ingredient?.title ||
    getIngredientFoodId(ingredient) ||
    '';
}

function resolveIngredientFood(ingredient, foodsMap) {
  const foodId = getIngredientFoodId(ingredient);
  if (!foodId) return null;
  return foodsMap.get(foodId) || null;
}

function getRecipeMappingStatus(recipe, foodsMap) {
  const ingredients = parseRecipeIngredients(recipe.ingredients);
  if (!ingredients.length) {
    return { isComplete: false, missing: ['ingrediente lipsă'] };
  }

  const missing = [];
  for (const ingredient of ingredients) {
    const ingredientName = getIngredientName(ingredient);
    const food = resolveIngredientFood(ingredient, foodsMap);
    if (!food || !Number(food.calories_per_100g)) {
      missing.push(ingredientName || 'ingredient fără nume');
    }
  }

  return {
    isComplete: missing.length === 0,
    missing,
  };
}

function getIngredientBaseAmount(ingredient, food) {
  let amount = Number(
    ingredient.base_amount_g ??
    ingredient.amount_g ??
    ingredient.quantity_g ??
    ingredient.amount ??
    ingredient.quantity ??
    ingredient.grams ??
    ingredient.gramaj ??
    ingredient.g
  );
  if (!amount && ingredient.ratio_pct) {
    const cal100 = Math.max(Number(food?.calories_per_100g) || 100, 1);
    amount = Math.round((Number(ingredient.ratio_pct) * 500) / (cal100 / 100));
  }
  return Math.max(5, Number.isFinite(amount) ? amount : 100);
}

function makeRecipeFoodItem(food, amount) {
  return makeDbFoodItem(food, amount);
}

function getRecipeImageMeta(recipe = {}) {
  const imageUrl = recipe.image_url || recipe.imageUrl || null;
  const imageStoragePath = recipe.image_storage_path || recipe.imageStoragePath || null;
  const imageStorageBucket = recipe.image_storage_bucket || recipe.imageStorageBucket || (imageStoragePath ? DEFAULT_RECIPE_IMAGE_BUCKET : null);

  return {
    imageUrl,
    imageStoragePath,
    imageStorageBucket,
  };
}

function scaleRecipeToMealTarget(recipe, mealTargetCalories, foodsMap) {
  const ingredients = parseRecipeIngredients(recipe.ingredients);
  const items = [];

  for (const ingredient of ingredients) {
    const food = resolveIngredientFood(ingredient, foodsMap);
    if (!food || !Number(food.calories_per_100g)) return [];
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
    ...getRecipeImageMeta(recipe),
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
    const variantIndex = patternIndex;
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

export async function createAutomaticMealPlanForUser({ supabase, userId, profile, freeOnly = false }) {
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

  const [
    { data: foods, error: foodsError },
    { data: recipes, error: recipesError },
    { data: unlockedRecipes, error: unlockedRecipesError },
  ] = await Promise.all([
    supabase
      .from('foods')
      .select(FOOD_SELECT)
      .eq('is_active', true),
    supabase
      .from('recipes')
      .select(RECIPE_SELECT)
      .in('meal_type', ['breakfast', 'lunch', 'dinner', 'snack'])
      .order('meal_type', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('user_recipe_unlocks')
      .select('recipe_id')
      .eq('user_id', userId),
  ]);

  if (foodsError) throw new Error(`Nu am putut încărca alimentele: ${foodsError.message}`);
  if (recipesError) throw new Error(`Nu am putut încărca rețetele: ${recipesError.message}`);
  if (unlockedRecipesError) throw new Error(`Nu am putut încărca rețetele deblocate: ${unlockedRecipesError.message}`);

  const foodPools = buildFoodPools(foods || []);
  if (!foodPools.all.length) throw new Error('Nu există alimente disponibile pentru planul automat.');

  const foodsMap = buildFoodsMap(foods || []);
  const unlockedRecipeIds = new Set((unlockedRecipes || []).map(row => String(row.recipe_id)));
  const availableRecipes = (recipes || []).filter(recipe =>
    isRecipeAvailableForUser(recipe, unlockedRecipeIds, { freeOnly })
  );
  const eligibleByType = getEligibleRecipesByType(availableRecipes, profile);
  const recipeVariants = {};

  for (const mealType of ['breakfast', 'lunch', 'snack', 'dinner']) {
    const mappingStatuses = (eligibleByType[mealType] || []).map(recipe => ({
      recipe,
      ...getRecipeMappingStatus(recipe, foodsMap),
    }));
    const pool = mappingStatuses
      .filter(status => status.isComplete)
      .map(status => status.recipe);
    if (!pool.length) {
      const sampleIngredients = mappingStatuses
        .flatMap(status => status.missing)
        .filter(Boolean)
        .slice(0, 8);
      const hint = sampleIngredients.length
        ? ` Ingrediente nemapate: ${sampleIngredients.join(', ')}.`
        : '';
      throw new Error(`Nu există rețete disponibile/deblocate pentru ${mealType} cu toate ingredientele mapate în foods.${hint}`);
    }
    recipeVariants[mealType] = pickRecipeVariants(pool, 3);
  }

  const days = buildRecipeWeekDays(targets, recipeVariants, foodsMap);

  const plan = {
    clientName: profile.name || 'Utilizator',
    dailyTargets: targets,
    recipeRotation: {
      pattern: [1, 1, 2, 2, 3, 3, 1],
      accessMode: freeOnly ? 'free_only' : 'free_and_unlocked',
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
