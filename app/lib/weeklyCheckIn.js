import { getCurrentPlanDateKey, getCurrentPlanDayIndex, getNextPlanMidnightIso } from '@/app/lib/weeklyPlanRegeneration';

const KG_TOLERANCE = 0.2;
const PAID_NUTRITION_ADJUSTMENT_KCAL = 100;
const FIRST_WEEKLY_CHECKIN_MIN_AGE_MS = 6 * 24 * 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function getMealList(day) {
  return Array.isArray(day?.meals) ? day.meals : [];
}

function getFoodList(meal) {
  return Array.isArray(meal?.foods) ? meal.foods : [];
}

function getFoodAmount(food) {
  return Math.max(Number(food?.amount) || Number(String(food?.displayAmount || '').match(/\d+(?:\.\d+)?/)?.[0]) || 100, 1);
}

function roundToNearest5(value) {
  return Math.round((Number(value) || 0) / 5) * 5;
}

function getCarbsPerGram(food) {
  const amount = getFoodAmount(food);
  return amount > 0 ? (Number(food?.carbs) || 0) / amount : 0;
}

function getFatPerGram(food) {
  const amount = getFoodAmount(food);
  return amount > 0 ? (Number(food?.fat) || 0) / amount : 0;
}

function parseMaxReps(value) {
  const numbers = String(value || '').match(/\d+/g);
  if (!numbers?.length) return 0;
  return Math.max(...numbers.map(Number).filter(Number.isFinite));
}

function formatRepRange(minReps, maxReps) {
  const min = Math.max(1, Math.round(Number(minReps) || 1));
  const max = Math.max(min, Math.round(Number(maxReps) || min));
  return min === max ? String(min) : `${min}-${max}`;
}

function bumpRepRange(value, increment = 2, cap = 20) {
  const numbers = String(value || '').match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  if (!numbers.length) return value || '10-12';
  const min = Math.min(cap, numbers[0] + increment);
  const max = Math.min(cap, (numbers[1] || numbers[0]) + increment);
  return formatRepRange(min, Math.max(min, max));
}

export function isWeeklyCheckInDay(now = new Date()) {
  return getCurrentPlanDayIndex(now) === 6;
}

export function getWeekKey(now = new Date()) {
  return getCurrentPlanDateKey(now);
}

export function getWeeklyCheckInWarmupStatus({
  userCreatedAt,
  latestCheckIn,
  now = new Date(),
  forceDue = false,
} = {}) {
  if (forceDue || latestCheckIn) {
    return { eligible: true, nextEligibleAt: null };
  }

  if (!userCreatedAt) {
    return { eligible: true, nextEligibleAt: null };
  }

  const createdAt = new Date(userCreatedAt);
  const currentDate = new Date(now);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(currentDate.getTime())) {
    return { eligible: true, nextEligibleAt: null };
  }

  const nextEligibleAt = new Date(createdAt.getTime() + FIRST_WEEKLY_CHECKIN_MIN_AGE_MS);
  return {
    eligible: currentDate >= nextEligibleAt,
    nextEligibleAt: nextEligibleAt.toISOString(),
  };
}

export function normalizeWeeklyCheckInInput(body = {}) {
  const weightKg = Number(body.weightKg ?? body.weight ?? body.currentWeight);
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 300) {
    throw new Error('Greutatea trebuie să fie între 30 și 300 kg.');
  }

  const mealAdherencePct = clamp(body.mealAdherencePct ?? body.mealAdherence, 0, 100);
  const workoutAdherencePct = clamp(body.workoutAdherencePct ?? body.workoutAdherence, 0, 100);
  const workoutDifficulty = clamp(body.workoutDifficulty, 1, 5);
  const hungerLevel = clamp(body.hungerLevel, 1, 5);

  return {
    weightKg: Math.round(weightKg * 10) / 10,
    mealAdherencePct: round(mealAdherencePct),
    workoutAdherencePct: round(workoutAdherencePct),
    workoutDifficulty: round(workoutDifficulty),
    hungerLevel: round(hungerLevel),
    notes: String(body.notes || '').trim().slice(0, 1000),
  };
}

