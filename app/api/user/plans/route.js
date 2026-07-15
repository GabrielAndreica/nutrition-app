import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import {
  claimAutomaticMealPlanGenerationLock,
  createAutomaticMealPlanForUser,
  releaseAutomaticMealPlanGenerationLock,
} from '@/app/lib/automaticMealPlan';
import { calculateHydrationTargetMl } from '@/app/lib/hydrationTarget';

const MEAL_PLAN_SELECT = 'id, plan_data, daily_targets, created_at';
const RECIPE_IMAGE_SELECT = 'id, image_storage_bucket, image_storage_path';
const DEFAULT_RECIPE_IMAGE_BUCKET = 'imagini-mancare';
const IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 4;
const IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 3;
const recipeImageUrlCache = new Map();

function encodeStoragePath(path = '') {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function buildRecipeImagePublicUrl(row, { transformed = true } = {}) {
  const bucket = String(row?.image_storage_bucket || DEFAULT_RECIPE_IMAGE_BUCKET).trim();
  const path = String(row?.image_storage_path || '').trim().replace(/^\/+/, '');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!bucket || !path || !supabaseUrl) return null;

  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = encodeStoragePath(path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path);

  if (!transformed) {
    return `${baseUrl}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
  }

  const params = new URLSearchParams({
    width: '900',
    height: '506',
    resize: 'cover',
    quality: '72',
  });
  return `${baseUrl}/storage/v1/render/image/public/${encodedBucket}/${encodedPath}?${params.toString()}`;
}

async function resolveRecipeImageUrl(supabase, row) {
  if (!row?.image_storage_path) {
    return row?.image_url || row?.imageUrl || null;
  }

  const bucket = row.image_storage_bucket || DEFAULT_RECIPE_IMAGE_BUCKET;
  if (!bucket) {
    console.error('[user/plans] recipe image bucket missing:', {
      recipeId: row.id,
      path: row.image_storage_path,
    });
    return row?.image_url || row?.imageUrl || null;
  }

  const { data: transformedData, error: transformedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(row.image_storage_path, IMAGE_SIGNED_URL_TTL_SECONDS, {
      transform: {
        width: 900,
        height: 506,
        resize: 'cover',
        quality: 72,
      },
    });

  if (!transformedError && transformedData?.signedUrl) return transformedData.signedUrl;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(row.image_storage_path, IMAGE_SIGNED_URL_TTL_SECONDS);

  if (!error && data?.signedUrl) return data.signedUrl;

  console.error('[user/plans] recipe signed image URL failed:', {
    bucket,
    path: row.image_storage_path,
    error,
  });

  const transformedPublicUrl = buildRecipeImagePublicUrl(row, { transformed: true });
  if (transformedPublicUrl) return transformedPublicUrl;

  const { data: publicData } = supabase.storage
    .from(bucket)
    .getPublicUrl(row.image_storage_path);

  return publicData?.publicUrl || row?.image_url || row?.imageUrl || null;
}

async function resolveRecipeImageFallbackUrl(supabase, row) {
  if (!row?.image_storage_path) return row?.image_url || row?.imageUrl || null;

  const bucket = row.image_storage_bucket || DEFAULT_RECIPE_IMAGE_BUCKET;
  if (!bucket) return row?.image_url || row?.imageUrl || null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(row.image_storage_path, IMAGE_SIGNED_URL_TTL_SECONDS);

  if (!error && data?.signedUrl) return data.signedUrl;

  const { data: publicData } = supabase.storage
    .from(bucket)
    .getPublicUrl(row.image_storage_path);

  return publicData?.publicUrl || row?.image_url || row?.imageUrl || null;
}

function getRecipeImageCacheKey(row) {
  return [
    row?.image_url || row?.imageUrl || '',
    row?.image_storage_bucket || '',
    row?.image_storage_path || '',
  ].join('|');
}

function readRecipeImageUrlCache(key) {
  const cached = recipeImageUrlCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    recipeImageUrlCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeRecipeImageUrlCache(key, value) {
  if (!key) return value;
  recipeImageUrlCache.set(key, {
    value,
    expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
  });

  if (recipeImageUrlCache.size > 500) {
    const now = Date.now();
    for (const [cacheKey, cacheValue] of recipeImageUrlCache.entries()) {
      if (cacheValue.expiresAt <= now || recipeImageUrlCache.size > 400) {
        recipeImageUrlCache.delete(cacheKey);
      }
    }
  }

  return value;
}

async function resolveRecipeImageUrlsCached(supabase, recipe) {
  const key = getRecipeImageCacheKey(recipe);
  const cached = readRecipeImageUrlCache(key);
  if (cached) return cached;

  const [imageUrl, imageFallbackUrl] = await Promise.all([
    resolveRecipeImageUrl(supabase, recipe),
    resolveRecipeImageFallbackUrl(supabase, recipe),
  ]);

  return writeRecipeImageUrlCache(key, { imageUrl, imageFallbackUrl });
}

function collectRecipeIdsFromPlan(planData) {
  const ids = new Set();
  for (const day of planData?.days || []) {
    for (const meal of day?.meals || []) {
      if (meal?.recipeId) ids.add(String(meal.recipeId));
      if (meal?.recipe_id) ids.add(String(meal.recipe_id));
    }
  }
  return [...ids];
}

async function enrichMealPlanImages(supabase, mealPlan) {
  if (!mealPlan?.plan_data) return mealPlan;

  const recipeIds = collectRecipeIdsFromPlan(mealPlan.plan_data);
  if (!recipeIds.length) return mealPlan;

  const { data: recipes, error } = await supabase
    .from('recipes')
    .select(RECIPE_IMAGE_SELECT)
    .in('id', recipeIds);

  if (error) {
    console.error('[user/plans] recipe image lookup error:', error);
    return mealPlan;
  }

  const recipesById = new Map((recipes || []).map(recipe => [String(recipe.id), recipe]));
  const imageUrlCache = new Map();
  await Promise.all((recipes || []).map(async recipe => {
    const key = getRecipeImageCacheKey(recipe);
    if (!key || imageUrlCache.has(key)) return;
    imageUrlCache.set(key, await resolveRecipeImageUrlsCached(supabase, recipe));
  }));

  const planData = {
    ...mealPlan.plan_data,
    days: (mealPlan.plan_data.days || []).map(day => ({
      ...day,
      meals: (day.meals || []).map(meal => {
        const recipe = recipesById.get(String(meal.recipeId || meal.recipe_id || ''));
        if (!recipe) return meal;
        const imageSource = {
          id: recipe.id,
          image_url: meal.imageUrl || meal.image_url || null,
          image_storage_path: meal.imageStoragePath || meal.image_storage_path || recipe.image_storage_path || null,
          image_storage_bucket: meal.imageStorageBucket || meal.image_storage_bucket || recipe.image_storage_bucket || DEFAULT_RECIPE_IMAGE_BUCKET,
        };
        const cachedImage = imageUrlCache.get(getRecipeImageCacheKey(imageSource)) || {};
        const imageUrl = cachedImage.imageUrl || cachedImage.imageFallbackUrl || imageSource.image_url || null;
        return {
          ...meal,
          imageUrl,
          imageFallbackUrl: cachedImage.imageFallbackUrl || imageSource.image_url || null,
          imageStoragePath: imageSource.image_storage_path,
          imageStorageBucket: imageSource.image_storage_bucket,
        };
      }),
    })),
  };

  return {
    ...mealPlan,
    plan_data: planData,
  };
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-plans-get',
    maxRequests: 60,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rl) return rl;

  const supabase = getSupabase();

  // Obține profilul utilizatorului direct din users
  let { data: clientRow, error: clientError } = await supabase
    .from('users')
    .select('id, name, age, weight, target_weight, height, gender, fitness_level, available_equipment, workouts_per_week, training_split, fitness_goal, goal, activity_level, diet_type, meals_per_day, hydration_target_ml, food_preferences, allergies')
    .eq('id', auth.userId)
    .maybeSingle();

  if (clientError || !clientRow) {
    return NextResponse.json({ error: 'Profilul nu a fost găsit. Completă onboarding-ul.' }, { status: 404 });
  }

  if (!Number(clientRow.hydration_target_ml)) {
    const hydrationTargetMl = calculateHydrationTargetMl({
      weight: clientRow.weight,
      activityLevel: clientRow.activity_level,
      goal: clientRow.goal || clientRow.fitness_goal,
    });

    const { data: updatedHydration } = await supabase
      .from('users')
      .update({ hydration_target_ml: hydrationTargetMl })
      .eq('id', auth.userId)
      .select('hydration_target_ml')
      .maybeSingle();

    clientRow = {
      ...clientRow,
      hydration_target_ml: updatedHydration?.hydration_target_ml || hydrationTargetMl,
    };
  }

  const clientId = auth.userId;

  // Obține cel mai recent plan alimentar
  let { data: mealPlan } = await supabase
    .from('meal_plans')
    .select(MEAL_PLAN_SELECT)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let mealPlanWarning = null;
  if (!mealPlan) {
    const lock = await claimAutomaticMealPlanGenerationLock({ supabase, userId: clientId });
    if (!lock.claimed) {
      const { data: existingMealPlan } = await supabase
        .from('meal_plans')
        .select(MEAL_PLAN_SELECT)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      mealPlan = existingMealPlan || null;
      mealPlanWarning = mealPlan
        ? null
        : 'Planul alimentar se pregătește. Revino în câteva momente.';
    }

    try {
      if (!mealPlan && lock.claimed) {
        const generated = await createAutomaticMealPlanForUser({
          supabase,
          userId: clientId,
          profile: {
            name: clientRow.name,
            age: clientRow.age,
            weight: clientRow.weight,
            targetWeight: clientRow.target_weight,
            target_weight: clientRow.target_weight,
            height: clientRow.height,
            gender: clientRow.gender,
            goal: clientRow.goal,
            activityLevel: clientRow.activity_level,
            dietType: clientRow.diet_type,
            allergies: clientRow.allergies,
            foodPreferences: clientRow.food_preferences,
          },
        });
        if (generated?.mealPlanId) {
          const { data: generatedMealPlan } = await supabase
            .from('meal_plans')
            .select(MEAL_PLAN_SELECT)
            .eq('id', generated.mealPlanId)
            .maybeSingle();
          mealPlan = generatedMealPlan || null;
        }
      }
    } catch (error) {
      mealPlanWarning = error?.message || 'Planul alimentar automat nu a putut fi generat.';
      console.error('[user/plans] automatic meal plan error:', error);
    } finally {
      if (lock.claimed && !lock.degraded) {
        await releaseAutomaticMealPlanGenerationLock({
          supabase,
          userId: clientId,
          errorMessage: mealPlan ? null : mealPlanWarning,
        });
      }
    }
  }

  mealPlan = await enrichMealPlanImages(supabase, mealPlan);

  // Obține cel mai recent plan de antrenament
  const { data: workoutPlan } = await supabase
    .from('workout_plans')
    .select('id, plan_data, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    client: clientRow,
    mealPlan: mealPlan || null,
    workoutPlan: workoutPlan || null,
    mealPlanWarning,
  });
}
