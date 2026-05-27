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
  if (!auth.role || !['trainer', 'client', 'user'].includes(auth.role)) {
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
      approval_status,
      approved_at,
      approved_by,
      clients!inner (
        user_id,
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
  else if (auth.role === 'client' || auth.role === 'user') {
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
    query = query.eq('approval_status', 'approved');
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
      previous_plan_calories: data.previous_plan_calories,
      approval_status: data.approval_status || 'approved',
      approved_at: data.approved_at || null,
      approved_by: data.approved_by || null
    }, 
    client,
    previousPlanCalories: data.previous_plan_calories || null
  });
  res.headers.set('Cache-Control', 'private, max-age=10'); // Cache 10 secunde pentru același user
  res.headers.set('Vary', 'Authorization');
  return res;
}

// PATCH /api/meal-plans/[id] — actualizează planul sau îl aprobă pentru client
export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.role !== 'trainer') {
    return NextResponse.json({ error: 'Doar antrenorul poate modifica sau aproba planul.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const action = body?.action;
  if (!['update', 'approve'].includes(action)) {
    return NextResponse.json({ error: 'Acțiune invalidă.' }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from('meal_plans')
    .select('id, client_id, trainer_id, plan_data, daily_targets, approval_status, approved_at, approved_by, clients!inner(user_id)')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { ip, userAgent } = getRequestMeta(request);

  if (action === 'update') {
    if (!body.plan_data || typeof body.plan_data !== 'object' || !Array.isArray(body.plan_data.days)) {
      return NextResponse.json({ error: 'Structura planului este invalidă.' }, { status: 400 });
    }

    const isAlreadyApproved = (existing.approval_status || 'approved') === 'approved';
    const updatePayload = {
      plan_data: body.plan_data,
      approval_status: isAlreadyApproved ? 'approved' : 'pending_review',
      approved_at: isAlreadyApproved ? existing.approved_at : null,
      approved_by: isAlreadyApproved ? existing.approved_by : null,
    };
    if (body.daily_targets && typeof body.daily_targets === 'object') {
      updatePayload.daily_targets = body.daily_targets;
    }

    const { data: updated, error: updateError } = await supabase
      .from('meal_plans')
      .update(updatePayload)
      .eq('id', id)
      .eq('trainer_id', auth.userId)
      .select('id, client_id, plan_data, daily_targets, approval_status, approved_at, approved_by')
      .single();

    if (updateError) {
      console.error('[meal-plans PATCH] Eroare la salvarea modificărilor:', {
        planId: id,
        trainerId: auth.userId,
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      });
      return NextResponse.json({
        error: 'Nu am putut salva modificările planului.',
        ...(process.env.NODE_ENV !== 'production'
          ? { details: updateError.message, code: updateError.code || null }
          : {}),
      }, { status: 500 });
    }

    logActivity({
      action: 'meal_plan.update_for_review',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { planId: id, clientId: existing.client_id },
    });

    return NextResponse.json({ mealPlan: updated });
  }

  const now = new Date().toISOString();
  const { data: approved, error: approveError } = await supabase
    .from('meal_plans')
    .update({
      approval_status: 'approved',
      approved_at: now,
      approved_by: auth.userId,
    })
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .select('id, client_id, plan_data, daily_targets, approval_status, approved_at, approved_by')
    .single();

  if (approveError) {
    console.error('[meal-plans PATCH] Eroare la aprobarea planului:', {
      planId: id,
      trainerId: auth.userId,
      code: approveError.code,
      message: approveError.message,
      details: approveError.details,
      hint: approveError.hint,
    });
    return NextResponse.json({
      error: 'Nu am putut aproba planul.',
      ...(process.env.NODE_ENV !== 'production'
        ? { details: approveError.message, code: approveError.code || null }
        : {}),
    }, { status: 500 });
  }

  let pairedWorkoutPlan = null;
  const { data: pendingWorkout, error: pendingWorkoutError } = await supabase
    .from('workout_plans')
    .select('id, client_id, trainer_id, plan_data, approval_status, approved_at, approved_by')
    .eq('client_id', existing.client_id)
    .eq('trainer_id', auth.userId)
    .eq('approval_status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingWorkoutError) {
    console.error('[meal-plans PATCH] Eroare la căutarea planului de antrenament pereche:', {
      planId: id,
      clientId: existing.client_id,
      code: pendingWorkoutError.code,
      message: pendingWorkoutError.message,
      details: pendingWorkoutError.details,
      hint: pendingWorkoutError.hint,
    });
  } else if (pendingWorkout) {
    const { data: approvedWorkout, error: pairedWorkoutError } = await supabase
      .from('workout_plans')
      .update({
        approval_status: 'approved',
        approved_at: now,
        approved_by: auth.userId,
      })
      .eq('id', pendingWorkout.id)
      .eq('trainer_id', auth.userId)
      .select('id, client_id, trainer_id, plan_data, approval_status, approved_at, approved_by')
      .single();

    if (pairedWorkoutError) {
      console.error('[meal-plans PATCH] Eroare la aprobarea planului de antrenament pereche:', {
        mealPlanId: id,
        workoutPlanId: pendingWorkout.id,
        clientId: existing.client_id,
        code: pairedWorkoutError.code,
        message: pairedWorkoutError.message,
        details: pairedWorkoutError.details,
        hint: pairedWorkoutError.hint,
      });
    } else {
      pairedWorkoutPlan = approvedWorkout;
    }
  }

  const clientUserId = existing.clients?.user_id;
  if (clientUserId) {
    const notifications = [{
        user_id: clientUserId,
        type: 'new_meal_plan',
        title: existing.approval_status === 'approved' ? 'Plan alimentar actualizat' : 'Plan alimentar nou',
        message: existing.approval_status === 'approved'
          ? 'Antrenorul tău ți-a trimis o versiune actualizată a planului alimentar.'
          : 'Antrenorul tău ți-a trimis un plan alimentar nou.',
        related_plan_id: id,
        related_client_id: existing.client_id,
        is_read: false,
      }];

    if (pairedWorkoutPlan) {
      notifications.push({
        user_id: clientUserId,
        type: 'new_workout_plan',
        title: 'Plan de antrenament nou',
        message: 'Antrenorul tău ți-a trimis un plan de antrenament nou.',
        related_plan_id: null,
        related_client_id: existing.client_id,
        is_read: false,
      });
    }

    const { error: notificationError } = await supabase
      .from('notifications')
      .insert(notifications);
    if (notificationError) {
      console.error('[meal-plans PATCH] Eroare la notificarea clientului:', notificationError.message);
    }
  }

  logActivity({
    action: 'meal_plan.approve',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { planId: id, clientId: existing.client_id },
  });

  return NextResponse.json({ mealPlan: approved, workoutPlan: pairedWorkoutPlan });
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
