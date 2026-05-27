import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const supabase = getSupabase();

  // Obține clientId-ul utilizatorului
  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id, name, age, weight, height, gender, fitness_level, available_equipment, workouts_per_week, training_split, fitness_goal, goal, activity_level, diet_type, meals_per_day')
    .eq('user_id', auth.userId)
    .is('trainer_id', null)
    .maybeSingle();

  if (clientError || !clientRow) {
    return NextResponse.json({ error: 'Profilul nu a fost găsit. Completează onboarding-ul.' }, { status: 404 });
  }

  const clientId = clientRow.id;

  // Obține cel mai recent plan alimentar
  const { data: mealPlan } = await supabase
    .from('meal_plans')
    .select('id, plan_data, daily_targets, created_at, approval_status')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Obține cel mai recent plan de antrenament
  const { data: workoutPlan } = await supabase
    .from('workout_plans')
    .select('id, plan_data, created_at, approval_status')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    client: clientRow,
    mealPlan: mealPlan || null,
    workoutPlan: workoutPlan || null,
  });
}
