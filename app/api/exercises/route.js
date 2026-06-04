import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

/**
 * GET /api/exercises
 * Returns all active exercises for the exercise picker modal.
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
    .from('exercises')
    .select('id, name, name_ro, muscle_group, equipment, difficulty, default_sets, default_reps, default_rest_seconds, notes')
    .eq('active', true)
    .order('muscle_group', { ascending: true })
    .order('name_ro', { ascending: true });

  if (error) {
    console.error('[GET /api/exercises]', error.message);
    return NextResponse.json({ error: 'Nu am putut încărca exercițiile.' }, { status: 500 });
  }

  const res = NextResponse.json({ exercises: data || [] });
  res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
  return res;
}
