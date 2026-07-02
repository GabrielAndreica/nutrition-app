import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { getLevelInfo } from '@/app/api/user/level/route';
import {
  applyDayCompletion,
  buildDailyProgressUpdate,
  getDayStatusPayload,
  reconcileDailyPlanProgress,
} from '@/app/lib/dailyPlanProgress';

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-xp-post',
    maxRequests: 20,
    windowMinutes: 1,
  });
  if (rl) return rl;

  let amount = 50;
  let type = null; // 'meals' | 'workout'
  let dayIndex = null;
  try {
    const body = await request.json();
    const parsed = Number(body?.amount);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) amount = parsed;
    if (body?.type === 'meals' || body?.type === 'workout') type = body.type;
    const parsedDayIndex = Number(body?.dayIndex);
    if (Number.isInteger(parsedDayIndex) && parsedDayIndex >= 0 && parsedDayIndex <= 6) {
      dayIndex = parsedDayIndex;
    }
  } catch {}

  const supabase = getSupabase();

  const { data: clientRow, error: fetchError } = await supabase
    .from('users')
    .select(`
      xp,
      level,
      meals_cooldown_until,
      workout_cooldown_until,
      meals_completed_days,
      workout_completed_days,
      current_plan_day,
      current_plan_day_due_at,
      meal_day_status,
      workout_day_status,
      streak_count,
      streak_state,
      streak_recovery_day,
      streak_awarded_day,
      weekly_plan_due_at
    `)
    .eq('id', auth.userId)
    .maybeSingle();

  if (fetchError || !clientRow) {
    return NextResponse.json({ error: 'Utilizator negăsit.' }, { status: 404 });
  }

  // Prevent double-claiming: check if already finalized today
  const now = new Date();
  let dailyState = reconcileDailyPlanProgress(clientRow, now);
  if (dailyState.changed) {
    await supabase
      .from('users')
      .update(buildDailyProgressUpdate(dailyState))
      .eq('id', auth.userId);
  }
  const midnightIso = dailyState.currentPlanDayDueAt;

  if (type === 'meals' && clientRow.meals_cooldown_until && new Date(clientRow.meals_cooldown_until) > now) {
    return NextResponse.json({ error: 'Ziua de mese a fost deja finalizată.' }, { status: 409 });
  }
  if (type === 'workout' && clientRow.workout_cooldown_until && new Date(clientRow.workout_cooldown_until) > now) {
    return NextResponse.json({ error: 'Antrenamentul a fost deja finalizat.' }, { status: 409 });
  }
  if (type === 'meals' && dailyState.currentPlanDay >= 7) {
    return NextResponse.json({ error: 'Cele 7 zile de mese sunt deja finalizate.' }, { status: 409 });
  }
  if (type === 'workout' && dailyState.currentPlanDay >= 7) {
    return NextResponse.json({ error: 'Cele 7 zile de antrenament sunt deja finalizate.' }, { status: 409 });
  }
  if (type === 'meals' && dayIndex !== null && dayIndex !== dailyState.currentPlanDay) {
    return NextResponse.json({ error: 'Această zi nu este disponibilă încă.' }, { status: 409 });
  }
  if (type === 'workout' && dayIndex !== null && dayIndex !== dailyState.currentPlanDay) {
    return NextResponse.json({ error: 'Această zi nu este disponibilă încă.' }, { status: 409 });
  }

  const newXp = (clientRow.xp || 0) + amount;
  const info = getLevelInfo(newXp);

  const completionDay = dailyState.currentPlanDay;
  if (type) {
    dailyState = applyDayCompletion(dailyState, type, completionDay);
  }
  const progressUpdate = type ? buildDailyProgressUpdate(dailyState) : {};
  const updatePayload = { xp: newXp, level: info.level, ...progressUpdate };
  const nextMealsDays = type ? progressUpdate.meals_completed_days : Math.max(0, Math.min(7, Number(clientRow.meals_completed_days) || 0));
  const nextWorkoutDays = type ? progressUpdate.workout_completed_days : Math.max(0, Math.min(7, Number(clientRow.workout_completed_days) || 0));

  if (type === 'meals') {
    updatePayload.meals_cooldown_until = midnightIso;
  }
  if (type === 'workout') {
    updatePayload.workout_cooldown_until = midnightIso;
  }
  if (type && !clientRow.weekly_plan_due_at && nextMealsDays >= 7 && nextWorkoutDays >= 7) {
    updatePayload.weekly_plan_due_at = midnightIso;
  }

  const { error: updateError } = await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', auth.userId);

  if (updateError) {
    console.error('[user/xp] update error:', updateError);
    return NextResponse.json({ error: 'Eroare la actualizarea XP.' }, { status: 500 });
  }

  return NextResponse.json({
    ...info,
    xpAdded: amount,
    mealsCooldownUntil: type === 'meals' ? midnightIso : (clientRow.meals_cooldown_until || null),
    workoutCooldownUntil: type === 'workout' ? midnightIso : (clientRow.workout_cooldown_until || null),
    mealsCompletedDays: nextMealsDays,
    workoutCompletedDays: nextWorkoutDays,
    ...getDayStatusPayload(dailyState),
    weeklyPlanDueAt: updatePayload.weekly_plan_due_at || clientRow.weekly_plan_due_at || null,
  });
}
