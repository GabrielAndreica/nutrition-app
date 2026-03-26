import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/clients — list clients with pagination, server-side search and latest plan per client
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim() || '';
  const page   = Math.max(1, parseInt(searchParams.get('page')  || '1',  10));
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  // Build clients query
  let clientsQuery = supabase
    .from('clients')
    .select(
      'id, name, age, weight, height, goal, gender, activity_level, diet_type, allergies, meals_per_day, created_at',
      { count: 'exact' }
    )
    .eq('trainer_id', auth.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    clientsQuery = clientsQuery.ilike('name', `%${search}%`);
  }

  // Run both queries IN PARALLEL — plans filtered only by trainer_id (3 small columns)
  // This cuts total latency from sum(q1+q2) to max(q1,q2)
  const [clientsResult, plansResult] = await Promise.all([
    clientsQuery,
    supabase
      .from('meal_plans')
      .select('id, client_id')
      .eq('trainer_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  if (clientsResult.error) {
    console.error('Supabase GET clients error:', clientsResult.error);
    const { ip, userAgent } = getRequestMeta(request);
    logActivity({
      action: 'client.list',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { error: clientsResult.error.message },
    });
    return NextResponse.json({ error: 'Eroare la încărcarea clienților.' }, { status: 500 });
  }

  // Build planMap — first occurrence per client_id is the most recent (ordered desc)
  const planMap = {};
  if (plansResult.data) {
    for (const plan of plansResult.data) {
      if (!planMap[plan.client_id]) {
        planMap[plan.client_id] = { planId: plan.id };
      }
    }
  }

  const total      = clientsResult.count || 0;
  const totalPages = Math.ceil(total / limit);

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'client.list',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { page, search: search || null, total },
  });

  const res = NextResponse.json({
    clients: clientsResult.data || [],
    plans: planMap,
    total,
    page,
    limit,
    totalPages,
  });

  // Cache is keyed per-user via Vary: Authorization — different tokens = different cache entries.
  // max-age=15: same user navigating back sees instant load; after 15s a fresh fetch is made.
  res.headers.set('Cache-Control', 'private, max-age=15');
  res.headers.set('Vary', 'Authorization');
  return res;
}

// POST /api/clients — create a new client
export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const { name, age, weight, height, goal, gender, activityLevel, dietType, allergies, mealsPerDay } = body;

  const missing = [];
  if (!name)          missing.push('nume');
  if (!age)           missing.push('vârstă');
  if (!weight)        missing.push('greutate');
  if (!height)        missing.push('înălțime');
  if (missing.length) {
    return NextResponse.json({ error: `Câmpuri obligatorii lipsă: ${missing.join(', ')}.` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('clients')
    .insert([{
      trainer_id: auth.userId,
      name,
      age: parseInt(age),
      weight: parseFloat(weight),
      height: parseFloat(height),
      goal: goal || 'maintenance',
      gender: gender || 'M',
      activity_level: activityLevel || 'moderate',
      diet_type: dietType || 'omnivore',
      allergies: allergies || null,
      meals_per_day: parseInt(mealsPerDay) || 3,
    }])
    .select()
    .single();

  const { ip, userAgent } = getRequestMeta(request);
  if (error) {
    console.error('Supabase POST client error:', error);
    logActivity({
      action: 'client.create',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientName: name, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la salvarea clientului.' }, { status: 500 });
  }

  logActivity({
    action: 'client.create',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: data.id, clientName: data.name },
  });
  return NextResponse.json({ client: data }, { status: 201 });
}
