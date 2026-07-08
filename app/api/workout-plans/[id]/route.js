import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

export async function GET(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('workout_plans')
    .select('id, client_id, plan_data, created_at')
    .eq('id', id)
    .eq('client_id', auth.userId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { data: client } = await supabase
    .from('users')
    .select('name, age, weight, height, gender, goal, activity_level, fitness_level, fitness_goal, training_split, available_equipment, injuries_limitations, workout_preferences')
    .eq('id', data.client_id)
    .maybeSingle();

  return NextResponse.json({ workoutPlan: data, client: client || null });
}

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  if (!body.plan_data || typeof body.plan_data !== 'object' || !Array.isArray(body.plan_data.days)) {
    return NextResponse.json({ error: 'Structura planului este invalidă.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('workout_plans')
    .update({ plan_data: body.plan_data })
    .eq('id', id)
    .eq('client_id', auth.userId)
    .select('id, client_id, plan_data, created_at')
    .maybeSingle();

  if (error || !data) {
    console.error('[workout-plans PATCH] Eroare la salvarea planului:', error);
    return NextResponse.json({ error: 'Nu am putut salva modificările planului.' }, { status: 500 });
  }

  return NextResponse.json({ workoutPlan: data });
}

export async function DELETE(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { error, count } = await supabase
    .from('workout_plans')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('client_id', auth.userId);

  if (!error && count === 0) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  if (error) {
    return NextResponse.json({ error: 'Eroare la ștergerea planului.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
