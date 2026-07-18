import { supabaseQuery } from '@/app/lib/supabase';
import {
  adjustMealPlanCarbs,
  adjustWorkoutPlanProgression,
  buildFoodPortionLimitMap,
  buildCoachInsights,
  evaluateGoalProgress,
  getAdjustmentCalories,
} from '@/app/lib/weeklyCheckIn';

function getTargetsFromUser(user = {}) {
  const targets = {
    calories: Number(user.nutrition_target_calories) || 0,
    protein: Number(user.nutrition_target_protein_g) || 0,
    carbs: Number(user.nutrition_target_carbs_g) || 0,
    fat: Number(user.nutrition_target_fat_g) || 0,
  };
  return targets.calories > 0 ? targets : null;
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getWeeklyWaterStats(supabase, userId, weekKey, hydrationTargetMl) {
  const targetPerDayMl = Math.max(0, Number(hydrationTargetMl) || 0);
  if (!targetPerDayMl || !weekKey) return null;

  const startDate = addDaysToDateKey(weekKey, -6);
  const { data, error } = await supabaseQuery(() => supabase
    .from('daily_user_progress')
    .select('progress_date, water_ml')
    .eq('user_id', userId)
    .gte('progress_date', startDate)
    .lte('progress_date', weekKey));

  if (error) {
    console.error('[premium-checkin-upgrade] water stats error:', error);
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  const totalMl = rows.reduce((sum, row) => sum + Math.max(0, Number(row.water_ml) || 0), 0);
  const targetMl = targetPerDayMl * 7;

  return {
    startDate,
    endDate: weekKey,
    daysTracked: rows.length,
    totalMl,
    targetMl,
    targetPerDayMl,
    completionPct: targetMl > 0 ? Math.round(Math.min(150, (totalMl / targetMl) * 100)) : 0,
  };
}

async function getLatestMealPlan(supabase, userId) {
  return supabaseQuery(() => supabase
    .from('meal_plans')
    .select('id, plan_data, daily_targets, created_at')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

async function getLatestWorkoutPlan(supabase, userId) {
  return supabaseQuery(() => supabase
    .from('workout_plans')
    .select('id, plan_data, created_at')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

async function getFoodPortionLimitMap(supabase) {
  const { data, error } = await supabaseQuery(() => supabase
    .from('foods')
    .select('name, aliases, min_amount_per_meal, max_amount_per_meal')
    .eq('is_active', true));

  if (error) {
    console.error('[premium-checkin-upgrade] food portion limits error:', error);
    return buildFoodPortionLimitMap([]);
  }

  return buildFoodPortionLimitMap(data || []);
}

async function getLatestCheckIn(supabase, userId) {
  return supabaseQuery(() => supabase
    .from('weekly_checkins')
    .select(`
      id,
      week_key,
      weight_kg,
      previous_weight_kg,
      target_weight_kg,
      goal,
      account_type,
      meal_adherence_pct,
      workout_adherence_pct,
      workout_difficulty,
      hunger_level,
      weight_delta_kg,
      outcome,
      recommendation,
      suggested_adjustment_calories,
      applied_adjustment_calories,
      applied_adjustment_carbs_g,
      plan_adjusted,
      targets_before,
      targets_after,
      metadata,
      created_at
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

export async function applyPremiumCheckInUpgrade(supabase, userId, { source = 'subscription_upgrade' } = {}) {
  if (!supabase || !userId) return { processed: false, reason: 'missing_input' };

  const { data: user, error: userError } = await supabaseQuery(() => supabase
    .from('users')
    .select(`
      id,
      weight,
      target_weight,
      goal,
      fitness_goal,
      account_type,
      subscription_status,
      hydration_target_ml,
      available_equipment,
      nutrition_target_calories,
      nutrition_target_protein_g,
      nutrition_target_carbs_g,
      nutrition_target_fat_g
    `)
    .eq('id', userId)
    .maybeSingle());

  if (userError || !user) return { processed: false, reason: 'user_not_found', error: userError };
  if (user.account_type !== 'paid' && user.subscription_status !== 'active') {
    return { processed: false, reason: 'not_paid' };
  }

  const { data: checkIn, error: checkInError } = await getLatestCheckIn(supabase, userId);
  if (checkInError || !checkIn) return { processed: false, reason: 'no_checkin', error: checkInError };

  const metadata = checkIn.metadata || {};
  if (metadata.premiumUpgradeAppliedAt && Array.isArray(metadata.coachInsights)) {
    return { processed: false, reason: 'already_applied', checkInId: checkIn.id };
  }

  const weekKey = String(checkIn.week_key || '').slice(0, 10);
  const input = {
    weightKg: Number(checkIn.weight_kg) || Number(user.weight) || 0,
    mealAdherencePct: Number(checkIn.meal_adherence_pct) || 0,
    workoutAdherencePct: Number(checkIn.workout_adherence_pct) || 0,
    workoutDifficulty: Number(checkIn.workout_difficulty) || 3,
    hungerLevel: Number(checkIn.hunger_level) || 3,
  };
  const previousWeight = Number(checkIn.previous_weight_kg) || Number(user.weight) || input.weightKg;
  const goal = user.goal || user.fitness_goal || checkIn.goal || 'maintenance';
  const evaluation = evaluateGoalProgress({
    goal,
    previousWeight,
    currentWeight: input.weightKg,
    targetWeight: user.target_weight,
  });
  const suggestedAdjustmentCalories = getAdjustmentCalories({
    evaluation,
    mealAdherencePct: input.mealAdherencePct,
    hungerLevel: input.hungerLevel,
  });

  const [
    { data: latestMealPlan, error: mealPlanError },
    { data: latestWorkoutPlan },
    waterStats,
  ] = await Promise.all([
    getLatestMealPlan(supabase, userId),
    getLatestWorkoutPlan(supabase, userId),
    getWeeklyWaterStats(supabase, userId, weekKey, user.hydration_target_ml),
  ]);

  if (mealPlanError) return { processed: false, reason: 'meal_plan_error', error: mealPlanError };

  const targetsBefore = latestMealPlan?.daily_targets || latestMealPlan?.plan_data?.dailyTargets || getTargetsFromUser(user);
  let targetsAfter = targetsBefore;
  let adjustedMealPlanId = null;
  let planAdjusted = false;
  let achievedCaloriesDelta = 0;
  let recommendation = evaluation.recommendation;

  if (latestMealPlan?.plan_data && suggestedAdjustmentCalories !== 0) {
    const foodLimitMap = await getFoodPortionLimitMap(supabase);
    const adjusted = adjustMealPlanCarbs(latestMealPlan.plan_data, targetsBefore, suggestedAdjustmentCalories, { foodLimitMap });
    targetsAfter = adjusted.targetsAfter;
    achievedCaloriesDelta = adjusted.achievedCaloriesDelta;

    const adjustmentHasExpectedDirection = suggestedAdjustmentCalories < 0
      ? achievedCaloriesDelta < 0
      : achievedCaloriesDelta > 0;

    if (adjustmentHasExpectedDirection && Math.abs(achievedCaloriesDelta) >= 40) {
      const { data: insertedPlan, error: insertPlanError } = await supabaseQuery(() => supabase
        .from('meal_plans')
        .insert({
          client_id: userId,
          plan_data: {
            ...adjusted.planData,
            weeklyCheckInAdjustment: {
              sourceMealPlanId: latestMealPlan.id,
              weekKey,
              outcome: evaluation.outcome,
              direction: evaluation.adjustmentDirection,
              requestedCaloriesDelta: suggestedAdjustmentCalories,
              achievedCaloriesDelta,
              source,
            },
          },
          daily_targets: targetsAfter,
        })
        .select('id')
        .maybeSingle());

      if (insertPlanError) return { processed: false, reason: 'meal_plan_insert_error', error: insertPlanError };

      adjustedMealPlanId = insertedPlan?.id || null;
      planAdjusted = true;
      recommendation = suggestedAdjustmentCalories < 0
        ? 'Am redus uniform carbohidrații din plan cu aproximativ 100 kcal pe zi pentru un deficit mai clar săptămâna viitoare.'
        : 'Am crescut uniform carbohidrații din plan cu aproximativ 100 kcal pe zi pentru un surplus mai bun săptămâna viitoare.';
    }
  }

  let adjustedWorkoutPlanId = null;
  let workoutAdjustment = null;
  if (latestWorkoutPlan?.plan_data) {
    const adjustedWorkout = adjustWorkoutPlanProgression(latestWorkoutPlan.plan_data, {
      workoutDifficulty: input.workoutDifficulty,
      availableEquipment: user.available_equipment,
    });

    workoutAdjustment = {
      status: adjustedWorkout.progression?.status || null,
      exercisesAdjusted: adjustedWorkout.exercisesAdjusted || 0,
      planAdjusted: adjustedWorkout.adjusted === true,
    };

    if (adjustedWorkout.adjusted) {
      const { data: insertedWorkoutPlan, error: insertWorkoutPlanError } = await supabaseQuery(() => supabase
        .from('workout_plans')
        .insert({
          client_id: userId,
          plan_data: {
            ...adjustedWorkout.planData,
            weeklyCheckInAdjustment: {
              sourceWorkoutPlanId: latestWorkoutPlan.id,
              weekKey,
              status: adjustedWorkout.progression?.status || null,
              exercisesAdjusted: adjustedWorkout.exercisesAdjusted || 0,
              source,
            },
          },
        })
        .select('id')
        .maybeSingle());

      if (insertWorkoutPlanError) return { processed: false, reason: 'workout_plan_insert_error', error: insertWorkoutPlanError };

      adjustedWorkoutPlanId = insertedWorkoutPlan?.id || null;
      workoutAdjustment.workoutPlanId = adjustedWorkoutPlanId;
    }
  }

  const nutritionAdjustment = {
    suggestedCalories: suggestedAdjustmentCalories,
    appliedCalories: planAdjusted ? achievedCaloriesDelta : 0,
    appliedCarbsG: planAdjusted ? Math.round(achievedCaloriesDelta / 4) : 0,
    planAdjusted,
  };
  const coachInsights = buildCoachInsights({
    input,
    evaluation,
    availableEquipment: user.available_equipment,
    latestWorkoutPlan: latestWorkoutPlan?.plan_data || null,
    waterStats,
    planAdjusted,
    achievedCaloriesDelta,
  });

  const { error: updateCheckInError } = await supabaseQuery(() => supabase
    .from('weekly_checkins')
    .update({
      account_type: 'paid',
      goal: evaluation.goal,
      outcome: evaluation.outcome,
      recommendation,
      suggested_adjustment_calories: suggestedAdjustmentCalories,
      applied_adjustment_calories: nutritionAdjustment.appliedCalories,
      applied_adjustment_carbs_g: nutritionAdjustment.appliedCarbsG,
      plan_adjusted: planAdjusted,
      meal_plan_id_before: latestMealPlan?.id ? String(latestMealPlan.id) : null,
      meal_plan_id_after: adjustedMealPlanId ? String(adjustedMealPlanId) : null,
      targets_before: targetsBefore || {},
      targets_after: targetsAfter || targetsBefore || {},
      metadata: {
        ...metadata,
        waterStats,
        coachInsights,
        nutritionAdjustment,
        workoutAdjustment,
        premiumUpgradeAppliedAt: new Date().toISOString(),
        premiumUpgradeSource: source,
      },
    })
    .eq('id', checkIn.id)
    .eq('user_id', userId));

  if (updateCheckInError) return { processed: false, reason: 'checkin_update_error', error: updateCheckInError };

  if (targetsAfter?.calories) {
    await supabaseQuery(() => supabase
      .from('users')
      .update({
        nutrition_target_calories: targetsAfter.calories,
        nutrition_target_protein_g: targetsAfter.protein,
        nutrition_target_carbs_g: targetsAfter.carbs,
        nutrition_target_fat_g: targetsAfter.fat,
      })
      .eq('id', userId));
  }

  return {
    processed: true,
    checkInId: checkIn.id,
    planAdjusted,
    adjustedMealPlanId,
    adjustedWorkoutPlanId,
  };
}
