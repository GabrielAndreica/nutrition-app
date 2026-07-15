import { NextResponse } from 'next/server';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import {
  adjustMealPlanCarbs,
  buildPostCheckInUserReset,
  evaluateGoalProgress,
  getAdjustmentCalories,
  getWeekKey,
  isWeeklyCheckInDay,
  normalizeWeeklyCheckInInput,
} from '@/app/lib/weeklyCheckIn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function getLatestMealPlan(supabase, userId) {
  return supabaseQuery(() => supabase
    .from('meal_plans')
    .select('id, plan_data, daily_targets, created_at')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

async function getLatestCheckIn(supabase, userId) {
  return supabaseQuery(() => supabase
    .from('weekly_checkins')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

function buildDuePayload({ user, latestCheckIn, latestMealPlan, now = new Date() }) {
  const weeklyDueAt = user?.weekly_plan_due_at ? new Date(user.weekly_plan_due_at) : null;
  const weeklyPlanDue = !!(weeklyDueAt && weeklyDueAt <= now);
  const isSunday = isWeeklyCheckInDay(now);
  const weekKey = getWeekKey(now);
  const alreadyCheckedIn = String(latestCheckIn?.week_key || '').slice(0, 10) === weekKey;
  const due = !alreadyCheckedIn && isSunday;
  const currentTargets = latestMealPlan?.daily_targets || latestMealPlan?.plan_data?.dailyTargets || getTargetsFromUser(user);

  return {
    due,
    weeklyPlanDue,
    isSunday,
    weekKey,
    accountType: resolveAccountType(user),
    goal: user?.goal || user?.fitness_goal || 'maintenance',
    currentWeight: Number(user?.weight) || null,
    targetWeight: Number(user?.target_weight) || null,
    currentTargets,
    latestCheckIn: latestCheckIn ? {
      weekKey: latestCheckIn.week_key,
      weightKg: Number(latestCheckIn.weight_kg) || null,
      outcome: latestCheckIn.outcome,
      recommendation: latestCheckIn.recommendation,
      createdAt: latestCheckIn.created_at,
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
      nutrition_target_fat_g
    `)
    .eq('id', auth.userId)
    .maybeSingle());

  if (userError || !user) {
    return NextResponse.json({ error: 'Utilizator negăsit.' }, { status: 404 });
  }

  const [{ data: latestCheckIn }, { data: latestMealPlan }] = await Promise.all([
    getLatestCheckIn(supabase, auth.userId),
    getLatestMealPlan(supabase, auth.userId),
  ]);

  return NextResponse.json(buildDuePayload({ user, latestCheckIn, latestMealPlan }));
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
      nutrition_target_fat_g
    `)
    .eq('id', auth.userId)
    .maybeSingle());

  if (userError || !user) {
    return NextResponse.json({ error: 'Utilizator negăsit.' }, { status: 404 });
  }

  const weeklyDueAt = user.weekly_plan_due_at ? new Date(user.weekly_plan_due_at) : null;
  const weeklyPlanDue = !!(weeklyDueAt && weeklyDueAt <= now);
  if (!isWeeklyCheckInDay(now)) {
    return NextResponse.json({ error: 'Check-in-ul săptămânal este disponibil duminica.' }, { status: 409 });
  }

  const [{ data: previousCheckIn }, { data: latestMealPlan, error: mealPlanError }] = await Promise.all([
    getLatestCheckIn(supabase, auth.userId),
    getLatestMealPlan(supabase, auth.userId),
  ]);

  if (mealPlanError) {
    return NextResponse.json({ error: 'Nu am putut citi planul alimentar curent.' }, { status: 500 });
  }
  if (String(previousCheckIn?.week_key || '').slice(0, 10) === weekKey) {
    return NextResponse.json({ error: 'Check-in-ul pentru această săptămână este deja salvat.' }, { status: 409 });
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

  if (accountType === 'paid' && latestMealPlan?.plan_data && suggestedAdjustmentCalories !== 0) {
    const adjusted = adjustMealPlanCarbs(
      latestMealPlan.plan_data,
      targetsBefore,
      suggestedAdjustmentCalories
    );
    targetsAfter = adjusted.targetsAfter;
    achievedCaloriesDelta = adjusted.achievedCaloriesDelta;

    if (Math.abs(achievedCaloriesDelta) >= 40) {
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
      recommendation = achievedCaloriesDelta < 0
        ? 'Am redus ușor carbohidrații din mese ca să obținem un deficit mai clar săptămâna viitoare.'
        : 'Am crescut ușor carbohidrații din mese ca să obținem un surplus mai bun săptămâna viitoare.';
    }
  }

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
    evaluation,
    recommendation,
    planAdjusted,
    mealPlanId: adjustedMealPlanId || latestMealPlan?.id || null,
    targetsBefore,
    targetsAfter,
    adjustment: {
      suggestedCalories: suggestedAdjustmentCalories,
      appliedCalories: planAdjusted ? achievedCaloriesDelta : 0,
      appliedCarbsG: planAdjusted ? Math.round(achievedCaloriesDelta / 4) : 0,
    },
  });
}
