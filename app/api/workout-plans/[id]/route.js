import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

// GET /api/workout-plans/[id]
export async function GET(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('workout_plans')
    .select('id, client_id, trainer_id, plan_data, created_at, approval_status, approved_at, approved_by')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Planul nu a fost găsit.' }, { status: 404 });
  }

  // Auth check — trainer owns it or client owns it
  if (auth.role === 'trainer' && String(data.trainer_id) !== String(auth.userId)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }
  if (auth.role === 'client' || auth.role === 'user') {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', auth.userId)
      .single();
    if (!client || client.id !== data.client_id) {
      return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
    }
    if ((data.approval_status || 'approved') !== 'approved') {
      return NextResponse.json({ error: 'Planul nu este disponibil încă.' }, { status: 404 });
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

// PATCH /api/workout-plans/[id] — actualizează planul sau îl aprobă pentru client
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
    .from('workout_plans')
    .select('id, client_id, trainer_id, plan_data, approval_status, approved_at, approved_by, clients!inner(user_id)')
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
    const { data: updated, error: updateError } = await supabase
      .from('workout_plans')
      .update({
        plan_data: body.plan_data,
        approval_status: isAlreadyApproved ? 'approved' : 'pending_review',
        approved_at: isAlreadyApproved ? existing.approved_at : null,
        approved_by: isAlreadyApproved ? existing.approved_by : null,
      })
      .eq('id', id)
      .eq('trainer_id', auth.userId)
      .select('id, client_id, trainer_id, plan_data, approval_status, approved_at, approved_by')
      .single();

    if (updateError) {
      console.error('[workout-plans PATCH] Eroare la salvarea modificărilor:', {
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
      action: 'workout_plan.update_for_review',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { planId: id, clientId: existing.client_id },
    });

    return NextResponse.json({ workoutPlan: updated });
  }

  const now = new Date().toISOString();
  const { data: approved, error: approveError } = await supabase
    .from('workout_plans')
    .update({
      approval_status: 'approved',
      approved_at: now,
      approved_by: auth.userId,
    })
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .select('id, client_id, trainer_id, plan_data, approval_status, approved_at, approved_by')
    .single();

  if (approveError) {
    console.error('[workout-plans PATCH] Eroare la aprobarea planului:', {
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

  let pairedMealPlan = null;
  const { data: pendingMeal, error: pendingMealError } = await supabase
    .from('meal_plans')
    .select('id, client_id, plan_data, daily_targets, approval_status, approved_at, approved_by')
    .eq('client_id', existing.client_id)
    .eq('trainer_id', auth.userId)
    .eq('approval_status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingMealError) {
    console.error('[workout-plans PATCH] Eroare la căutarea planului alimentar pereche:', {
      planId: id,
      clientId: existing.client_id,
      code: pendingMealError.code,
      message: pendingMealError.message,
      details: pendingMealError.details,
      hint: pendingMealError.hint,
    });
  } else if (pendingMeal) {
    const { data: approvedMeal, error: pairedMealError } = await supabase
      .from('meal_plans')
      .update({
        approval_status: 'approved',
        approved_at: now,
        approved_by: auth.userId,
      })
      .eq('id', pendingMeal.id)
      .eq('trainer_id', auth.userId)
      .select('id, client_id, plan_data, daily_targets, approval_status, approved_at, approved_by')
      .single();

    if (pairedMealError) {
      console.error('[workout-plans PATCH] Eroare la aprobarea planului alimentar pereche:', {
        workoutPlanId: id,
        mealPlanId: pendingMeal.id,
        clientId: existing.client_id,
        code: pairedMealError.code,
        message: pairedMealError.message,
        details: pairedMealError.details,
        hint: pairedMealError.hint,
      });
    } else {
      pairedMealPlan = approvedMeal;
    }
  }

  const clientUserId = existing.clients?.user_id;
  if (clientUserId) {
    const notifications = [{
        user_id: clientUserId,
        type: 'new_workout_plan',
        title: existing.approval_status === 'approved' ? 'Plan de antrenament actualizat' : 'Plan de antrenament nou',
        message: existing.approval_status === 'approved'
          ? 'Antrenorul tău ți-a trimis o versiune actualizată a planului de antrenament.'
          : 'Antrenorul tău ți-a trimis un plan de antrenament nou.',
        related_plan_id: null,
        related_client_id: existing.client_id,
        is_read: false,
      }];

    if (pairedMealPlan) {
      notifications.push({
        user_id: clientUserId,
        type: 'new_meal_plan',
        title: 'Plan alimentar nou',
        message: 'Antrenorul tău ți-a trimis un plan alimentar nou.',
        related_plan_id: pairedMealPlan.id,
        related_client_id: existing.client_id,
        is_read: false,
      });
    }

    const { error: notificationError } = await supabase
      .from('notifications')
      .insert(notifications);
    if (notificationError) {
      console.error('[workout-plans PATCH] Eroare la notificarea clientului:', notificationError.message);
    }
  }

  logActivity({
    action: 'workout_plan.approve',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { planId: id, clientId: existing.client_id },
  });

  return NextResponse.json({ workoutPlan: approved, mealPlan: pairedMealPlan });
}
