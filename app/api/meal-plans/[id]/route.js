import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

// GET /api/meal-plans/[id] — returnează un plan complet
export async function GET(request, {
params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Construiește query-ul bazat pe rol
  if (!auth.role || !['trainer', 'client'].includes(auth.role)) {
    return NextResponse.json({ error: 'Rol necunoscut. Acces interzis.' }, { status: 403 });
  }

  // ─── Optimizare: Single query cu JOIN pentru client data ───────
  let query = supabase
    .from('meal_plans')
    .select(`
      id, 
      client_id, 
      plan_data, 
      daily_targets, 
      created_at, 
      previous_plan_calories,
      clients!inner (
        name, 
        age, 
        weight, 
        height, 
        gender, 
        goal, 
        activity_level, 
        diet_type, 
        allergies, 
        meals_per_day, 
        food_preferences
      )
    `)
    .eq('id', id);

  // Dacă e trainer, verifică că planul aparține trainerului
  if (auth.role === 'trainer') {
    query = query.eq('trainer_id', auth.userId);
  }
  // Dacă e client, verifică că planul aparține clientului
  else if (auth.role === 'client') {
    // Obține client_id pentru user
    const { data: clientCheck, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', auth.userId)
      .single();

    if (clientError || !clientCheck) {
      return NextResponse.json({ error: 'Client negăsit.' }, { status: 404 });
    }

    query = query.eq('client_id', clientCheck.id);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  // Extract client data from JOIN result
  const client = data.clients || null;

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'meal_plan.view',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      planId: id,
      clientId: data.client_id || null,
      clientName: client?.name || data.plan_data?.clientName || null,
    },
  });

  // Nu folosim cache pentru a avea datele mereu fresh (important pentru greutate actualizată)
  const res = NextResponse.json({ 
    mealPlan: {
      id: data.id,
      client_id: data.client_id,
      plan_data: data.plan_data,
      daily_targets: data.daily_targets,
      created_at: data.created_at,
      previous_plan_calories: data.previous_plan_calories
    }, 
    client,
    previousPlanCalories: data.previous_plan_calories || null
  });
  res.headers.set('Cache-Control', 'private, max-age=10'); // Cache 10 secunde pentru același user
  res.headers.set('Vary', 'Authorization');
  return res;
}

// DELETE /api/meal-plans/[id] — șterge un plan (doar traineri)
export async function DELETE(request, {
params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Doar trainerii pot șterge planuri
  if (auth.role !== 'trainer') {
    return NextResponse.json({ error: 'Nu ai permisiunea să ștergi planuri.' }, { status: 403 });
  }

  // .eq('trainer_id') servește și ca ownership check — dacă count=0 înseamnă not found / no access
  const { error, count } = await supabase
    .from('meal_plans')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('trainer_id', auth.userId);

  const { ip, userAgent } = getRequestMeta(request);

  if (!error && count === 0) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  if (error) {
    logActivity({
      action: 'meal_plan.delete',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { planId: id, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la ștergerea planului.' }, { status: 500 });
  }

  logActivity({
    action: 'meal_plan.delete',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { planId: id },
  });
  return NextResponse.json({ success: true });
}
