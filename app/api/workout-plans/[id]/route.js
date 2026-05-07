import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

// GET /api/workout-plans/[id]
export async function GET(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('workout_plans')
    .select('id, client_id, trainer_id, plan_data, created_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Planul nu a fost găsit.' }, { status: 404 });
  }

  // Auth check — trainer owns it or client owns it
  if (auth.role === 'trainer' && String(data.trainer_id) !== String(auth.userId)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }
  if (auth.role === 'client') {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', auth.userId)
      .single();
    if (!client || client.id !== data.client_id) {
      return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
    }
  }

  // Also fetch client profile
  const { data: clientRow } = await supabase
    .from('clients')
    .select('name, age, weight, height, gender, goal, activity_level, fitness_level, fitness_goal, training_split, available_equipment, injuries_limitations, workout_preferences')
    .eq('id', data.client_id)
    .single();

  return NextResponse.json({ workoutPlan: data, client: clientRow || null });
}
