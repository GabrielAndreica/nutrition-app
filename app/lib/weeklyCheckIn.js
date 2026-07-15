import { getCurrentPlanDateKey, getCurrentPlanDayIndex, getNextPlanMidnightIso } from '@/app/lib/weeklyPlanRegeneration';

const KG_TOLERANCE = 0.2;
const DEFAULT_ADJUSTMENT_KCAL = 150;
const MAX_ADJUSTMENT_KCAL = 250;

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function isWeeklyCheckInDay(now = new Date()) {
  return getCurrentPlanDayIndex(now) === 6;
}

export function getWeekKey(now = new Date()) {
  return getCurrentPlanDateKey(now);
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

export function evaluateGoalProgress({ goal, previousWeight, currentWeight, targetWeight }) {
  const previous = Number(previousWeight);
  const current = Number(currentWeight);
  const target = Number(targetWeight);
  const deltaKg = Number.isFinite(previous) ? Math.round((current - previous) * 10) / 10 : 0;
  const remainingKg = Number.isFinite(target) ? Math.round((target - current) * 10) / 10 : null;
  const normalizedGoal = goal || 'maintenance';

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

function getCarbCandidateFoods(plan) {
  const foods = [];
  for (const day of plan?.days || []) {
    for (const meal of day?.meals || []) {
      for (const food of meal?.foods || []) {
        const calories = Number(food.calories) || 0;
        const carbs = Number(food.carbs) || 0;
        const protein = Number(food.protein) || 0;
        const fat = Number(food.fat) || 0;
        const carbCalories = carbs * 4;
        if (calories <= 0 || carbs <= 0) continue;
        if (carbs >= protein && carbCalories >= calories * 0.28 && carbCalories >= fat * 9) {
          foods.push(food);
        }
      }
    }
  }
  return foods;
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

function scaleFood(food, factor) {
  const amount = Number(food.amount) || Number(String(food.displayAmount || '').match(/\d+/)?.[0]) || 100;
  const minAmount = Math.max(20, amount * 0.65);
  const maxAmount = amount * 1.35;
  const nextAmount = Math.round(clamp(amount * factor, minAmount, maxAmount) / 5) * 5;
  const actualFactor = amount > 0 ? nextAmount / amount : factor;

  food.amount = nextAmount;
  food.displayAmount = `${nextAmount}${food.unit || 'g'}`;
  food.calories = round((Number(food.calories) || 0) * actualFactor);
  food.protein = round((Number(food.protein) || 0) * actualFactor);
  food.carbs = round((Number(food.carbs) || 0) * actualFactor);
  food.fat = round((Number(food.fat) || 0) * actualFactor);
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
  const caloriesDelta = clamp(adjustmentCalories, -MAX_ADJUSTMENT_KCAL, MAX_ADJUSTMENT_KCAL);
  if (!plan?.days?.length || !caloriesDelta) {
    return { planData: plan, targetsBefore, targetsAfter: targetsBefore, achievedCaloriesDelta: 0 };
  }

  const candidates = getCarbCandidateFoods(plan);
  const candidateCalories = candidates.reduce((sum, food) => sum + (Number(food.calories) || 0), 0);
  if (!candidates.length || candidateCalories <= 0) {
    return { planData: plan, targetsBefore, targetsAfter: targetsBefore, achievedCaloriesDelta: 0 };
  }

  const desiredTotalDelta = caloriesDelta * (plan.days.length || 7);
  const factor = clamp(1 + desiredTotalDelta / candidateCalories, 0.75, 1.25);
  candidates.forEach(food => scaleFood(food, factor));
  recalculatePlan(plan);

  const beforeAverage = targetsBefore;
  const afterAverage = averageDailyTotals(plan);
  const achievedCaloriesDelta = afterAverage.calories - beforeAverage.calories;
  const achievedCarbsDelta = afterAverage.carbs - beforeAverage.carbs;
  const targetsAfter = {
    ...beforeAverage,
    calories: Math.max(1200, round(beforeAverage.calories + achievedCaloriesDelta)),
    protein: round(beforeAverage.protein),
    carbs: Math.max(30, round(beforeAverage.carbs + achievedCarbsDelta)),
    fat: round(beforeAverage.fat),
  };

  plan.dailyTargets = targetsAfter;
  plan.adjustmentMeta = {
    adjustedAt: new Date().toISOString(),
    method: 'weekly_checkin_carb_scaling',
    requestedCaloriesDelta: caloriesDelta,
    achievedCaloriesDelta,
    achievedCarbsDelta,
  };

  return { planData: plan, targetsBefore, targetsAfter, achievedCaloriesDelta };
}

export function getAdjustmentCalories({ evaluation, mealAdherencePct, hungerLevel }) {
  if (!evaluation?.needsAdjustment) return 0;
  let amount = DEFAULT_ADJUSTMENT_KCAL;
  if (evaluation.outcome === 'off_track') amount = MAX_ADJUSTMENT_KCAL;
  if (Number(mealAdherencePct) < 60) amount = DEFAULT_ADJUSTMENT_KCAL;
  if (evaluation.adjustmentDirection === 'deficit' && Number(hungerLevel) >= 5) amount = 100;
  return evaluation.adjustmentDirection === 'deficit' ? -amount : amount;
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