function normalizeGoalValue(goal, currentWeight, targetWeight) {
  const normalized = String(goal || '').toLowerCase().trim();
  if (['weight_loss', 'slabire', 'slăbire', 'lose_weight', 'fat_loss', 'deficit'].includes(normalized)) {
    return 'weight_loss';
  }
  if (['muscle_gain', 'masa_musculara', 'masă_musculară', 'crestere', 'creștere', 'bulk', 'surplus'].includes(normalized)) {
    return 'muscle_gain';
  }
  if (['maintenance', 'mentinere', 'menținere'].includes(normalized)) {
    return 'maintenance';
  }

  const current = Number(currentWeight);
  const target = Number(targetWeight);
  if (Number.isFinite(current) && Number.isFinite(target)) {
    if (target < current - KG_TOLERANCE) return 'weight_loss';
    if (target > current + KG_TOLERANCE) return 'muscle_gain';
  }

  return 'maintenance';
}

export function evaluateGoalProgress({ goal, previousWeight, currentWeight, targetWeight }) {
  const previous = Number(previousWeight);
  const current = Number(currentWeight);
  const target = Number(targetWeight);
  const deltaKg = Number.isFinite(previous) ? Math.round((current - previous) * 10) / 10 : 0;
  const remainingKg = Number.isFinite(target) ? Math.round((target - current) * 10) / 10 : null;
  const normalizedGoal = normalizeGoalValue(goal, current, target);

  let outcome = 'stable';
  let needsAdjustment = false;
  let adjustmentDirection = 'none';
  let recommendation = 'Ai făcut check-in-ul. Continuăm să urmărim trendul și păstrăm direcția.';

  if (normalizedGoal === 'weight_loss') {
    if (deltaKg <= -KG_TOLERANCE) {
      outcome = 'on_track';
      recommendation = 'Foarte bine. Greutatea merge în direcția potrivită pentru slăbit.';
    } else if (deltaKg >= KG_TOLERANCE) {
      outcome = 'off_track';
      needsAdjustment = true;
      adjustmentDirection = 'deficit';
      recommendation = 'Greutatea a crescut deși obiectivul este slăbit. Ar ajuta un deficit mai clar sau mai multă mișcare.';
    } else {
      outcome = 'stalled';
      needsAdjustment = true;
      adjustmentDirection = 'deficit';
      recommendation = 'Greutatea a rămas aproape la fel. O mică scădere de carbohidrați poate reporni progresul.';
    }
  } else if (normalizedGoal === 'muscle_gain') {
    if (deltaKg >= KG_TOLERANCE) {
      outcome = 'on_track';
      recommendation = 'Perfect. Greutatea crește în direcția obiectivului de masă musculară.';
    } else if (deltaKg <= -KG_TOLERANCE) {
      outcome = 'off_track';
      needsAdjustment = true;
      adjustmentDirection = 'surplus';
      recommendation = 'Greutatea a scăzut deși obiectivul este creștere. Ai nevoie de un surplus mai clar.';
    } else {
      outcome = 'stalled';
      needsAdjustment = true;
      adjustmentDirection = 'surplus';
      recommendation = 'Greutatea a stat pe loc. Creștem ușor carbohidrații pentru mai mult combustibil.';
    }
  } else if (Number.isFinite(target)) {
    const distance = target - current;
    if (Math.abs(distance) <= KG_TOLERANCE) {
      outcome = 'on_track';
      recommendation = 'Ești foarte aproape de greutatea dorită. Păstrăm direcția.';
    } else if (distance < 0) {
      needsAdjustment = true;
      adjustmentDirection = 'deficit';
      recommendation = 'Ești peste greutatea dorită. Un deficit mic ar ajuta să revii spre țintă.';
    } else {
      needsAdjustment = true;
      adjustmentDirection = 'surplus';
      recommendation = 'Ești sub greutatea dorită. Un surplus mic ar ajuta să urci spre țintă.';
    }
  }

  return {
    goal: normalizedGoal,
    deltaKg,
    remainingKg,
    outcome,
    needsAdjustment,
    adjustmentDirection,
    recommendation,
  };
}

