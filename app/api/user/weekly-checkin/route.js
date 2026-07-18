import { NextResponse } from 'next/server';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import {
  adjustMealPlanCarbs,
  adjustWorkoutPlanProgression,
  buildFoodPortionLimitMap,
  buildCoachInsights,
  buildPostCheckInUserReset,
  evaluateGoalProgress,
  getAdjustmentCalories,
  getWeekKey,
  getWeeklyCheckInWarmupStatus,
  isWeeklyCheckInDay,
  normalizeWeeklyCheckInInput,
} from '@/app/lib/weeklyCheckIn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_WEEKLY_CHECKIN_BODY_BYTES = 16 * 1024;

function resolveAccountType(user = {}) {
  return user.account_type || (user.subscription_status === 'active' ? 'paid' : 'free');
}

function getTargetsFromUser(user = {}) {
  const targets = {
    calories: Number(user.nutrition_target_calories) || 0,
    protein: Number(user.nutrition_target_protein_g) || 0,
    carbs: Number(user.nutrition_target_carbs_g) || 0,
    fat: Number(user.nutrition_target_fat_g) || 0,
  };
  return targets.calories > 0 ? targets : null;
}

function isForcedWeeklyCheckInEnabled() {
  return process.env.NODE_ENV !== 'production' &&
    process.env.FORCE_WEEKLY_CHECKIN === 'true';
}

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
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

