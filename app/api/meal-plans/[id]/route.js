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
    .from('meal_plans')
    .select('id, client_id, plan_data, daily_targets, created_at, previous_plan_calories')
    .eq('id', id)
    .eq('client_id', auth.userId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { data: client } = await supabase
    .from('users')
    .select('name, age, weight, height, gender, goal, activity_level, diet_type, allergies, meals_per_day, hydration_target_ml, food_preferences')
    .eq('id', data.client_id)
    .maybeSingle();

  const res = NextResponse.json({
    mealPlan: data,
    client,
    previousPlanCalories: data.previous_plan_calories || null,
  });
  res.headers.set('Cache-Control', 'private, max-age=10');
  res.headers.set('Vary', 'Authorization');
  return res;
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

  const updatePayload = {};
  if (body.plan_data && typeof body.plan_data === 'object' && Array.isArray(body.plan_data.days)) {
    updatePayload.plan_data = body.plan_data;
  }
  if (body.daily_targets && typeof body.daily_targets === 'object') {
    updatePayload.daily_targets = body.daily_targets;
  }

  if (!Object.keys(updatePayload).length) {
    return NextResponse.json({ error: 'Nu există câmpuri valide de actualizat.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('meal_plans')
    .update(updatePayload)
    .eq('id', id)
    .eq('client_id', auth.userId)
    .select('id, client_id, plan_data, daily_targets, created_at, previous_plan_calories')
    .maybeSingle();

  if (error || !data) {
    console.error('[meal-plans PATCH] Eroare la salvarea planului:', error);
    return NextResponse.json({ error: 'Nu am putut salva modificările planului.' }, { status: 500 });
  }

  return NextResponse.json({ mealPlan: data });
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
    .from('meal_plans')
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
