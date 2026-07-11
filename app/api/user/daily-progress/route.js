import { NextResponse } from 'next/server';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { getCurrentPlanDateKey } from '@/app/lib/weeklyPlanRegeneration';

export const runtime = 'nodejs';

function normalizePlanKey(value) {
  return String(value || 'default')
    .trim()
    .replace(/[^\w:.-]/g, '-')
    .slice(0, 120) || 'default';
}

function getNumericUserId(auth) {
  const userId = Number(auth.userId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function sanitizeMealChecks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result = {};
  for (const [dayKey, meals] of Object.entries(value)) {
    const dayIndex = Number(dayKey);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) continue;
    if (!meals || typeof meals !== 'object' || Array.isArray(meals)) continue;

    const cleanMeals = {};
    for (const [mealKey, checked] of Object.entries(meals)) {
      const mealIndex = Number(mealKey);
      if (!Number.isInteger(mealIndex) || mealIndex < 0 || mealIndex > 30) continue;
      cleanMeals[String(mealIndex)] = checked === true;
    }
    result[String(dayIndex)] = cleanMeals;
  }

  return result;
}

function buildProgressPayload(row, progressDate, mealPlanKey = null) {
  const allMealChecks = row?.meal_checks && typeof row.meal_checks === 'object'
    ? row.meal_checks
    : {};
  const key = mealPlanKey ? normalizePlanKey(mealPlanKey) : null;

  return {
    progressDate,
    waterMl: Math.max(0, Number(row?.water_ml) || 0),
    mealChecks: key ? (allMealChecks[key] || {}) : allMealChecks,
  };
}

async function readDailyProgress(supabase, userId, progressDate) {
  return supabaseQuery(() => supabase
    .from('daily_user_progress')
    .select('meal_checks, water_ml')
    .eq('user_id', userId)
    .eq('progress_date', progressDate)
    .maybeSingle());
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = getNumericUserId(auth);
  if (!userId) return NextResponse.json({ error: 'Utilizator invalid.' }, { status: 401 });

  const rl = await enforceRateLimit(request, {
    userId,
    endpoint: 'user-daily-progress-get',
    maxRequests: 120,
    windowMinutes: 1,
  });
  if (rl) return rl;

  const progressDate = getCurrentPlanDateKey(new Date());
  const mealPlanKey = new URL(request.url).searchParams.get('mealPlanKey');
  const supabase = getSupabase();
  const { data, error } = await readDailyProgress(supabase, userId, progressDate);

  if (error) {
    console.error('[user/daily-progress] GET DB error:', error);
    return NextResponse.json({ error: 'Nu am putut citi progresul zilnic.' }, { status: 500 });
  }

  return NextResponse.json(buildProgressPayload(data, progressDate, mealPlanKey));
}

export async function PATCH(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = getNumericUserId(auth);
  if (!userId) return NextResponse.json({ error: 'Utilizator invalid.' }, { status: 401 });

  const rl = await enforceRateLimit(request, {
    userId,
    endpoint: 'user-daily-progress-patch',
    maxRequests: 180,
    windowMinutes: 1,
  });
  if (rl) return rl;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const progressDate = getCurrentPlanDateKey(new Date());
  const supabase = getSupabase();
  const { data: existing, error: readError } = await readDailyProgress(supabase, userId, progressDate);

  if (readError) {
    console.error('[user/daily-progress] PATCH read DB error:', readError);
    return NextResponse.json({ error: 'Nu am putut citi progresul zilnic.' }, { status: 500 });
  }

  const mealChecks = existing?.meal_checks && typeof existing.meal_checks === 'object'
    ? { ...existing.meal_checks }
    : {};
  const payload = {
    user_id: userId,
    progress_date: progressDate,
    meal_checks: mealChecks,
    water_ml: Math.max(0, Number(existing?.water_ml) || 0),
  };

  if (Object.prototype.hasOwnProperty.call(body, 'waterMl')) {
    payload.water_ml = Math.max(0, Math.min(10000, Math.round(Number(body.waterMl) || 0)));
  }

  if (Object.prototype.hasOwnProperty.call(body, 'mealChecks')) {
    const planKey = normalizePlanKey(body.mealPlanKey);
    payload.meal_checks = {
      ...mealChecks,
      [planKey]: sanitizeMealChecks(body.mealChecks),
    };
  }

  const { data, error } = await supabaseQuery(() => supabase
    .from('daily_user_progress')
    .upsert(payload, { onConflict: 'user_id,progress_date' })
    .select('meal_checks, water_ml')
    .maybeSingle());

  if (error) {
    console.error('[user/daily-progress] PATCH DB error:', error);
    return NextResponse.json({ error: 'Nu am putut salva progresul zilnic.' }, { status: 500 });
  }

  return NextResponse.json(buildProgressPayload(data, progressDate, body.mealPlanKey));
}
