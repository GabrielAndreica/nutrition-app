import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { resolveUserOnboardingCompletion } from '@/app/lib/onboardingStatus';
import { calculateHydrationTargetMl } from '@/app/lib/hydrationTarget';
import { createAutomaticMealPlanForUser } from '@/app/lib/automaticMealPlan';
import { getLevelInfo } from '@/app/api/user/level/route';
import {
  APP_COIN_REWARDS,
  awardAppCoins,
  getCoinRewardReason,
} from '@/app/lib/appCurrency';
import { getCurrentPlanDayIndex, getNextPlanMidnightIso } from '@/app/lib/weeklyPlanRegeneration';

// Allowed enum values
const ALLOWED_FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced'];
const ALLOWED_TRAINING_LOCATIONS = ['gym', 'home_dumbbells', 'home'];
const ALLOWED_GOALS = ['muscle_gain', 'weight_loss', 'maintenance', 'endurance', 'flexibility'];
const ALLOWED_DIET_TYPES = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'paleo'];
const ALLOWED_GENDERS = ['M', 'F'];
const ALLOWED_WORKOUTS_PER_WEEK = [2, 3, 4, 5, 6];
const ONBOARDING_XP_REWARD = 50;

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
  });
  if (rl) return rl;

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
    goal, dietType, allergies, foodPreferences,
  } = body;

  // Validare câmpuri obligatorii
  const missingFields = [];
  if (!age) missingFields.push('vârstă');
  if (!height) missingFields.push('înălțime');
  if (!weight) missingFields.push('greutate');
  if (!gender) missingFields.push('gen');
  if (!fitnessLevel) missingFields.push('nivel fitness');
  if (!workoutsPerWeek) missingFields.push('antrenamente/săptămână');
  if (!trainingLocation) missingFields.push('locație antrenament');
  if (!goal) missingFields.push('obiectiv');

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
  const workoutsNum = Number(workoutsPerWeek);

  if (!Number.isFinite(ageNum) || ageNum < 14 || ageNum > 100)
    return NextResponse.json({ error: 'Vârsta trebuie să fie între 14 și 100 de ani.', field: 'age' }, { status: 400 });
  if (!Number.isFinite(heightNum) || heightNum < 100 || heightNum > 250)
    return NextResponse.json({ error: 'Înălțimea trebuie să fie între 100 și 250 cm.', field: 'height' }, { status: 400 });
  if (!Number.isFinite(weightNum) || weightNum < 30 || weightNum > 300)
    return NextResponse.json({ error: 'Greutatea trebuie să fie între 30 și 300 kg.', field: 'weight' }, { status: 400 });
  if (!ALLOWED_WORKOUTS_PER_WEEK.includes(workoutsNum))
    return NextResponse.json({ error: 'Număr de antrenamente invalid (2–6).', field: 'workoutsPerWeek' }, { status: 400 });

  // Validare enum-uri (whitelist)
  const genderNorm = String(gender).toUpperCase();
  if (!ALLOWED_GENDERS.includes(genderNorm))
    return NextResponse.json({ error: 'Gen invalid.', field: 'gender' }, { status: 400 });
  if (!ALLOWED_FITNESS_LEVELS.includes(fitnessLevel))
    return NextResponse.json({ error: 'Nivel fitness invalid.', field: 'fitnessLevel' }, { status: 400 });
  if (!ALLOWED_TRAINING_LOCATIONS.includes(trainingLocation))
    return NextResponse.json({ error: 'Locație antrenament invalidă.', field: 'trainingLocation' }, { status: 400 });
  if (!ALLOWED_GOALS.includes(goal))
    return NextResponse.json({ error: 'Obiectiv invalid.', field: 'goal' }, { status: 400 });
  const dietTypeSafe = dietType && ALLOWED_DIET_TYPES.includes(dietType) ? dietType : 'omnivore';

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
    if (workouts === 5) return 'Upper/Lower/Push/Pull/Legs';
    return 'Bro Split'; // 6+
  };
  const trainingSplit = computeTrainingSplit(fitnessLevel, workoutsNum);

  // Mapare antrenamente/săptămână → nivel activitate
  const activityMap = {
    2: 'light',
    3: 'moderate',
    4: 'moderate',
    5: 'very_active',
    6: 'very_active',
  };
  const activityLevel = activityMap[workoutsNum] || 'moderate';
  const hydrationTargetMl = calculateHydrationTargetMl({
    weight: weightNum,
    activityLevel,
    goal,
  });
  const now = new Date();
  const currentPlanDay = getCurrentPlanDayIndex(now);

  const supabase = getSupabase();

  // Determină numele: din body sau din users
  const { data: userRow } = await supabase
    .from('users')
    .select('name, onboarding_completed, xp, level, app_coins')
    .eq('id', auth.userId)
    .single();

  const userName = (name && name.trim().length >= 2) ? name.trim() : (userRow?.name || 'Utilizator');

  // Salvează profilul complet în tabela users
  const { error: updateError } = await supabase
    .from('users')
    .update({
      name: userName,
      age: ageNum,
      weight: weightNum,
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
    return NextResponse.json({ error: 'Eroare la salvarea profilului.' }, { status: 500 });
  }

  let automaticMealPlan = null;
  let automaticMealPlanWarning = null;
  let onboardingReward = null;
  try {
    automaticMealPlan = await createAutomaticMealPlanForUser({
      supabase,
      userId: auth.userId,
      freeOnly: true,
      profile: {
        name: userName,
        age: ageNum,
        weight: weightNum,
        height: heightNum,
        gender: genderNorm,
        goal,
        activityLevel,
        dietType: dietTypeSafe,
        allergies,
        foodPreferences,
      },
    });
    onboardingReward = await awardOnboardingReward({
      supabase,
      userId: auth.userId,
      previousUserRow: userRow,
    });
  } catch (mealPlanError) {
    automaticMealPlanWarning = mealPlanError?.message || 'Planul alimentar automat nu a putut fi generat.';
    console.error('[onboarding] automatic meal plan error:', mealPlanError);
  }

  // clientId = userId (pentru compatibilitate cu codul existent)
  return NextResponse.json({
    clientId: auth.userId,
    success: true,
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

  const supabase = getSupabase();
  const onboardingCompleted = await resolveUserOnboardingCompletion(supabase, auth.userId);

  return NextResponse.json({
    onboarding_completed: onboardingCompleted,
    clientId: auth.userId,
  });
}
