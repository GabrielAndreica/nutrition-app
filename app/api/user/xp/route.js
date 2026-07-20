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
import { getCurrentPlanDateKey } from '@/app/lib/weeklyPlanRegeneration';
import {
  APP_COIN_REWARDS,
  awardAppCoins,
  getCoinRewardForXpEvent,
  getCoinRewardReason,
} from '@/app/lib/appCurrency';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const MAX_XP_BODY_BYTES = 8 * 1024;
const WATER_XP_AMOUNT = 20;
const PROGRESS_UPDATE_XP_AMOUNT = 50;
const SUBSCRIPTION_UPGRADE_XP_AMOUNT = 50;
const ALLOWED_XP_TYPES = ['meals', 'workout', 'day', 'water', 'exercise', 'progress_update', 'onboarding', 'subscription_upgrade'];

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

async function readXpBody(request) {
  const bodyText = await request.text();
  if (bodyText.length > MAX_XP_BODY_BYTES) {
    return { tooLarge: true, body: {} };
  }

  return { tooLarge: false, body: bodyText ? JSON.parse(bodyText) : {} };
}

function isMissingWaterRewardColumnError(error) {
  return error?.code === '42703' ||
    /water_goal_awarded|water_goal_awarded_at/i.test(String(error?.message || ''));
}

function isMissingWeeklyCheckInXpColumnError(error) {
  return error?.code === '42703' ||
    /xp_awarded|xp_awarded_at|xp_awarded_amount/i.test(String(error?.message || ''));
}

function isMissingXpLedgerError(error) {
  return error?.code === '42P01' ||
    /user_xp_ledger/i.test(String(error?.message || ''));
}

