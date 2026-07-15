import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

function encodeStoragePath(path = '') {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function buildRecipeImagePublicUrl(recipe, { transformed = true } = {}) {
  const bucket = String(recipe?.image_storage_bucket || 'imagini-mancare').trim();
  const path = String(recipe?.image_storage_path || '').trim().replace(/^\/+/, '');
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

async function resolveRecipeImageUrl(supabase, recipe) {
  const bucket = String(recipe?.image_storage_bucket || 'imagini-mancare').trim();
  const path = String(recipe?.image_storage_path || '').trim().replace(/^\/+/, '');
  if (!bucket || !path) return null;

  const { data: transformedData, error: transformedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 4, {
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
    .createSignedUrl(path, 60 * 60 * 4);

  if (!error && data?.signedUrl) return data.signedUrl;

  console.error('[user/recipes] recipe signed image URL failed:', {
    recipeId: recipe?.id,
    bucket,
    path,
    error,
  });

  return buildRecipeImagePublicUrl({ ...recipe, image_storage_bucket: bucket, image_storage_path: path }, { transformed: true })
    || buildRecipeImagePublicUrl({ ...recipe, image_storage_bucket: bucket, image_storage_path: path }, { transformed: false });
}

async function resolveRecipeImageFallbackUrl(supabase, recipe) {
  const bucket = String(recipe?.image_storage_bucket || 'imagini-mancare').trim();
  const path = String(recipe?.image_storage_path || '').trim().replace(/^\/+/, '');
  if (!bucket || !path) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 4);

  if (!error && data?.signedUrl) return data.signedUrl;

  return buildRecipeImagePublicUrl({ ...recipe, image_storage_bucket: bucket, image_storage_path: path }, { transformed: false });
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-recipes-get',
    maxRequests: 60,
    windowMinutes: 1,
  });
  if (rl) return rl;

  const searchParams = new URL(request.url).searchParams;
  const mealType = searchParams.get('mealType');
  if (mealType && !MEAL_TYPES.includes(mealType)) {
    return NextResponse.json({ error: 'Tip de masă invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();
  let recipeQuery = supabase
    .from('recipes')
    .select('id, name, meal_type, diet_types, protein_source, preparation, is_free, coin_price, image_storage_path, created_at')
    .order('meal_type', { ascending: true })
    .order('created_at', { ascending: true });

  if (mealType) recipeQuery = recipeQuery.eq('meal_type', mealType);

  const [
    { data: recipes, error: recipesError },
    { data: unlocks, error: unlocksError },
    { data: userRow, error: userError },
  ] = await Promise.all([
    recipeQuery,
    supabase
      .from('user_recipe_unlocks')
      .select('recipe_id')
      .eq('user_id', auth.userId),
    supabase
      .from('users')
      .select('app_coins')
      .eq('id', auth.userId)
      .maybeSingle(),
  ]);

  if (recipesError) {
    console.error('[user/recipes] recipes error:', recipesError);
    return NextResponse.json({ error: 'Nu am putut citi rețetele.' }, { status: 500 });
  }
  if (unlocksError) {
    console.error('[user/recipes] unlocks error:', unlocksError);
    return NextResponse.json({ error: 'Nu am putut citi rețetele deblocate.' }, { status: 500 });
  }
  if (userError) {
    console.error('[user/recipes] user error:', userError);
    return NextResponse.json({ error: 'Nu am putut citi balanța de monede.' }, { status: 500 });
  }

  const imageUrlEntries = await Promise.all((recipes || []).map(async recipe => {
    const [imageUrl, imageFallbackUrl] = await Promise.all([
      resolveRecipeImageUrl(supabase, recipe),
      resolveRecipeImageFallbackUrl(supabase, recipe),
    ]);
    return [String(recipe.id), { imageUrl, imageFallbackUrl }];
  }));
  const imageUrlsByRecipeId = new Map(imageUrlEntries);

  const unlockedIds = new Set((unlocks || []).map(row => String(row.recipe_id)));
  const items = (recipes || []).map(recipe => {
    const isFree = recipe.is_free === true || Number(recipe.coin_price) <= 0;
    const unlocked = isFree || unlockedIds.has(String(recipe.id));
    const recipeImages = imageUrlsByRecipeId.get(String(recipe.id)) || {};
    return {
      id: recipe.id,
      name: recipe.name,
      mealType: recipe.meal_type,
      dietTypes: recipe.diet_types || [],
      proteinSource: recipe.protein_source || null,
      preparation: recipe.preparation || null,
      imageUrl: recipeImages.imageUrl || null,
      imageFallbackUrl: recipeImages.imageFallbackUrl || null,
      isFree,
      coinPrice: isFree ? 0 : Math.max(0, Number(recipe.coin_price) || 0),
      unlocked,
    };
  });

  return NextResponse.json({
    appCoins: Math.max(0, Number(userRow?.app_coins) || 0),
    recipes: items,
  });
}
