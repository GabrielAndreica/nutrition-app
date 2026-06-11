import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

/**
 * GET /api/foods
 * Returns all foods from the database for the food picker modal.
 * Only trainers can access this endpoint.
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'trainer') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('foods')
    .select('id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, max_amount_per_meal, grams_per_unit')
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('[GET /api/foods]', error.message);
    return NextResponse.json({ error: 'Nu am putut încărca alimentele.' }, { status: 500 });
  }

  const res = NextResponse.json({ foods: data || [] });
  res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
  return res;
}
