import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { resolveUserOnboardingCompletion } from '@/app/lib/onboardingStatus';
import { calculateHydrationTargetMl } from '@/app/lib/hydrationTarget';
import {
  claimAutomaticMealPlanGenerationLock,
  calculateMacros,
  calculateTargetCalories,
  createAutomaticMealPlanForUser,
  releaseAutomaticMealPlanGenerationLock,
} from '@/app/lib/automaticMealPlan';
import { getLevelInfo } from '@/app/api/user/level/route';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import {
  APP_COIN_REWARDS,
  awardAppCoins,
  getCoinRewardReason,
} from '@/app/lib/appCurrency';
import { getCurrentPlanDayIndex, getNextPlanMidnightIso } from '@/app/lib/weeklyPlanRegeneration';

// Allowed enum values
const ALLOWED_FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced'];
const ALLOWED_TRAINING_LOCATIONS = ['gym', 'home_dumbbells', 'home'];
const ALLOWED_DIET_TYPES = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'paleo'];
const ALLOWED_GENDERS = ['M', 'F'];
const ALLOWED_WORKOUTS_PER_WEEK = [2, 3, 4, 5];
const ONBOARDING_XP_REWARD = 50;
const USERNAME_PATTERN = /^[\p{L}\p{N} .-]+$/u;
const MAX_ONBOARDING_BODY_BYTES = 32 * 1024;

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function findExistingUsernameOwner(supabase, username, userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .ilike('name', username)
    .eq('onboarding_completed', true)
    .neq('id', userId)
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

function deriveGoalFromTargetWeight(currentWeight, targetWeight) {
  const diffKg = Number(targetWeight) - Number(currentWeight);
  if (!Number.isFinite(diffKg)) return 'maintenance';
  if (diffKg <= -1) return 'weight_loss';
  if (diffKg >= 1) return 'muscle_gain';
  return 'maintenance';
}

async function awardOnboardingReward({ supabase, userId, previousUserRow }) {
  if (!previousUserRow || previousUserRow.onboarding_completed === true) return null;

  const previousXp = Math.max(0, Number(previousUserRow.xp) || 0);
  const previousLevel = Math.max(1, Number(previousUserRow.level) || 1);
  const nextXp = previousXp + ONBOARDING_XP_REWARD;
  const levelInfo = getLevelInfo(nextXp);
  const leveledUp = levelInfo.level > previousLevel;

  const { error: xpUpdateError } = await supabase
    .from('users')
    .update({ xp: nextXp, level: levelInfo.level })
    .eq('id', userId);

  if (xpUpdateError) {
    console.error('[onboarding] reward XP error:', xpUpdateError);
    return null;
  }

  const coinAwards = [];
  let appCoins = Math.max(0, Number(previousUserRow.app_coins) || 0);
  const onboardingCoins = await awardAppCoins({
    supabase,
    userId,
    amount: APP_COIN_REWARDS.onboarding,
    reason: getCoinRewardReason('onboarding'),
    sourceType: 'onboarding',
    sourceKey: `onboarding:${userId}`,
    metadata: {
      xpAmount: ONBOARDING_XP_REWARD,
    },
  });
  if (onboardingCoins.amountAwarded > 0) coinAwards.push({ type: 'onboarding', amount: onboardingCoins.amountAwarded });
  if (onboardingCoins.balance !== null) appCoins = onboardingCoins.balance;

  if (leveledUp) {
    const levelCoins = await awardAppCoins({
      supabase,
      userId,
      amount: APP_COIN_REWARDS.level_up,
      reason: getCoinRewardReason('level_up'),
      sourceType: 'level_up',
      sourceKey: `level:${levelInfo.level}`,
      metadata: {
        level: levelInfo.level,
        previousLevel,
      },
    });
    if (levelCoins.amountAwarded > 0) coinAwards.push({ type: 'level_up', amount: levelCoins.amountAwarded });
    if (levelCoins.balance !== null) appCoins = levelCoins.balance;
  }

  const coinsAwarded = coinAwards.reduce((sum, award) => sum + award.amount, 0);
  const payload = {
    ...levelInfo,
    xpAdded: ONBOARDING_XP_REWARD,
    appCoins,
    coinsAwarded,
    coinAwards,
  };

  if (leveledUp) {
    return {
      type: 'levelUp',
      fromLevel: previousLevel,
      toLevel: levelInfo.level,
      levelInfo: payload,
    };
  }

  return {
    type: 'xp',
    levelInfo: payload,
  };
}

export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  // Rate limit: max 10 onboarding submissions per user per hour
  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-onboarding',
    maxRequests: 10,
    windowMinutes: 60,
    failClosed: true,
  });
  if (rl) return rl;

  if (requestBodyTooLarge(request, MAX_ONBOARDING_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const {
    name,
    age, height, weight, gender,
    fitnessLevel, workoutsPerWeek, trainingLocation,
    targetWeight, desiredWeight, dietType, allergies, foodPreferences,
  } = body;
  const targetWeightValue = targetWeight ?? desiredWeight;

  // Validare câmpuri obligatorii
  const missingFields = [];
  if (!age) missingFields.push('vârstă');
  if (!height) missingFields.push('înălțime');
  if (!weight) missingFields.push('greutate');
  if (!gender) missingFields.push('gen');
  if (!fitnessLevel) missingFields.push('nivel fitness');
  if (!workoutsPerWeek) missingFields.push('antrenamente/săptămână');
  if (!trainingLocation) missingFields.push('locație antrenament');
  if (!targetWeightValue) missingFields.push('greutate dorită');

  if (missingFields.length > 0) {
    return NextResponse.json(
      { error: `Câmpuri lipsă: ${missingFields.join(', ')}.` },
      { status: 400 }
    );
  }

  // Validare valori numerice (bounds)
  const ageNum = Number(age);
  const heightNum = Number(height);
  const weightNum = Number(weight);
  const targetWeightNum = Number(targetWeightValue);
  const workoutsNum = Number(workoutsPerWeek);

  if (!Number.isFinite(ageNum) || ageNum < 14 || ageNum > 100)
    return NextResponse.json({ error: 'Vârsta trebuie să fie între 14 și 100 de ani.', field: 'age' }, { status: 400 });
  if (!Number.isFinite(heightNum) || heightNum < 100 || heightNum > 250)
    return NextResponse.json({ error: 'Înălțimea trebuie să fie între 100 și 250 cm.', field: 'height' }, { status: 400 });
  if (!Number.isFinite(weightNum) || weightNum < 30 || weightNum > 300)
    return NextResponse.json({ error: 'Greutatea trebuie să fie între 30 și 300 kg.', field: 'weight' }, { status: 400 });
  if (!Number.isFinite(targetWeightNum) || targetWeightNum < 30 || targetWeightNum > 300)
    return NextResponse.json({ error: 'Greutatea dorită trebuie să fie între 30 și 300 kg.', field: 'targetWeight' }, { status: 400 });
  if (!ALLOWED_WORKOUTS_PER_WEEK.includes(workoutsNum))
    return NextResponse.json({ error: 'Număr de antrenamente invalid (2–5).', field: 'workoutsPerWeek' }, { status: 400 });

  // Validare enum-uri (whitelist)
  const genderNorm = String(gender).toUpperCase();
  if (!ALLOWED_GENDERS.includes(genderNorm))
    return NextResponse.json({ error: 'Gen invalid.', field: 'gender' }, { status: 400 });
  if (!ALLOWED_FITNESS_LEVELS.includes(fitnessLevel))
    return NextResponse.json({ error: 'Nivel fitness invalid.', field: 'fitnessLevel' }, { status: 400 });
  if (!ALLOWED_TRAINING_LOCATIONS.includes(trainingLocation))
    return NextResponse.json({ error: 'Locație antrenament invalidă.', field: 'trainingLocation' }, { status: 400 });
  const dietTypeSafe = dietType && ALLOWED_DIET_TYPES.includes(dietType) ? dietType : 'omnivore';
  const goal = deriveGoalFromTargetWeight(weightNum, targetWeightNum);

  // Mapare locație antrenament → echipament disponibil
  const equipmentMap = {
    gym: 'full gym',
    home_dumbbells: 'dumbbells only',
    home: 'no equipment',
  };
  const availableEquipment = equipmentMap[trainingLocation] || 'full gym';

  // Mapare nivel fitness + antrenamente/săptămână → training split recomandat
  const computeTrainingSplit = (level, workouts) => {
    if (level === 'beginner') return 'Full Body';
    if (workouts <= 2) return 'Full Body';
    if (workouts === 3) return 'Push/Pull/Legs';
    if (workouts === 4) return 'Upper/Lower';
    return 'Upper/Lower/Push/Pull/Legs';
  };
  const trainingSplit = computeTrainingSplit(fitnessLevel, workoutsNum);

  // Mapare antrenamente/săptămână → nivel activitate
  const activityMap = {
    2: 'light',
    3: 'moderate',
    4: 'moderate',
    5: 'very_active',
  };
  const activityLevel = activityMap[workoutsNum] || 'moderate';
  const hydrationTargetMl = calculateHydrationTargetMl({
    weight: weightNum,
    activityLevel,
    goal,
  });
  const targetCalories = calculateTargetCalories({
    weight: weightNum,
    targetWeight: targetWeightNum,
    height: heightNum,
    age: ageNum,
    gender: genderNorm,
    activityLevel,
    goal,
  });
  const macroTargets = calculateMacros({ weight: weightNum, goal }, targetCalories);
  const now = new Date();
  const currentPlanDay = getCurrentPlanDayIndex(now);

  const supabase = getSupabase();

  // Determină numele: din body sau din users
  const { data: userRow } = await supabase
    .from('users')
    .select('name, onboarding_completed, xp, level, app_coins')
    .eq('id', auth.userId)
    .single();

  const userName = (name && normalizeUsername(name).length >= 2)
    ? normalizeUsername(name)
    : normalizeUsername(userRow?.name || 'Utilizator');

  if (userName.length < 2 || userName.length > 60 || !USERNAME_PATTERN.test(userName)) {
    return NextResponse.json({
      error: 'Numele de utilizator poate conține doar litere, cifre, spații, punct sau cratimă și trebuie să aibă 2–60 caractere.',
      field: 'name',
    }, { status: 400 });
  }

  try {
    const existingUsername = await findExistingUsernameOwner(supabase, userName, auth.userId);
    if (existingUsername) {
      return NextResponse.json({
        error: 'Acest nume de utilizator este deja folosit. Alege altul.',
        field: 'name',
      }, { status: 409 });
    }
  } catch (usernameError) {
    console.error('[onboarding] username lookup error:', usernameError);
    return NextResponse.json({ error: 'Nu am putut verifică numele de utilizator.' }, { status: 500 });
  }

  // Salvează profilul complet în tabela users
  const { error: updateError } = await supabase
    .from('users')
    .update({
      name: userName,
      age: ageNum,
      weight: weightNum,
      target_weight: targetWeightNum,
      height: heightNum,
      gender: genderNorm,
      fitness_level: fitnessLevel,
      available_equipment: availableEquipment,
      workouts_per_week: workoutsNum,
      training_split: trainingSplit,
      fitness_goal: goal,
      goal: goal,
      activity_level: activityLevel,
      diet_type: dietTypeSafe,
      meals_per_day: 5,
      hydration_target_ml: hydrationTargetMl,
      nutrition_target_calories: Math.round(targetCalories),
      nutrition_target_protein_g: Math.round(macroTargets.protein),
      nutrition_target_carbs_g: Math.round(macroTargets.carbs),
      nutrition_target_fat_g: Math.round(macroTargets.fat),
      food_preferences: typeof foodPreferences === 'string' ? foodPreferences : '',
      allergies: Array.isArray(allergies) ? allergies.join(', ') : (typeof allergies === 'string' ? allergies : ''),
      meals_completed_days: 0,
      workout_completed_days: 0,
      current_plan_day: currentPlanDay,
      current_plan_day_due_at: getNextPlanMidnightIso(now),
      meal_day_status: {},
      workout_day_status: {},
      meals_cooldown_until: null,
      workout_cooldown_until: null,
      weekly_plan_due_at: null,
      onboarding_completed: true,
    })
    .eq('id', auth.userId);

  if (updateError) {
    console.error('[onboarding] update error:', updateError);
    await logActivity({
      action: 'user.onboarding',
      status: 'error',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: {
        reason: 'profile_update_failed',
        code: updateError.code || null,
      },
    });
    if (updateError.code === '23505') {
      return NextResponse.json({
        error: 'Acest nume de utilizator este deja folosit. Alege altul.',
        field: 'name',
      }, { status: 409 });
    }
    return NextResponse.json({ error: 'Eroare la salvarea profilului.' }, { status: 500 });
  }

  let automaticMealPlan = null;
  let automaticMealPlanWarning = null;
  let onboardingReward = null;
  let mealPlanLock = { claimed: true, degraded: true };
  try {
    mealPlanLock = await claimAutomaticMealPlanGenerationLock({ supabase, userId: auth.userId });
    if (!mealPlanLock.claimed) {
      automaticMealPlanWarning = 'Planul alimentar se pregătește deja. Revino în câteva momente.';
    } else {
      automaticMealPlan = await createAutomaticMealPlanForUser({
        supabase,
        userId: auth.userId,
        freeOnly: true,
        profile: {
          name: userName,
          age: ageNum,
          weight: weightNum,
          targetWeight: targetWeightNum,
          target_weight: targetWeightNum,
          height: heightNum,
          gender: genderNorm,
          goal,
          activityLevel,
          dietType: dietTypeSafe,
          allergies,
          foodPreferences,
        },
      });
    }
    if (automaticMealPlan?.targets) {
      await supabase
        .from('users')
        .update({
          nutrition_target_calories: automaticMealPlan.targets.calories,
          nutrition_target_protein_g: automaticMealPlan.targets.protein,
          nutrition_target_carbs_g: automaticMealPlan.targets.carbs,
          nutrition_target_fat_g: automaticMealPlan.targets.fat,
        })
        .eq('id', auth.userId);
    }
    if (automaticMealPlan?.mealPlanId) {
      onboardingReward = await awardOnboardingReward({
        supabase,
        userId: auth.userId,
        previousUserRow: userRow,
      });
    }
  } catch (mealPlanError) {
    automaticMealPlanWarning = mealPlanError?.message || 'Planul alimentar automat nu a putut fi generat.';
    console.error('[onboarding] automatic meal plan error:', mealPlanError);
  } finally {
    if (mealPlanLock.claimed && !mealPlanLock.degraded) {
      await releaseAutomaticMealPlanGenerationLock({
        supabase,
        userId: auth.userId,
        errorMessage: automaticMealPlan ? null : automaticMealPlanWarning,
      });
    }
  }

  await logActivity({
    action: 'user.onboarding',
    status: automaticMealPlanWarning ? 'failure' : 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      goal,
      fitnessLevel,
      trainingLocation,
      workoutsPerWeek: workoutsNum,
      mealPlanGenerated: !!automaticMealPlan?.mealPlanId,
      mealPlanId: automaticMealPlan?.mealPlanId || null,
      warning: automaticMealPlanWarning || null,
      xpRewarded: !!onboardingReward,
    },
  });

  // clientId = userId (pentru compatibilitate cu codul existent)
  return NextResponse.json({
    clientId: auth.userId,
    success: true,
    user: {
      id: auth.userId,
      name: userName,
      onboarding_completed: true,
    },
    mealPlanId: automaticMealPlan?.mealPlanId || null,
    reward: onboardingReward,
    warning: automaticMealPlanWarning,
  });
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const usernameParam = searchParams.get('username');
  const supabase = getSupabase();

  if (usernameParam !== null) {
    const rateLimit = await enforceRateLimit(request, {
      userId: auth.userId,
      endpoint: 'user-onboarding-username-check',
      maxRequests: 30,
      windowMinutes: 1,
      failClosed: true,
    });
    if (rateLimit) return rateLimit;

    const username = normalizeUsername(usernameParam);
    if (username.length < 2 || username.length > 60 || !USERNAME_PATTERN.test(username)) {
      return NextResponse.json({
        available: false,
        error: 'Numele de utilizator poate conține doar litere, cifre, spații, punct sau cratimă și trebuie să aibă 2–60 caractere.',
      }, { status: 400 });
    }

    try {
      const existingUsername = await findExistingUsernameOwner(supabase, username, auth.userId);
      return NextResponse.json({ available: !existingUsername });
    } catch (usernameError) {
      console.error('[onboarding] username availability error:', usernameError);
      return NextResponse.json({ error: 'Nu am putut verifică numele de utilizator.' }, { status: 500 });
    }
  }

  const onboardingCompleted = await resolveUserOnboardingCompletion(supabase, auth.userId);

  return NextResponse.json({
    onboarding_completed: onboardingCompleted,
    clientId: auth.userId,
  });
}
