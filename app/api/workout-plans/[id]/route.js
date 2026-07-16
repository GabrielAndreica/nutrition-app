import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

const MAX_WORKOUT_PLAN_BODY_BYTES = 256 * 1024;
const MAX_WORKOUT_PLAN_DAYS = 14;
const MAX_WORKOUT_PLAN_EXERCISES = 240;

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

function countPlanExercises(planData) {
  if (!Array.isArray(planData?.days)) return 0;
  return planData.days.reduce((total, day) => {
    if (!Array.isArray(day?.exercises)) return total;
    return total + day.exercises.length;
  }, 0);
}

export async function GET(request, { params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'workout-plan-detail',
    maxRequests: 90,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

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

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'workout-plan-update',
    maxRequests: 20,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request, MAX_WORKOUT_PLAN_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
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

  if (
    body.plan_data.days.length > MAX_WORKOUT_PLAN_DAYS ||
    countPlanExercises(body.plan_data) > MAX_WORKOUT_PLAN_EXERCISES
  ) {
    return NextResponse.json({ error: 'Planul este prea mare.' }, { status: 413 });
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

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'workout-plan-delete',
    maxRequests: 20,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

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
