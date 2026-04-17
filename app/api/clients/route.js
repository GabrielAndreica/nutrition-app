import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeName, sanitizeText, sanitizeFoodRestrictions, sanitizeFoodPreferences, sanitizeNumber } from '@/app/lib/sanitize';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/clients — list clients with pagination, server-side search and latest plan per client
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'trainer') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  // ─── Database Rate Limiting ────────────────────────────────
  try {
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc('check_rate_limit', {
        p_user_id: String(auth.userId),
        p_endpoint: 'clients-list',
        p_max_requests: 1000,  // Max 1000 requests per 15 min (relaxed for load)
        p_window_minutes: 15
      });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
    } else if (rateLimitResult && rateLimitResult.length > 0) {
      const { allowed, remaining } = rateLimitResult[0];
      
      if (!allowed) {
        return NextResponse.json(
          { error: 'Prea multe cereri. Încearcă din nou în câteva minute.' },
          { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }
        );
      }
    }
  } catch (err) {
    console.error('Rate limit exception:', err);
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim() || '';
  const page   = Math.max(1, parseInt(searchParams.get('page')  || '1',  10));
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  // Build clients query with invitation status
  let clientsQuery = supabase
    .from('clients')
    .select(
      `id, name, age, weight, height, goal, gender, activity_level, diet_type, allergies, meals_per_day, food_preferences, created_at, user_id,
       client_invitations!client_invitations_client_id_fkey(
         id,
         status,
         client_email,
         created_at
       )`,
      { count: 'exact' }
    )
    .eq('trainer_id', auth.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    clientsQuery = clientsQuery.ilike('name', `%${search}%`);
  }

  // Run queries IN PARALLEL — plans + recent client progress submissions + trainer responses
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [clientsResult, plansResult, progressResult, notificationsResult] = await Promise.all([
    clientsQuery,
    supabase
      .from('meal_plans')
      .select('id, client_id, created_at')
      .eq('trainer_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('weight_history')
      .select('client_id, recorded_at')
      .like('notes', '[CLIENT]%')
      .gte('recorded_at', sevenDaysAgo)
      .order('recorded_at', { ascending: false }),
    supabase
      .from('notifications')
      .select('related_client_id, created_at, type')
      .in('type', ['plan_continued', 'new_meal_plan'])
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false }),
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
        planMap[plan.client_id] = { planId: plan.id, createdAt: plan.created_at };
      }
    }
  }

  // Build map of client_ids with latest progress submission time
  const progressMap = {};
  if (progressResult.data) {
    for (const entry of progressResult.data) {
      if (!progressMap[entry.client_id]) {
        progressMap[entry.client_id] = entry.recorded_at;
      }
    }
  }

  // Build map of client_ids with latest trainer response (notification)
  const trainerResponseMap = {};
  if (notificationsResult.data) {
    for (const notif of notificationsResult.data) {
      const clientId = notif.related_client_id;
      if (clientId && !trainerResponseMap[clientId]) {
        trainerResponseMap[clientId] = notif.created_at;
      }
    }
  }

  // Process clients and add invitation status + progress flag
  const processedClients = (clientsResult.data || []).map(client => {
    const pendingInvite = client.client_invitations?.find(inv => inv.status === 'pending');
    const latestProgressDate = progressMap[client.id];
    const latestResponseDate = trainerResponseMap[client.id];
    
    // has_new_progress = true only if progress exists AND trainer hasn't responded yet
    const hasNewProgress = latestProgressDate && (!latestResponseDate || new Date(latestProgressDate) > new Date(latestResponseDate));
    
    return {
      ...client,
      invitation_status: client.user_id ? 'accepted' : (pendingInvite ? 'pending' : null),
      invitation_email: pendingInvite?.client_email || null,
      client_invitations: undefined, // Remove array from response
      has_new_progress: hasNewProgress,
    };
  });

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
    clients: processedClients,
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
  if (auth.role !== 'trainer') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  // ─── Sanitizare input-uri (XSS Protection) ───────────────────
  try {
    if (body.name) body.name = sanitizeName(body.name);
    if (body.allergies) body.allergies = sanitizeFoodRestrictions(body.allergies);
    if (body.foodPreferences) body.foodPreferences = sanitizeFoodPreferences(body.foodPreferences);
    
    // Sanitizare numere
    if (body.age) body.age = sanitizeNumber(body.age, { min: 10, max: 120, allowFloat: false });
    if (body.weight) body.weight = sanitizeNumber(body.weight, { min: 20, max: 300 });
    if (body.height) body.height = sanitizeNumber(body.height, { min: 100, max: 250, allowFloat: false });
    if (body.mealsPerDay) body.mealsPerDay = sanitizeNumber(body.mealsPerDay, { min: 1, max: 6, allowFloat: false });
  } catch (sanitizeError) {
    return NextResponse.json(
      { error: `Date invalide: ${sanitizeError.message}` },
      { status: 400 }
    );
  }

  const { name, age, weight, height, goal, gender, activityLevel, dietType, allergies, mealsPerDay, foodPreferences } = body;

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
      food_preferences: foodPreferences || null,
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

  // Adaugă greutatea inițială în istoricul de greutate
  const { error: wErr } = await supabase
    .from('weight_history')
    .insert([{
      client_id: data.id,
      weight: parseFloat(weight),
      notes: 'Greutate inițială la înregistrare'
    }]);
  if (wErr) console.error('[weight_history] Eroare la inserare (client nou):', wErr.message, wErr);

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
