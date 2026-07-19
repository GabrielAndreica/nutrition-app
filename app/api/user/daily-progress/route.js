import { NextResponse } from 'next/server';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { getCurrentPlanDateKey } from '@/app/lib/weeklyPlanRegeneration';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MAX_DAILY_PROGRESS_PAYLOAD_BYTES = 16 * 1024;

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

async function readDailyProgressBody(request) {
  const bodyText = await request.text();
  if (bodyText.length > MAX_DAILY_PROGRESS_PAYLOAD_BYTES) {
    return { tooLarge: true, body: {} };
  }

  return { tooLarge: false, body: bodyText ? JSON.parse(bodyText) : {} };
}

function normalizePlanKey(value) {
  return String(value || 'default')
    .trim()
    .replace(/[^\w:.-]/g, '-')
    .slice(0, 120) || 'default';
}

function isMissingWaterRewardColumnError(error) {
  return error?.code === '42703' ||
    /water_goal_awarded|water_goal_awarded_at/i.test(String(error?.message || ''));
}

function isMissingWaterUpsertFunctionError(error) {
  return error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    /upsert_daily_water_progress/i.test(String(error?.message || ''));
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

function normalizePlanDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null;
}

function buildProgressPayload(row, progressDate, mealPlanKey = null, planDay = null) {
  const allMealChecks = row?.meal_checks && typeof row.meal_checks === 'object'
    ? row.meal_checks
    : {};
  const key = mealPlanKey ? normalizePlanKey(mealPlanKey) : null;
  const requestedPlanDay = normalizePlanDay(planDay);
  const finalizedPlanDay = normalizePlanDay(row?.day_finalized_plan_day);
  const dayFinalized = row?.day_finalized === true
    && (requestedPlanDay === null || finalizedPlanDay === null || finalizedPlanDay === requestedPlanDay);

  return {
    progressDate,
    waterMl: Math.max(0, Number(row?.water_ml) || 0),
    waterGoalAwarded: row?.water_goal_awarded === true,
    waterGoalAwardedAt: row?.water_goal_awarded_at || null,
    dayFinalized,
    dayFinalizedPlanDay: finalizedPlanDay,
    dayFinalizedAt: row?.day_finalized_at || null,
    mealChecks: key ? (allMealChecks[key] || {}) : allMealChecks,
  };
}

async function readDailyProgress(supabase, userId, progressDate) {
  const result = await supabaseQuery(() => supabase
    .from('daily_user_progress')
    .select('meal_checks, water_ml, water_goal_awarded, water_goal_awarded_at, day_finalized, day_finalized_plan_day, day_finalized_at')
    .eq('user_id', userId)
    .eq('progress_date', progressDate)
    .maybeSingle());

  if (!isMissingWaterRewardColumnError(result.error)) return result;

  return supabaseQuery(() => supabase
    .from('daily_user_progress')
    .select('meal_checks, water_ml, day_finalized, day_finalized_plan_day, day_finalized_at')
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
    failClosed: true,
  });
  if (rl) return rl;

  const progressDate = getCurrentPlanDateKey(new Date());
  const searchParams = new URL(request.url).searchParams;
  const mealPlanKey = searchParams.get('mealPlanKey');
  const planDay = searchParams.get('planDay');
  const supabase = getSupabase();
  const { data, error } = await readDailyProgress(supabase, userId, progressDate);

  if (error) {
    console.error('[user/daily-progress] GET DB error:', error);
    return NextResponse.json({ error: 'Nu am putut citi progresul zilnic.' }, { status: 500 });
  }

  return NextResponse.json(buildProgressPayload(data, progressDate, mealPlanKey, planDay));
}

