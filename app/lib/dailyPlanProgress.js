import { getCurrentPlanDayIndex, getNextPlanMidnightIso } from '@/app/lib/weeklyPlanRegeneration';

function clampDay(value) {
  return Math.max(0, Math.min(7, Number(value) || 0));
}

function normalizeStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (let i = 0; i < 7; i += 1) {
    if (value[String(i)] === true || value[i] === true) result[String(i)] = true;
  }
  return result;
}

function countDone(status) {
  return Object.values(normalizeStatus(status)).filter(Boolean).length;
}

function parseValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function evaluateFinishedDay(state, dayIndex) {
  const mealDone = state.mealStatus[String(dayIndex)] === true;
  const workoutDone = state.workoutStatus[String(dayIndex)] === true;
  const didAnything = mealDone || workoutDone;
  const didEverything = mealDone && workoutDone;

  if (didEverything) {
    if (state.streakAwardedDay !== dayIndex) {
      state.streakCount += 1;
      state.streakAwardedDay = dayIndex;
    }
    state.streakState = 'normal';
    state.streakRecoveryDay = false;
    return;
  }

  if (didAnything) {
    if (!state.streakRecoveryDay && state.streakAwardedDay !== dayIndex) {
      state.streakCount += 1;
      state.streakAwardedDay = dayIndex;
    }
    state.streakState = 'normal';
    state.streakRecoveryDay = false;
    return;
  }

  if (state.streakState === 'warning' || state.streakRecoveryDay) {
    state.streakCount = 0;
    state.streakState = 'normal';
    state.streakRecoveryDay = false;
    return;
  }

  state.streakState = 'warning';
  state.streakRecoveryDay = true;
}

function resetWeeklyProgress(state, calendarPlanDay, now) {
  state.currentPlanDay = calendarPlanDay;
  state.currentPlanDayDueAt = getNextPlanMidnightIso(now);
  state.mealStatus = {};
  state.workoutStatus = {};
  state.streakAwardedDay = -1;
  state.weeklyPlanDueAt = null;
  state.changed = true;
}

export function reconcileDailyPlanProgress(clientRow, now = new Date()) {
  const calendarPlanDay = getCurrentPlanDayIndex(now);
  const state = {
    currentPlanDay: clampDay(clientRow?.current_plan_day),
    currentPlanDayDueAt: clientRow?.current_plan_day_due_at || null,
    mealStatus: normalizeStatus(clientRow?.meal_day_status),
    workoutStatus: normalizeStatus(clientRow?.workout_day_status),
    streakCount: Math.max(0, Number(clientRow?.streak_count) || 0),
    streakState: clientRow?.streak_state === 'warning' ? 'warning' : 'normal',
    streakRecoveryDay: clientRow?.streak_recovery_day === true,
    streakAwardedDay: Number.isInteger(Number(clientRow?.streak_awarded_day))
      ? Number(clientRow.streak_awarded_day)
      : -1,
    weeklyPlanDueAt: clientRow?.weekly_plan_due_at || null,
    changed: false,
  };

  const crossedIntoNewWeek = state.currentPlanDay >= 7 || state.currentPlanDay > calendarPlanDay;

  if (crossedIntoNewWeek) {
    resetWeeklyProgress(state, calendarPlanDay, now);
  } else if (state.currentPlanDay < 7 && state.currentPlanDay !== calendarPlanDay) {
    state.currentPlanDay = calendarPlanDay;
    state.currentPlanDayDueAt = getNextPlanMidnightIso(now);
    state.changed = true;
  }

  const currentDueAt = parseValidDate(state.currentPlanDayDueAt);
  const staleCurrentDayDueAt = state.currentPlanDay < 7
    && state.currentPlanDay === calendarPlanDay
    && currentDueAt
    && currentDueAt <= now;

  if (staleCurrentDayDueAt && calendarPlanDay === 0) {
    resetWeeklyProgress(state, calendarPlanDay, now);
  } else if (state.currentPlanDay < 7 && state.currentPlanDay === calendarPlanDay && (!currentDueAt || currentDueAt <= now)) {
    state.currentPlanDayDueAt = getNextPlanMidnightIso(now);
    state.changed = true;
  }

  const weeklyDueAt = parseValidDate(state.weeklyPlanDueAt);
  if (calendarPlanDay !== 6 && weeklyDueAt && weeklyDueAt <= now) {
    state.weeklyPlanDueAt = null;
    state.changed = true;
  }

  if (!state.currentPlanDayDueAt && state.currentPlanDay < 7) {
    state.currentPlanDayDueAt = getNextPlanMidnightIso(now);
    state.changed = true;
  }

  let guard = 0;
  while (
    state.currentPlanDay < 7 &&
    state.currentPlanDayDueAt &&
    new Date(state.currentPlanDayDueAt) <= now &&
    guard < 8
  ) {
    const dueAt = new Date(state.currentPlanDayDueAt);
    evaluateFinishedDay(state, state.currentPlanDay);
    state.currentPlanDay += 1;
    state.changed = true;

    if (state.currentPlanDay >= 7) {
      state.currentPlanDayDueAt = null;
      if (!state.weeklyPlanDueAt) {
        state.weeklyPlanDueAt = dueAt.toISOString();
      }
      break;
    }

    state.currentPlanDayDueAt = getNextPlanMidnightIso(new Date(dueAt.getTime() + 1000));
    guard += 1;
  }

  return state;
}

export function buildDailyProgressUpdate(state) {
  return {
    current_plan_day: state.currentPlanDay,
    current_plan_day_due_at: state.currentPlanDayDueAt,
    meal_day_status: state.mealStatus,
    workout_day_status: state.workoutStatus,
    meals_completed_days: countDone(state.mealStatus),
    workout_completed_days: countDone(state.workoutStatus),
    streak_count: state.streakCount,
    streak_state: state.streakState,
    streak_recovery_day: state.streakRecoveryDay,
    streak_awarded_day: state.streakAwardedDay,
    weekly_plan_due_at: state.weeklyPlanDueAt,
  };
}

export function applyDayCompletion(state, type, dayIndex) {
  const key = String(dayIndex);
  const hadAnything = state.mealStatus[key] === true || state.workoutStatus[key] === true;

  if (type === 'meals') state.mealStatus[key] = true;
  if (type === 'workout') state.workoutStatus[key] = true;

  const hasMeal = state.mealStatus[key] === true;
  const hasWorkout = state.workoutStatus[key] === true;
  const hasEverything = hasMeal && hasWorkout;

  if (state.streakRecoveryDay) {
    state.streakState = 'normal';
    if (hasEverything && state.streakAwardedDay !== dayIndex) {
      state.streakCount += 1;
      state.streakAwardedDay = dayIndex;
    }
    return state;
  }

  if (!hadAnything && state.streakAwardedDay !== dayIndex) {
    state.streakCount += 1;
    state.streakAwardedDay = dayIndex;
  }
  state.streakState = 'normal';
  return state;
}

export function getDayStatusPayload(state) {
  return {
    currentPlanDay: state.currentPlanDay,
    currentPlanDayDueAt: state.currentPlanDayDueAt,
    mealDayStatus: state.mealStatus,
    workoutDayStatus: state.workoutStatus,
    streakCount: state.streakCount,
    streakState: state.streakState,
  };
}