export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-xp-post',
    maxRequests: 20,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rl) return rl;

  if (requestBodyTooLarge(request, MAX_XP_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let amount = 50;
  let type = null;
  let dayIndex = null;
  try {
    const parsedBody = await readXpBody(request);
    if (parsedBody.tooLarge) {
      return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
    }
    const body = parsedBody.body;
    const parsed = Number(body?.amount);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) amount = parsed;
    if (ALLOWED_XP_TYPES.includes(body?.type)) {
      type = body.type;
    }
    const parsedDayIndex = Number(body?.dayIndex);
    if (Number.isInteger(parsedDayIndex) && parsedDayIndex >= 0 && parsedDayIndex <= 6) {
      dayIndex = parsedDayIndex;
    }
  } catch {}

  if (type === 'water') {
    amount = WATER_XP_AMOUNT;
  }
  if (type === 'progress_update') {
    amount = PROGRESS_UPDATE_XP_AMOUNT;
  }
  if (type === 'subscription_upgrade') {
    amount = SUBSCRIPTION_UPGRADE_XP_AMOUNT;
  }

  const completionType = type === 'meals' || type === 'workout' ? type : null;
  const supabase = getSupabase();

  const { data: clientRow, error: fetchError } = await supabase
    .from('users')
    .select(`
      xp,
      level,
      app_coins,
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
      last_weekly_checkin_at,
      hydration_target_ml,
      account_type,
      subscription_status,
      subscription_id
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
  const completionDayStatusKey = String(dailyState.currentPlanDay);

  if (completionType === 'meals' && dailyState.mealStatus?.[completionDayStatusKey] === true) {
    return NextResponse.json({ error: 'Ziua de mese a fost deja finalizată.' }, { status: 409 });
  }
  if (completionType === 'workout' && dailyState.workoutStatus?.[completionDayStatusKey] === true) {
    return NextResponse.json({ error: 'Antrenamentul a fost deja finalizat.' }, { status: 409 });
  }
  if (completionType === 'meals' && dailyState.currentPlanDay >= 7) {
    return NextResponse.json({ error: 'Cele 7 zile de mese sunt deja finalizate.' }, { status: 409 });
  }
  if (completionType === 'workout' && dailyState.currentPlanDay >= 7) {
    return NextResponse.json({ error: 'Cele 7 zile de antrenament sunt deja finalizate.' }, { status: 409 });
  }
  if (completionType === 'meals' && dayIndex !== null && dayIndex !== dailyState.currentPlanDay) {
    return NextResponse.json({ error: 'Această zi nu este disponibilă încă.' }, { status: 409 });
  }
  if (completionType === 'workout' && dayIndex !== null && dayIndex !== dailyState.currentPlanDay) {
    return NextResponse.json({ error: 'Această zi nu este disponibilă încă.' }, { status: 409 });
  }

  const progressDate = getCurrentPlanDateKey(now);
  let dayProgress = null;
  let waterProgress = null;
  let progressCheckIn = null;
  if (type === 'water') {
    const { data: progressRow, error: progressError } = await supabase
      .from('daily_user_progress')
      .select('id, water_ml, water_goal_awarded, water_goal_awarded_at')
      .eq('user_id', auth.userId)
      .eq('progress_date', progressDate)
      .maybeSingle();

    if (progressError) {
      console.error('[user/xp] water progress read error:', progressError);
      if (isMissingWaterRewardColumnError(progressError)) {
        return NextResponse.json({ error: 'Rulează scriptul add-daily-user-progress.sql pentru recompensa de apă.' }, { status: 500 });
      }
      return NextResponse.json({ error: 'Nu am putut verifică progresul de apă.' }, { status: 500 });
    }

    const hydrationTargetMl = Math.max(0, Number(clientRow.hydration_target_ml) || 0);
    if (!hydrationTargetMl || Math.max(0, Number(progressRow?.water_ml) || 0) < hydrationTargetMl) {
      return NextResponse.json({ error: 'Mai întâi atinge targetul de apă.' }, { status: 409 });
    }
    if (progressRow?.water_goal_awarded === true) {
      return NextResponse.json({ error: 'Recompensa pentru apă a fost deja acordată azi.' }, { status: 409 });
    }

    const { data: markedWater, error: markWaterError } = await supabase
      .from('daily_user_progress')
      .update({
        water_goal_awarded: true,
        water_goal_awarded_at: now.toISOString(),
      })
      .eq('user_id', auth.userId)
      .eq('progress_date', progressDate)
      .eq('water_goal_awarded', false)
      .select('water_goal_awarded, water_goal_awarded_at')
      .maybeSingle();

    if (markWaterError) {
      console.error('[user/xp] water reward mark error:', markWaterError);
      if (isMissingWaterRewardColumnError(markWaterError)) {
        return NextResponse.json({ error: 'Rulează scriptul add-daily-user-progress.sql pentru recompensa de apă.' }, { status: 500 });
      }
      return NextResponse.json({ error: 'Nu am putut acorda recompensa pentru apă.' }, { status: 500 });
    }
    if (!markedWater) {
      return NextResponse.json({ error: 'Recompensa pentru apă a fost deja acordată azi.' }, { status: 409 });
    }

    waterProgress = markedWater;
  }

  if (type === 'day') {
    const effectiveDayIndex = dailyState.currentPlanDay;
    if (dayIndex !== null && dayIndex !== effectiveDayIndex) {
      return NextResponse.json({ error: 'Poți finaliza doar ziua curentă.' }, { status: 409 });
    }
    if (dailyState.mealStatus[String(effectiveDayIndex)] !== true) {
      return NextResponse.json({ error: 'Mai întâi finalizează mesele zilei.' }, { status: 409 });
    }
    if (dailyState.workoutStatus[String(effectiveDayIndex)] !== true) {
      return NextResponse.json({ error: 'Mai întâi finalizează antrenamentul zilei.' }, { status: 409 });
    }

    const { data: progressRow, error: progressError } = await supabase
      .from('daily_user_progress')
      .select('id, water_ml, day_finalized, day_finalized_plan_day')
      .eq('user_id', auth.userId)
      .eq('progress_date', progressDate)
      .maybeSingle();

    if (progressError) {
      console.error('[user/xp] daily progress read error:', progressError);
      return NextResponse.json({ error: 'Nu am putut verifică progresul zilei.' }, { status: 500 });
    }

    const hydrationTargetMl = Math.max(0, Number(clientRow.hydration_target_ml) || 0);
    if (!hydrationTargetMl || Math.max(0, Number(progressRow?.water_ml) || 0) < hydrationTargetMl) {
      return NextResponse.json({ error: 'Mai întâi atinge targetul de apă.' }, { status: 409 });
    }
    if (progressRow?.day_finalized === true) {
      return NextResponse.json({ error: 'Ziua este deja finalizată.' }, { status: 409 });
    }

    const { data: markedDay, error: markDayError } = await supabase
      .from('daily_user_progress')
      .update({
        day_finalized: true,
        day_finalized_plan_day: effectiveDayIndex,
        day_finalized_at: now.toISOString(),
      })
      .eq('user_id', auth.userId)
      .eq('progress_date', progressDate)
      .eq('day_finalized', false)
      .select('day_finalized, day_finalized_plan_day, day_finalized_at')
      .maybeSingle();

    if (markDayError) {
      console.error('[user/xp] daily progress finalize error:', markDayError);
      return NextResponse.json({ error: 'Nu am putut finaliza ziua.' }, { status: 500 });
    }
    if (!markedDay) {
      return NextResponse.json({ error: 'Ziua este deja finalizată.' }, { status: 409 });
    }

    dayProgress = markedDay;
  }

  if (type === 'progress_update') {
    const { data: markedCheckIn, error: markCheckInError } = await supabase
      .from('weekly_checkins')
      .update({
        xp_awarded: true,
        xp_awarded_at: now.toISOString(),
        xp_awarded_amount: amount,
      })
      .eq('user_id', auth.userId)
      .eq('week_key', progressDate)
      .eq('xp_awarded', false)
      .select('id, xp_awarded, xp_awarded_at, xp_awarded_amount')
      .maybeSingle();

    if (markCheckInError) {
      console.error('[user/xp] weekly check-in XP mark error:', markCheckInError);
      if (isMissingWeeklyCheckInXpColumnError(markCheckInError)) {
        return NextResponse.json({ error: 'Rulează scriptul add-weekly-checkins.sql pentru recompensa de check-in.' }, { status: 500 });
      }
      return NextResponse.json({ error: 'Nu am putut acorda XP pentru check-in.' }, { status: 500 });
    }

    if (!markedCheckIn) {
      const { data: existingCheckIn, error: existingCheckInError } = await supabase
        .from('weekly_checkins')
        .select('id, xp_awarded')
        .eq('user_id', auth.userId)
        .eq('week_key', progressDate)
        .maybeSingle();

      if (existingCheckInError) {
        console.error('[user/xp] weekly check-in read error:', existingCheckInError);
        if (isMissingWeeklyCheckInXpColumnError(existingCheckInError)) {
          return NextResponse.json({ error: 'Rulează scriptul add-weekly-checkins.sql pentru recompensa de check-in.' }, { status: 500 });
        }
        return NextResponse.json({ error: 'Nu am putut verifică recompensa de check-in.' }, { status: 500 });
      }

      if (!existingCheckIn) {
        return NextResponse.json({ error: 'Trimite mai întâi check-in-ul săptămânal.' }, { status: 409 });
      }

      return NextResponse.json({ error: 'Recompensa pentru check-in a fost deja acordată.' }, { status: 409 });
    }

    progressCheckIn = markedCheckIn;
  }

  let subscriptionRewardLedger = null;
  if (type === 'subscription_upgrade') {
    const isActiveCoach = clientRow.account_type === 'paid' || clientRow.subscription_status === 'active';
    if (!isActiveCoach) {
      return NextResponse.json({ error: 'Abonamentul Coach nu este activ.' }, { status: 409 });
    }

    const sourceKey = `coach:${clientRow.subscription_id || auth.userId}`;
    const { data: ledgerRow, error: ledgerError } = await supabase
      .from('user_xp_ledger')
      .insert({
        user_id: auth.userId,
        amount,
        reason: 'Upgrade Trevano Coach',
        source_type: 'subscription_upgrade',
        source_key: sourceKey,
        metadata: {
          subscriptionId: clientRow.subscription_id || null,
        },
      })
      .select('id')
      .maybeSingle();

    if (ledgerError) {
      if (isMissingXpLedgerError(ledgerError)) {
        return NextResponse.json({ error: 'Rulează scriptul add-subscription-xp-rewards.sql pentru recompensa Coach.' }, { status: 500 });
      }
      if (ledgerError.code === '23505') {
        return NextResponse.json({ error: 'Recompensa pentru Coach a fost deja acordată.' }, { status: 409 });
      }
      console.error('[user/xp] subscription reward ledger error:', ledgerError);
      return NextResponse.json({ error: 'Nu am putut acorda recompensa Coach.' }, { status: 500 });
    }

    if (!ledgerRow) {
      return NextResponse.json({ error: 'Recompensa pentru Coach a fost deja acordată.' }, { status: 409 });
    }
    subscriptionRewardLedger = ledgerRow;
  }

  const newXp = (clientRow.xp || 0) + amount;
  const info = getLevelInfo(newXp);
  const leveledUp = info.level > (Number(clientRow.level) || 1);

  const completionDay = dailyState.currentPlanDay;
  if (completionType) {
    dailyState = applyDayCompletion(dailyState, completionType, completionDay);
  }
  const progressUpdate = completionType ? buildDailyProgressUpdate(dailyState) : {};
  const updatePayload = { xp: newXp, level: info.level, ...progressUpdate };
  const nextMealsDays = completionType ? progressUpdate.meals_completed_days : Math.max(0, Math.min(7, Number(clientRow.meals_completed_days) || 0));
  const nextWorkoutDays = completionType ? progressUpdate.workout_completed_days : Math.max(0, Math.min(7, Number(clientRow.workout_completed_days) || 0));

  if (completionType === 'meals') {
    updatePayload.meals_cooldown_until = midnightIso;
  }
  if (completionType === 'workout') {
    updatePayload.workout_cooldown_until = midnightIso;
  }
  if (completionType && !clientRow.weekly_plan_due_at && nextMealsDays >= 7 && nextWorkoutDays >= 7) {
    updatePayload.weekly_plan_due_at = midnightIso;
  }

  let updateQuery = supabase
    .from('users')
    .update(updatePayload)
    .eq('id', auth.userId);

  const { data: updatedUser, error: updateError } = await updateQuery
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[user/xp] update error:', updateError);
    if (type === 'day') {
      await supabase
        .from('daily_user_progress')
        .update({ day_finalized: false, day_finalized_plan_day: null, day_finalized_at: null })
        .eq('user_id', auth.userId)
        .eq('progress_date', progressDate);
    }
    if (type === 'water') {
      await supabase
        .from('daily_user_progress')
        .update({ water_goal_awarded: false, water_goal_awarded_at: null })
        .eq('user_id', auth.userId)
        .eq('progress_date', progressDate);
    }
    if (type === 'progress_update') {
      await supabase
        .from('weekly_checkins')
        .update({ xp_awarded: false, xp_awarded_at: null, xp_awarded_amount: 0 })
        .eq('user_id', auth.userId)
        .eq('week_key', progressDate);
    }
    if (type === 'subscription_upgrade' && subscriptionRewardLedger?.id) {
      await supabase
        .from('user_xp_ledger')
        .delete()
        .eq('id', subscriptionRewardLedger.id)
        .eq('user_id', auth.userId);
    }
    return NextResponse.json({ error: 'Eroare la actualizarea XP.' }, { status: 500 });
  }
  if (!updatedUser) {
    if (type === 'day') {
      await supabase
        .from('daily_user_progress')
        .update({ day_finalized: false, day_finalized_plan_day: null, day_finalized_at: null })
        .eq('user_id', auth.userId)
        .eq('progress_date', progressDate);
    }
    if (type === 'water') {
      await supabase
        .from('daily_user_progress')
        .update({ water_goal_awarded: false, water_goal_awarded_at: null })
        .eq('user_id', auth.userId)
        .eq('progress_date', progressDate);
    }
    if (type === 'progress_update') {
      await supabase
        .from('weekly_checkins')
        .update({ xp_awarded: false, xp_awarded_at: null, xp_awarded_amount: 0 })
        .eq('user_id', auth.userId)
        .eq('week_key', progressDate);
    }
    if (type === 'subscription_upgrade' && subscriptionRewardLedger?.id) {
      await supabase
        .from('user_xp_ledger')
        .delete()
        .eq('id', subscriptionRewardLedger.id)
        .eq('user_id', auth.userId);
    }
    return NextResponse.json(
      {
        error: completionType === 'meals'
          ? 'Ziua de mese a fost deja finalizată.'
          : completionType === 'workout'
            ? 'Antrenamentul a fost deja finalizat.'
            : 'Nu am putut acorda XP.',
      },
      { status: 409 }
    );
  }

  const coinAwards = [];
  let appCoins = Math.max(0, Number(clientRow.app_coins) || 0);
  const baseCoins = getCoinRewardForXpEvent(type);
  if (baseCoins > 0) {
    const sourceKey = completionType
      ? `${completionType}:${completionDay}:${midnightIso || getCurrentPlanDateKey(now)}`
      : type === 'onboarding'
        ? `onboarding:${auth.userId}`
        : type === 'progress_update'
          ? `progress_update:${progressDate}`
          : null;

    const award = await awardAppCoins({
      supabase,
      userId: auth.userId,
      amount: baseCoins,
      reason: getCoinRewardReason(type),
      sourceType: type || 'xp',
      sourceKey,
      metadata: {
        xpAmount: amount,
        dayIndex: completionType ? completionDay : null,
      },
    });
    if (award.amountAwarded > 0) coinAwards.push({ type, amount: award.amountAwarded });
    if (award.balance !== null) appCoins = award.balance;
  }

  if (leveledUp) {
    const award = await awardAppCoins({
      supabase,
      userId: auth.userId,
      amount: APP_COIN_REWARDS.level_up,
      reason: getCoinRewardReason('level_up'),
      sourceType: 'level_up',
      sourceKey: `level:${info.level}`,
      metadata: {
        level: info.level,
        previousLevel: Number(clientRow.level) || 1,
      },
    });
    if (award.amountAwarded > 0) coinAwards.push({ type: 'level_up', amount: award.amountAwarded });
    if (award.balance !== null) appCoins = award.balance;
  }

  const coinsAwarded = coinAwards.reduce((sum, award) => sum + award.amount, 0);

  await logActivity({
    action: 'user.xp_awarded',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      type: type || 'manual',
      amount,
      previousLevel: Number(clientRow.level) || 1,
      nextLevel: info.level,
      leveledUp,
      coinsAwarded,
      dayIndex: completionType ? completionDay : dayIndex,
      progressDate,
    },
  });

  return NextResponse.json({
    ...info,
    xpAdded: amount,
    appCoins,
    coinsAwarded,
    coinAwards,
    mealsCooldownUntil: completionType === 'meals' ? midnightIso : (clientRow.meals_cooldown_until || null),
    workoutCooldownUntil: completionType === 'workout' ? midnightIso : (clientRow.workout_cooldown_until || null),
    mealsCompletedDays: nextMealsDays,
    workoutCompletedDays: nextWorkoutDays,
    ...getDayStatusPayload(dailyState),
    weeklyPlanDueAt: updatePayload.weekly_plan_due_at || clientRow.weekly_plan_due_at || null,
    dayFinalized: type === 'day' ? dayProgress?.day_finalized === true : undefined,
    dayFinalizedPlanDay: type === 'day' ? dayProgress?.day_finalized_plan_day : undefined,
    dayFinalizedAt: type === 'day' ? (dayProgress?.day_finalized_at || null) : undefined,
    waterRewardAwarded: type === 'water' ? waterProgress?.water_goal_awarded === true : undefined,
    waterRewardAwardedAt: type === 'water' ? (waterProgress?.water_goal_awarded_at || null) : undefined,
    progressRewardAwarded: type === 'progress_update' ? progressCheckIn?.xp_awarded === true : undefined,
    progressRewardAwardedAt: type === 'progress_update' ? (progressCheckIn?.xp_awarded_at || null) : undefined,
    subscriptionRewardAwarded: type === 'subscription_upgrade' ? !!subscriptionRewardLedger : undefined,
  });
}