function getBestCarbFood(meal) {
  return getFoodList(meal)
    .filter(food => {
      const calories = Number(food.calories) || 0;
      const carbs = Number(food.carbs) || 0;
      const protein = Number(food.protein) || 0;
      const fat = Number(food.fat) || 0;
      return calories > 0 && carbs > 0 && carbs >= protein && carbs * 4 >= fat * 9;
    })
    .sort((a, b) => getCarbsPerGram(b) - getCarbsPerGram(a))[0] || null;
}

function getBestFatFood(meal) {
  return getFoodList(meal)
    .filter(food => {
      const calories = Number(food.calories) || 0;
      const carbs = Number(food.carbs) || 0;
      const protein = Number(food.protein) || 0;
      const fat = Number(food.fat) || 0;
      return calories > 0 && fat > 0 && fat * 9 >= carbs * 4 && fat * 9 >= protein * 4;
    })
    .sort((a, b) => getFatPerGram(b) - getFatPerGram(a))[0] || null;
}

function recalculatePlan(plan) {
  for (const day of plan.days || []) {
    for (const meal of day.meals || []) {
      const mealTotals = (meal.foods || []).reduce((acc, food) => ({
        calories: acc.calories + (Number(food.calories) || 0),
        protein: acc.protein + (Number(food.protein) || 0),
        carbs: acc.carbs + (Number(food.carbs) || 0),
        fat: acc.fat + (Number(food.fat) || 0),
      }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
      meal.mealTotals = {
        calories: round(mealTotals.calories),
        protein: round(mealTotals.protein),
        carbs: round(mealTotals.carbs),
        fat: round(mealTotals.fat),
      };
    }

    const dailyTotals = (day.meals || []).reduce((acc, meal) => ({
      calories: acc.calories + (Number(meal.mealTotals?.calories) || 0),
      protein: acc.protein + (Number(meal.mealTotals?.protein) || 0),
      carbs: acc.carbs + (Number(meal.mealTotals?.carbs) || 0),
      fat: acc.fat + (Number(meal.mealTotals?.fat) || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    day.dailyTotals = {
      calories: round(dailyTotals.calories),
      protein: round(dailyTotals.protein),
      carbs: round(dailyTotals.carbs),
      fat: round(dailyTotals.fat),
    };
  }
}

function setFoodAmountByDeltaMacro(food, macroKey, desiredMacroDelta) {
  const currentAmount = getFoodAmount(food);
  const macroPerGram = macroKey === 'fat' ? getFatPerGram(food) : getCarbsPerGram(food);
  if (macroPerGram <= 0) return 0;

  const desiredAmountDelta = desiredMacroDelta / macroPerGram;
  const minAmount = desiredMacroDelta < 0 ? Math.max(5, currentAmount * 0.65) : Math.max(5, currentAmount * 0.75);
  const maxAmount = desiredMacroDelta > 0 ? currentAmount * 1.35 : Math.max(currentAmount, 5);
  const nextAmount = roundToNearest5(clamp(currentAmount + desiredAmountDelta, minAmount, maxAmount));
  const actualFactor = nextAmount / currentAmount;
  const previousMacro = Number(food[macroKey]) || 0;

  food.amount = nextAmount;
  food.displayAmount = `${nextAmount}${food.unit || 'g'}`;
  food.calories = round((Number(food.calories) || 0) * actualFactor);
  food.protein = round((Number(food.protein) || 0) * actualFactor);
  food.carbs = round((Number(food.carbs) || 0) * actualFactor);
  food.fat = round((Number(food.fat) || 0) * actualFactor);

  return (Number(food[macroKey]) || 0) - previousMacro;
}

function setFoodAmountByDeltaCarbs(food, desiredCarbsDelta) {
  return setFoodAmountByDeltaMacro(food, 'carbs', desiredCarbsDelta);
}

function setFoodAmountByDeltaFat(food, desiredFatDelta) {
  return setFoodAmountByDeltaMacro(food, 'fat', desiredFatDelta);
}

function averageDailyTotals(plan) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  if (!days.length) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const sum = days.reduce((acc, day) => ({
    calories: acc.calories + (Number(day.dailyTotals?.calories) || 0),
    protein: acc.protein + (Number(day.dailyTotals?.protein) || 0),
    carbs: acc.carbs + (Number(day.dailyTotals?.carbs) || 0),
    fat: acc.fat + (Number(day.dailyTotals?.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return {
    calories: round(sum.calories / days.length),
    protein: round(sum.protein / days.length),
    carbs: round(sum.carbs / days.length),
    fat: round(sum.fat / days.length),
  };
}

export function adjustMealPlanCarbs(planData, dailyTargets, adjustmentCalories) {
  const plan = clone(planData);
  const targetsBefore = clone(dailyTargets || plan?.dailyTargets || averageDailyTotals(plan));
  const planAverageBefore = averageDailyTotals(plan);
  const caloriesDelta = clamp(adjustmentCalories, -PAID_NUTRITION_ADJUSTMENT_KCAL, PAID_NUTRITION_ADJUSTMENT_KCAL);
  if (!plan?.days?.length || !caloriesDelta) {
    return { planData: plan, targetsBefore, targetsAfter: targetsBefore, achievedCaloriesDelta: 0 };
  }

  const desiredCarbsDeltaPerDay = caloriesDelta / 4;
  const dayAdjustments = [];

  for (const day of plan.days || []) {
    const adjustableMeals = getMealList(day)
      .map(meal => ({ meal, food: getBestCarbFood(meal) }))
      .filter(item => item.food);

    if (!adjustableMeals.length) continue;

    const desiredCarbsDeltaPerMeal = desiredCarbsDeltaPerDay / adjustableMeals.length;
    let achievedCarbsDelta = 0;
    let achievedFatDelta = 0;

    for (const item of adjustableMeals) {
      achievedCarbsDelta += setFoodAmountByDeltaCarbs(item.food, desiredCarbsDeltaPerMeal);
    }

    const remainingCaloriesDelta = caloriesDelta - achievedCarbsDelta * 4;
    const fatAdjustableMeals = Math.abs(remainingCaloriesDelta) >= 10
      ? getMealList(day)
        .map(meal => ({ meal, food: getBestFatFood(meal) }))
        .filter(item => item.food)
      : [];

    if (fatAdjustableMeals.length) {
      const desiredFatDeltaPerMeal = (remainingCaloriesDelta / 9) / fatAdjustableMeals.length;
      for (const item of fatAdjustableMeals) {
        achievedFatDelta += setFoodAmountByDeltaFat(item.food, desiredFatDeltaPerMeal);
      }
    }

    dayAdjustments.push({
      day: day.day || day.name || null,
      mealsAdjusted: adjustableMeals.length,
      fatMealsAdjusted: fatAdjustableMeals.length,
      desiredCarbsDelta: Math.round(desiredCarbsDeltaPerDay * 10) / 10,
      achievedCarbsDelta: Math.round(achievedCarbsDelta * 10) / 10,
      achievedFatDelta: Math.round(achievedFatDelta * 10) / 10,
    });
  }

  recalculatePlan(plan);

  const beforeAverage = targetsBefore;
  const afterAverage = averageDailyTotals(plan);
  const achievedCaloriesDelta = afterAverage.calories - planAverageBefore.calories;
  const achievedCarbsDelta = afterAverage.carbs - planAverageBefore.carbs;
  const achievedFatDelta = afterAverage.fat - planAverageBefore.fat;
  const targetsAfter = {
    ...beforeAverage,
    calories: Math.max(1200, round(beforeAverage.calories + achievedCaloriesDelta)),
    protein: round(beforeAverage.protein),
    carbs: Math.max(30, round(beforeAverage.carbs + achievedCarbsDelta)),
    fat: Math.max(15, round(beforeAverage.fat + achievedFatDelta)),
  };

  plan.dailyTargets = targetsAfter;
  plan.adjustmentMeta = {
    adjustedAt: new Date().toISOString(),
    method: 'weekly_checkin_uniform_carb_adjustment',
    requestedCaloriesDelta: caloriesDelta,
    achievedCaloriesDelta,
    achievedCarbsDelta,
    achievedFatDelta,
    dayAdjustments,
  };

  return { planData: plan, targetsBefore, targetsAfter, achievedCaloriesDelta };
}

export function getAdjustmentCalories({ evaluation, mealAdherencePct, hungerLevel }) {
  if (!evaluation?.needsAdjustment || !['off_track', 'stalled'].includes(evaluation.outcome)) return 0;
  if (evaluation.adjustmentDirection === 'deficit') return -PAID_NUTRITION_ADJUSTMENT_KCAL;
  if (evaluation.adjustmentDirection === 'surplus') return PAID_NUTRITION_ADJUSTMENT_KCAL;
  return 0;
}

export function getWorkoutProgressionSummary({ workoutDifficulty, availableEquipment, latestWorkoutPlan }) {
  const difficulty = Number(workoutDifficulty);
  const equipment = String(availableEquipment || '').toLowerCase();
  const isHome = equipment.includes('home') || equipment.includes('acas') || equipment.includes('bodyweight');
  const exercises = (latestWorkoutPlan?.days || [])
    .flatMap(day => Array.isArray(day?.exercises) ? day.exercises : []);
  const maxPlannedReps = exercises.reduce((max, exercise) => Math.max(max, parseMaxReps(exercise?.reps)), 0);

  if (difficulty <= 1) {
    if (isHome) {
      return {
        status: 'too_easy_home',
        title: 'Antrenamentele au fost ușoare',
        message: 'Pentru antrenamente acasă, creștem progresiv repetările și controlul execuției. Dacă ajungi ușor la 20 repetări, trecem la variante mai grele.',
      };
    }

    if (maxPlannedReps >= 20) {
      return {
        status: 'too_easy_load',
        title: 'E timpul să crești încărcarea',
        message: 'Ai ajuns în zona de 20 repetări și încă pare ușor. Crește greutatea la exercițiile principale și revino spre 8-10 repetări curate pe serie.',
      };
    }

    return {
      status: 'too_easy_reps',
      title: 'Creștem repetările',
      message: 'Antrenamentele au fost prea ușoare. Păstrează greutatea și urcă treptat repetările până spre 18-20 pe serie înainte să crești încărcarea.',
    };
  }

  if (difficulty >= 5) {
    return {
      status: 'too_hard',
      title: 'Ajustăm intensitatea',
      message: 'Antrenamentele au fost grele. Prioritatea rămâne execuția bună: păstrează greutățile, nu forța progresia și urmărește recuperarea.',
    };
  }

  return {
    status: 'balanced',
    title: 'Intensitatea este potrivită',
    message: 'Antrenamentele au fost în zona potrivită. Continuă cu progresie mică și constantă, fără să sacrifici forma.',
  };
}

export function adjustWorkoutPlanProgression(planData, { workoutDifficulty, availableEquipment } = {}) {
  const plan = clone(planData);
  const progression = getWorkoutProgressionSummary({
    workoutDifficulty,
    availableEquipment,
    latestWorkoutPlan: plan,
  });

  if (!plan?.days?.length || !['too_easy_home', 'too_easy_reps', 'too_easy_load'].includes(progression.status)) {
    return { planData: plan, adjusted: false, progression };
  }

  let exercisesAdjusted = 0;
  for (const day of plan.days || []) {
    for (const exercise of day?.exercises || []) {
      if (!exercise || !exercise.reps) continue;
      exercise.reps = progression.status === 'too_easy_load'
        ? '8-10'
        : bumpRepRange(exercise.reps, 2, 20);
      exercisesAdjusted += 1;
    }
  }

  plan.weeklyCheckInWorkoutAdjustment = {
    adjustedAt: new Date().toISOString(),
    status: progression.status,
    exercisesAdjusted,
    note: progression.status === 'too_easy_load'
      ? 'Crește greutatea la exercițiile principale și revino la 8-10 repetări curate.'
      : 'Repetările au fost crescute progresiv pentru următoarea săptămână.',
  };

  return {
    planData: plan,
    adjusted: exercisesAdjusted > 0,
    progression,
    exercisesAdjusted,
  };
}

export function buildCoachInsights({
  input,
  evaluation,
  availableEquipment,
  latestWorkoutPlan,
  waterStats,
  planAdjusted,
  achievedCaloriesDelta,
}) {
  const insights = [];
  const workoutProgression = getWorkoutProgressionSummary({
    workoutDifficulty: input?.workoutDifficulty,
    availableEquipment,
    latestWorkoutPlan,
  });

  insights.push(workoutProgression);

  if (Number(input?.workoutAdherencePct) < 60) {
    insights.push({
      status: 'workout_adherence_low',
      title: 'Antrenamente ratate',
      message: 'Săptămâna viitoare contează mai mult să bifezi sesiunile decât să le faci perfect. Păstrează programul simplu și nu recupera tot într-o singură zi.',
    });
  } else if (Number(input?.workoutAdherencePct) < 100) {
    insights.push({
      status: 'workout_adherence_partial',
      title: 'Ritm aproape bun',
      message: 'Ai făcut o parte din antrenamente. Următorul pas este să păstrezi zilele fixe și să reduci improvizațiile.',
    });
  }

  if (Number(input?.mealAdherencePct) < 60) {
    insights.push({
      status: 'meal_adherence_low',
      title: 'Mesele au fost veriga slabă',
      message: 'Până să schimbăm agresiv caloriile, prioritatea este să respecți mesele existente. Fără consistență, ajustările devin greu de interpretat.',
    });
  } else if (Number(input?.mealAdherencePct) < 100) {
    insights.push({
      status: 'meal_adherence_partial',
      title: 'Mesele sunt aproape sub control',
      message: 'Ai respectat mare parte din plan. Micile abateri contează: încearcă să păstrezi gustările și porțiile cât mai aproape de plan.',
    });
  }

  if (Number(input?.hungerLevel) >= 5) {
    insights.push({
      status: 'high_hunger',
      title: 'Foamea a fost ridicată',
      message: 'Foamea mare poate reduce aderența. Urmărește să ai proteine și legume la mesele principale și să nu sari peste gustări.',
    });
  } else if (Number(input?.hungerLevel) <= 1) {
    insights.push({
      status: 'low_hunger',
      title: 'Foamea a fost foarte mică',
      message: 'Dacă obiectivul este masă musculară, lipsa foamei poate face surplusul mai greu. Ține mesele constante, chiar dacă apetitul e redus.',
    });
  }

  if (waterStats?.targetMl > 0 && waterStats?.completionPct < 100) {
    insights.push({
      status: 'water_low',
      title: 'Hidratarea nu a fost completă',
      message: `Ai băut aproximativ ${waterStats.completionPct}% din necesarul săptămânal de apă. Țintește încă 1-2 pahare în prima parte a zilei.`,
    });
  }

  if (planAdjusted) {
    insights.push({
      status: 'nutrition_adjusted',
      title: 'Plan alimentar ajustat',
      message: achievedCaloriesDelta < 0
        ? 'Am redus uniform carbohidrații din zilele planului cu aproximativ 100 kcal/zi pentru un deficit mai clar.'
        : 'Am crescut uniform carbohidrații din zilele planului cu aproximativ 100 kcal/zi pentru un surplus mai bun.',
    });
  } else if (evaluation?.outcome === 'on_track') {
    insights.push({
      status: 'nutrition_on_track',
      title: 'Nutriția merge în direcția bună',
      message: 'Nu schimbăm caloriile săptămâna aceasta. Când trendul merge bine, păstrăm planul stabil.',
    });
  }

  return insights;
}

export function buildPostCheckInUserReset(now = new Date()) {
  const nextPlanDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    meals_completed_days: 0,
    workout_completed_days: 0,
    current_plan_day: getCurrentPlanDayIndex(nextPlanDay),
    current_plan_day_due_at: getNextPlanMidnightIso(nextPlanDay),
    meal_day_status: {},
    workout_day_status: {},
    streak_awarded_day: -1,
    meals_cooldown_until: null,
    workout_cooldown_until: null,
    weekly_plan_due_at: null,
    weekly_plan_generation_started_at: null,
    weekly_plan_generation_error: null,
  };
}
