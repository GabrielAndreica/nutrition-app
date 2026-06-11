import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

/**
 * GET /api/recipes
 * Returns all recipes for the add-meal picker modal.
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
    .from('recipes')
    .select('id, name, meal_type, diet_types, protein_source, preparation, ingredients')
    .order('meal_type', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('[GET /api/recipes]', error.message);
    return NextResponse.json({ error: 'Nu am putut încărca rețetele.' }, { status: 500 });
  }

  const res = NextResponse.json({ recipes: data || [] });
  res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
  return res;
}