export async function PATCH(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = getNumericUserId(auth);
  if (!userId) return NextResponse.json({ error: 'Utilizator invalid.' }, { status: 401 });

  const rl = await enforceRateLimit(request, {
    userId,
    endpoint: 'user-daily-progress-patch',
    maxRequests: 180,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rl) return rl;

  if (requestBodyTooLarge(request, MAX_DAILY_PROGRESS_PAYLOAD_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body = {};
  try {
    const parsedBody = await readDailyProgressBody(request);
    if (parsedBody.tooLarge) {
      return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
    }
    body = parsedBody.body;
  } catch {
    body = {};
  }

  const progressDate = getCurrentPlanDateKey(new Date());
  const supabase = getSupabase();
  const hasWaterUpdate = Object.prototype.hasOwnProperty.call(body, 'waterMl');
  const hasMealUpdate = Object.prototype.hasOwnProperty.call(body, 'mealChecks');
  const requestedWaterMl = hasWaterUpdate
    ? Math.max(0, Math.min(10000, Math.round(Number(body.waterMl) || 0)))
    : null;

  if (hasWaterUpdate && !hasMealUpdate) {
    const rpcResult = await supabaseQuery(() => supabase.rpc('upsert_daily_water_progress', {
      p_user_id: userId,
      p_progress_date: progressDate,
      p_water_ml: requestedWaterMl,
    }));

    if (!rpcResult.error) {
      const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
      return NextResponse.json(buildProgressPayload(row, progressDate, body.mealPlanKey, body.planDay));
    }

    if (!isMissingWaterUpsertFunctionError(rpcResult.error)) {
      console.error('[user/daily-progress] water RPC DB error:', rpcResult.error);
      return NextResponse.json({ error: 'Nu am putut salva progresul de apă.' }, { status: 500 });
    }
  }

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
    water_goal_awarded: existing?.water_goal_awarded === true,
    water_goal_awarded_at: existing?.water_goal_awarded_at || null,
    day_finalized: existing?.day_finalized === true,
    day_finalized_plan_day: normalizePlanDay(existing?.day_finalized_plan_day),
    day_finalized_at: existing?.day_finalized_at || null,
  };

  if (hasWaterUpdate) {
    payload.water_ml = Math.max(payload.water_ml, requestedWaterMl);
  }

  if (hasMealUpdate) {
    const planKey = normalizePlanKey(body.mealPlanKey);
    payload.meal_checks = {
      ...mealChecks,
      [planKey]: sanitizeMealChecks(body.mealChecks),
    };
  }

  let { data, error } = await supabaseQuery(() => supabase
    .from('daily_user_progress')
    .upsert(payload, { onConflict: 'user_id,progress_date' })
    .select('meal_checks, water_ml, water_goal_awarded, water_goal_awarded_at, day_finalized, day_finalized_plan_day, day_finalized_at')
    .maybeSingle());

  if (isMissingWaterRewardColumnError(error)) {
    const legacyPayload = { ...payload };
    delete legacyPayload.water_goal_awarded;
    delete legacyPayload.water_goal_awarded_at;

    const legacyResult = await supabaseQuery(() => supabase
      .from('daily_user_progress')
      .upsert(legacyPayload, { onConflict: 'user_id,progress_date' })
      .select('meal_checks, water_ml, day_finalized, day_finalized_plan_day, day_finalized_at')
      .maybeSingle());

    data = legacyResult.data;
    error = legacyResult.error;
  }

  if (error) {
    console.error('[user/daily-progress] PATCH DB error:', error);
    return NextResponse.json({ error: 'Nu am putut salva progresul zilnic.' }, { status: 500 });
  }

  if (hasWaterUpdate || hasMealUpdate) {
    await logActivity({
      action: 'daily_progress.updated',
      status: 'success',
      userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: {
        progressDate,
        updatedWater: hasWaterUpdate,
        updatedMeals: hasMealUpdate,
        waterMl: hasWaterUpdate ? Math.max(0, Number(data?.water_ml) || requestedWaterMl || 0) : undefined,
        mealPlanKey: hasMealUpdate ? normalizePlanKey(body.mealPlanKey) : undefined,
        planDay: normalizePlanDay(body.planDay),
      },
    });
  }

  return NextResponse.json(buildProgressPayload(data, progressDate, body.mealPlanKey, body.planDay));
}