async function getLatestMealPlanSummary(supabase, userId) {
  return supabaseQuery(() => supabase
    .from('meal_plans')
    .select('id, daily_targets, created_at')
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
    console.error('[weekly-checkin] food portion limits error:', error);
    return buildFoodPortionLimitMap([]);
  }

  return buildFoodPortionLimitMap(data || []);
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getWeeklyWaterStats(supabase, userId, weekKey, hydrationTargetMl) {
  const targetPerDayMl = Math.max(0, Number(hydrationTargetMl) || 0);
  if (!targetPerDayMl) return null;

  const startDate = addDaysToDateKey(weekKey, -6);
  const { data, error } = await supabaseQuery(() => supabase
    .from('daily_user_progress')
    .select('progress_date, water_ml')
    .eq('user_id', userId)
    .gte('progress_date', startDate)
    .lte('progress_date', weekKey));

  if (error) {
    console.error('[weekly-checkin] water stats error:', error);
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

function buildDuePayload({ user, latestCheckIn, latestMealPlan, now = new Date(), forceDue = false }) {
  const weeklyDueAt = user?.weekly_plan_due_at ? new Date(user.weekly_plan_due_at) : null;
  const weeklyPlanDue = !!(weeklyDueAt && weeklyDueAt <= now);
  const isSunday = isWeeklyCheckInDay(now);
  const weekKey = getWeekKey(now);
  const alreadyCheckedIn = String(latestCheckIn?.week_key || '').slice(0, 10) === weekKey;
  const warmupStatus = getWeeklyCheckInWarmupStatus({
    userCreatedAt: user?.created_at,
    latestCheckIn,
    now,
    forceDue,
  });
  const due = !alreadyCheckedIn && (isSunday || forceDue) && warmupStatus.eligible;
  const currentTargets = latestMealPlan?.daily_targets || latestMealPlan?.plan_data?.dailyTargets || getTargetsFromUser(user);

  return {
    due,
    weeklyPlanDue,
    isSunday,
    forced: forceDue,
    eligibleForWeeklyCheckIn: warmupStatus.eligible,
    nextWeeklyCheckInEligibleAt: warmupStatus.nextEligibleAt,
    weekKey,
    accountType: resolveAccountType(user),
    goal: user?.goal || user?.fitness_goal || 'maintenance',
    currentWeight: Number(user?.weight) || null,
    targetWeight: Number(user?.target_weight) || null,
    currentTargets,
    latestCheckIn: latestCheckIn ? {
      weekKey: latestCheckIn.week_key,
      weightKg: Number(latestCheckIn.weight_kg) || null,
      previousWeightKg: Number(latestCheckIn.previous_weight_kg) || null,
      targetWeightKg: Number(latestCheckIn.target_weight_kg) || null,
      goal: latestCheckIn.goal,
      accountType: latestCheckIn.account_type,
      mealAdherencePct: latestCheckIn.meal_adherence_pct,
      workoutAdherencePct: latestCheckIn.workout_adherence_pct,
      workoutDifficulty: latestCheckIn.workout_difficulty,
      hungerLevel: latestCheckIn.hunger_level,
      weightDeltaKg: Number(latestCheckIn.weight_delta_kg) || 0,
      outcome: latestCheckIn.outcome,
      recommendation: latestCheckIn.recommendation,
      planAdjusted: latestCheckIn.plan_adjusted === true,
      targetsBefore: latestCheckIn.targets_before || null,
      targetsAfter: latestCheckIn.targets_after || null,
      adjustment: {
        suggestedCalories: latestCheckIn.suggested_adjustment_calories || 0,
        appliedCalories: latestCheckIn.applied_adjustment_calories || 0,
        appliedCarbsG: latestCheckIn.applied_adjustment_carbs_g || 0,
      },
      metadata: latestCheckIn.metadata || {},
      createdAt: latestCheckIn.created_at,
      coachInsights: latestCheckIn.metadata?.coachInsights || [],
      waterStats: latestCheckIn.metadata?.waterStats || null,
      nutritionAdjustment: latestCheckIn.metadata?.nutritionAdjustment || null,
      workoutAdjustment: latestCheckIn.metadata?.workoutAdjustment || null,
    } : null,
  };
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-weekly-checkin-get',
    maxRequests: 60,
    windowMinutes: 1,
  });
  if (rl) return rl;

  const supabase = getSupabase();
  const { data: user, error: userError } = await supabaseQuery(() => supabase
    .from('users')
    .select(`
      id,
      created_at,
      weight,
      target_weight,
      goal,
      fitness_goal,
      account_type,
      subscription_status,
      weekly_plan_due_at,
      nutrition_target_calories,
      nutrition_target_protein_g,
      nutrition_target_carbs_g,
      nutrition_target_fat_g,
      hydration_target_ml,
      available_equipment
    `)
    .eq('id', auth.userId)
    .maybeSingle());

  if (userError || !user) {
    return NextResponse.json({ error: 'Utilizator negăsit.' }, { status: 404 });
  }

  const [{ data: latestCheckIn }, { data: latestMealPlan }] = await Promise.all([
    getLatestCheckIn(supabase, auth.userId),
    getLatestMealPlanSummary(supabase, auth.userId),
  ]);

  return NextResponse.json(buildDuePayload({
    user,
    latestCheckIn,
    latestMealPlan,
    forceDue: isForcedWeeklyCheckInEnabled(),
  }));
}

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-weekly-checkin-post',
    maxRequests: 8,
    windowMinutes: 60,
    failClosed: true,
  });
  if (rl) return rl;

  if (requestBodyTooLarge(request, MAX_WEEKLY_CHECKIN_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let input;
  try {
    input = normalizeWeeklyCheckInInput(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Date check-in invalide.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const now = new Date();
  const weekKey = getWeekKey(now);

  const { data: user, error: userError } = await supabaseQuery(() => supabase
    .from('users')
    .select(`
      id,
      created_at,
      weight,
      target_weight,
      goal,
      fitness_goal,
      account_type,
      subscription_status,
      weekly_plan_due_at,
      nutrition_target_calories,
      nutrition_target_protein_g,
      nutrition_target_carbs_g,
      nutrition_target_fat_g,
      hydration_target_ml,
      available_equipment
    `)
    .eq('id', auth.userId)
    .maybeSingle());

  if (userError || !user) {
    return NextResponse.json({ error: 'Utilizator negăsit.' }, { status: 404 });
  }

  const weeklyDueAt = user.weekly_plan_due_at ? new Date(user.weekly_plan_due_at) : null;
  const weeklyPlanDue = !!(weeklyDueAt && weeklyDueAt <= now);
  if (!isWeeklyCheckInDay(now) && !isForcedWeeklyCheckInEnabled()) {
    return NextResponse.json({ error: 'Check-in-ul săptămânal este disponibil duminica.' }, { status: 409 });
  }

  const [
    { data: previousCheckIn },
    { data: latestMealPlan, error: mealPlanError },
    { data: latestWorkoutPlan },
    waterStats,
  ] = await Promise.all([
    getLatestCheckIn(supabase, auth.userId),
    getLatestMealPlan(supabase, auth.userId),
    getLatestWorkoutPlan(supabase, auth.userId),
    getWeeklyWaterStats(supabase, auth.userId, weekKey, user.hydration_target_ml),
  ]);

  if (mealPlanError) {
    return NextResponse.json({ error: 'Nu am putut citi planul alimentar curent.' }, { status: 500 });
  }
  if (String(previousCheckIn?.week_key || '').slice(0, 10) === weekKey) {
    return NextResponse.json({ error: 'Check-in-ul pentru această săptămână este deja salvat.' }, { status: 409 });
  }
  const warmupStatus = getWeeklyCheckInWarmupStatus({
    userCreatedAt: user.created_at,
    latestCheckIn: previousCheckIn,
    now,
    forceDue: isForcedWeeklyCheckInEnabled(),
  });
  if (!warmupStatus.eligible) {
    return NextResponse.json({
      error: 'Primul check-in va fi disponibil după prima săptămână completă.',
      nextEligibleAt: warmupStatus.nextEligibleAt,
    }, { status: 409 });
  }

  const previousWeight = Number(previousCheckIn?.weight_kg) || Number(user.weight) || input.weightKg;
  const goal = user.goal || user.fitness_goal || 'maintenance';
  const accountType = resolveAccountType(user);
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

  const targetsBefore = latestMealPlan?.daily_targets || latestMealPlan?.plan_data?.dailyTargets || getTargetsFromUser(user);
  let targetsAfter = targetsBefore;
  let adjustedMealPlanId = null;
  let planAdjusted = false;
  let achievedCaloriesDelta = 0;
  let recommendation = evaluation.recommendation;
  let adjustedWorkoutPlanId = null;
  let workoutPlanAdjusted = false;
  let workoutAdjustment = null;

  if (accountType === 'paid' && latestMealPlan?.plan_data && suggestedAdjustmentCalories !== 0) {
    const foodLimitMap = await getFoodPortionLimitMap(supabase);
    const adjusted = adjustMealPlanCarbs(
      latestMealPlan.plan_data,
      targetsBefore,
      suggestedAdjustmentCalories,
      { foodLimitMap }
    );
    targetsAfter = adjusted.targetsAfter;
    achievedCaloriesDelta = adjusted.achievedCaloriesDelta;
    const adjustmentHasExpectedDirection = suggestedAdjustmentCalories < 0
      ? achievedCaloriesDelta < 0
      : achievedCaloriesDelta > 0;

    if (adjustmentHasExpectedDirection && Math.abs(achievedCaloriesDelta) >= 40) {
      const nextPlanData = {
        ...adjusted.planData,
        weeklyCheckInAdjustment: {
          sourceMealPlanId: latestMealPlan.id,
          weekKey,
          outcome: evaluation.outcome,
          direction: evaluation.adjustmentDirection,
          requestedCaloriesDelta: suggestedAdjustmentCalories,
          achievedCaloriesDelta,
        },
      };

      const { data: insertedPlan, error: insertPlanError } = await supabaseQuery(() => supabase
        .from('meal_plans')
        .insert({
          client_id: auth.userId,
          plan_data: nextPlanData,
          daily_targets: targetsAfter,
        })
        .select('id')
        .maybeSingle());

      if (insertPlanError) {
        console.error('[weekly-checkin] adjusted meal plan insert error:', insertPlanError);
        return NextResponse.json({ error: 'Nu am putut salva planul alimentar ajustat.' }, { status: 500 });
      }

      adjustedMealPlanId = insertedPlan?.id || null;
      planAdjusted = true;
      recommendation = suggestedAdjustmentCalories < 0
        ? 'Am redus uniform carbohidrații din plan cu aproximativ 100 kcal pe zi pentru un deficit mai clar săptămâna viitoare.'
        : 'Am crescut uniform carbohidrații din plan cu aproximativ 100 kcal pe zi pentru un surplus mai bun săptămâna viitoare.';
    }
  }

  if (accountType === 'paid' && latestWorkoutPlan?.plan_data) {
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
          client_id: auth.userId,
          plan_data: {
            ...adjustedWorkout.planData,
            weeklyCheckInAdjustment: {
              sourceWorkoutPlanId: latestWorkoutPlan.id,
              weekKey,
              status: adjustedWorkout.progression?.status || null,
              exercisesAdjusted: adjustedWorkout.exercisesAdjusted || 0,
            },
          },
        })
        .select('id')
        .maybeSingle());

      if (insertWorkoutPlanError) {
        console.error('[weekly-checkin] adjusted workout plan insert error:', insertWorkoutPlanError);
        return NextResponse.json({ error: 'Nu am putut salva planul de antrenament ajustat.' }, { status: 500 });
      }

      adjustedWorkoutPlanId = insertedWorkoutPlan?.id || null;
      workoutPlanAdjusted = true;
      workoutAdjustment.planAdjusted = true;
      workoutAdjustment.workoutPlanId = adjustedWorkoutPlanId;
    }
  }

  const coachInsights = accountType === 'paid'
    ? buildCoachInsights({
      input,
      evaluation,
      availableEquipment: user.available_equipment,
      latestWorkoutPlan: latestWorkoutPlan?.plan_data || null,
      waterStats,
      planAdjusted,
      achievedCaloriesDelta,
    })
    : [];

  const nutritionAdjustment = {
    suggestedCalories: suggestedAdjustmentCalories,
    appliedCalories: planAdjusted ? achievedCaloriesDelta : 0,
    appliedCarbsG: planAdjusted ? Math.round(achievedCaloriesDelta / 4) : 0,
    planAdjusted,
  };

  const { data: checkIn, error: checkInError } = await supabaseQuery(() => supabase
    .from('weekly_checkins')
    .upsert({
      user_id: auth.userId,
      week_key: weekKey,
      weight_kg: input.weightKg,
      previous_weight_kg: previousWeight,
      target_weight_kg: Number(user.target_weight) || null,
      goal,
      account_type: accountType,
      meal_adherence_pct: input.mealAdherencePct,
      workout_adherence_pct: input.workoutAdherencePct,
      workout_difficulty: input.workoutDifficulty,
      hunger_level: input.hungerLevel,
      notes: input.notes || null,
      weight_delta_kg: evaluation.deltaKg,
      outcome: evaluation.outcome,
      recommendation,
      suggested_adjustment_calories: suggestedAdjustmentCalories,
      applied_adjustment_calories: planAdjusted ? achievedCaloriesDelta : 0,
      applied_adjustment_carbs_g: planAdjusted ? Math.round(achievedCaloriesDelta / 4) : 0,
      plan_adjusted: planAdjusted,
      meal_plan_id_before: latestMealPlan?.id ? String(latestMealPlan.id) : null,
      meal_plan_id_after: adjustedMealPlanId ? String(adjustedMealPlanId) : null,
      targets_before: targetsBefore || {},
      targets_after: targetsAfter || targetsBefore || {},
      metadata: {
        isSunday: isWeeklyCheckInDay(now),
        weeklyPlanDue,
        remainingKg: evaluation.remainingKg,
        waterStats,
        coachInsights,
        nutritionAdjustment,
        workoutAdjustment,
      },
    }, { onConflict: 'user_id,week_key' })
    .select('*')
    .maybeSingle());

  if (checkInError) {
    console.error('[weekly-checkin] upsert error:', checkInError);
    return NextResponse.json({ error: 'Nu am putut salva check-in-ul.' }, { status: 500 });
  }

  const resetPayload = buildPostCheckInUserReset(now);
  const userUpdate = {
    ...resetPayload,
    weight: input.weightKg,
    last_weekly_checkin_at: now.toISOString(),
  };
  if (targetsAfter?.calories) {
    userUpdate.nutrition_target_calories = targetsAfter.calories;
    userUpdate.nutrition_target_protein_g = targetsAfter.protein;
    userUpdate.nutrition_target_carbs_g = targetsAfter.carbs;
    userUpdate.nutrition_target_fat_g = targetsAfter.fat;
  }

  const { error: updateError } = await supabaseQuery(() => supabase
    .from('users')
    .update(userUpdate)
    .eq('id', auth.userId));

  if (updateError) {
    console.error('[weekly-checkin] user update error:', updateError);
    return NextResponse.json({ error: 'Check-in salvat, dar nu am putut actualiza profilul.' }, { status: 500 });
  }

  await supabase
    .from('notifications')
    .insert({
      user_id: auth.userId,
      type: planAdjusted ? 'weekly_checkin_adjusted' : 'weekly_checkin_saved',
      title: planAdjusted ? 'Plan ajustat după check-in' : 'Check-in săptămânal salvat',
      message: recommendation,
      related_client_id: auth.userId,
      related_plan_id: adjustedMealPlanId || latestMealPlan?.id || null,
      is_read: false,
    });

  return NextResponse.json({
    success: true,
    checkInId: checkIn?.id || null,
    weekKey,
    accountType,
    goal,
    weightKg: input.weightKg,
    previousWeightKg: previousWeight,
    targetWeightKg: Number(user.target_weight) || null,
    mealAdherencePct: input.mealAdherencePct,
    workoutAdherencePct: input.workoutAdherencePct,
    workoutDifficulty: input.workoutDifficulty,
    hungerLevel: input.hungerLevel,
    weightDeltaKg: evaluation.deltaKg,
    outcome: evaluation.outcome,
    evaluation,
    recommendation,
    planAdjusted,
    mealPlanId: adjustedMealPlanId || latestMealPlan?.id || null,
    targetsBefore,
    targetsAfter,
    adjustment: {
      ...nutritionAdjustment,
    },
    coachInsights,
    waterStats,
    nutritionAdjustment,
    workoutAdjustment,
    workoutPlanAdjusted,
    workoutPlanId: adjustedWorkoutPlanId || latestWorkoutPlan?.id || null,
  });
}
