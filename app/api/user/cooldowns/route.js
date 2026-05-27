import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import {
  buildDailyProgressUpdate,
  getDayStatusPayload,
  reconcileDailyPlanProgress,
} from '@/app/lib/dailyPlanProgress';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = getSupabase();
  const { data: clientRow, error } = await supabase
    .from('clients')
    .select(`
      id,
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
      weekly_plan_due_at,
      weekly_plan_generation_started_at,
      weekly_plan_generation_error
    `)
    .eq('user_id', auth.userId)
    .is('trainer_id', null)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Eroare DB.' }, { status: 500 });
  }

  const now = new Date();
  let dailyState = reconcileDailyPlanProgress(clientRow, now);
  if (clientRow?.id && dailyState.changed) {
    const updatePayload = buildDailyProgressUpdate(dailyState);
    const { data: updatedRow } = await supabase
      .from('clients')
      .update(updatePayload)
      .eq('id', clientRow.id)
      .select(`
        current_plan_day,
        current_plan_day_due_at,
        meal_day_status,
        workout_day_status,
        meals_completed_days,
        workout_completed_days,
        streak_count,
        streak_state,
        streak_recovery_day,
        streak_awarded_day,
        weekly_plan_due_at
      `)
      .maybeSingle();
    if (updatedRow) dailyState = reconcileDailyPlanProgress(updatedRow, now);
  }

  const weeklyPlanDue = !!(dailyState.weeklyPlanDueAt && new Date(dailyState.weeklyPlanDueAt) <= now);
  return NextResponse.json({
    mealsCooldownUntil: clientRow?.meals_cooldown_until && new Date(clientRow.meals_cooldown_until) > now
      ? clientRow.meals_cooldown_until
      : null,
    workoutCooldownUntil: clientRow?.workout_cooldown_until && new Date(clientRow.workout_cooldown_until) > now
      ? clientRow.workout_cooldown_until
      : null,
    mealsCompletedDays: Math.max(0, Math.min(7, Number(dailyState.mealStatus && Object.values(dailyState.mealStatus).filter(Boolean).length) || 0)),
    workoutCompletedDays: Math.max(0, Math.min(7, Number(dailyState.workoutStatus && Object.values(dailyState.workoutStatus).filter(Boolean).length) || 0)),
    weeklyPlanDueAt: dailyState.weeklyPlanDueAt || null,
    weeklyPlanDue,
    ...getDayStatusPayload(dailyState),
    weeklyPlanRegenerating: !!(
      clientRow?.weekly_plan_generation_started_at &&
      new Date(clientRow.weekly_plan_generation_started_at) > new Date(Date.now() - 30 * 60 * 1000)
    ),
    weeklyPlanGenerationError: clientRow?.weekly_plan_generation_error || null,
  });
}
