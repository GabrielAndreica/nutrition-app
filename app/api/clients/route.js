import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeName, sanitizeText, sanitizeFoodRestrictions, sanitizeFoodPreferences, sanitizeNumber } from '@/app/lib/sanitize';

const mapActivityToWorkouts = (activityLevel) => ({
  sedentary: 2,
  light: 2,
  lightly_active: 2,
  moderate: 4,
  moderately_active: 4,
  active: 5,
  very_active: 5,
  extra_active: 5,
}[activityLevel] || 4);

const ALLOWED_TRAINING_SPLITS = new Set(['Full Body', 'Push/Pull/Legs', 'Upper/Lower', 'Bro Split']);

const normalizeTrainingSplit = (split) => {
  const raw = String(split || '')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .trim();
  if (!raw) return null;
  const value = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const compact = value.replace(/[\s_\-/]+/g, '');

  if (
    ['full body', 'fullbody', 'full-body', 'corp complet', 'tot corpul', 'total body', 'totalbody'].includes(value)
    || compact === 'fullbody'
    || compact === 'corpcomplet'
    || compact === 'totcorpul'
  ) return 'Full Body';

  if (
    ['push/pull/legs', 'push pull legs', 'push-pull-legs', 'push_pull_legs', 'ppl'].includes(value)
    || compact === 'pushpulllegs'
    || compact === 'ppl'
  ) return 'Push/Pull/Legs';

  if (
    ['upper/lower', 'upper lower', 'upper-lower', 'upper_lower'].includes(value)
    || compact === 'upperlower'
  ) return 'Upper/Lower';

  if (
    ['bro split', 'bro-split', 'bro_split', 'brosplit'].includes(value)
    || compact === 'brosplit'
  ) return 'Bro Split';

  if (ALLOWED_TRAINING_SPLITS.has(raw)) return raw;
  return null;
};

// GET /api/clients — list clients with pagination, server-side search and latest plan per client
export async function GET(request) {
  const supabase = getSupabase();
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

  // ─── Optimizare: Single query cu LEFT JOINs pentru toate relațiile ───────
  let clientsQuery = supabase
    .from('clients')
    .select(
      `id, name, age, weight, height, goal, gender, activity_level, diet_type, allergies, meals_per_day, food_preferences,
       training_split, workouts_per_week, fitness_level, available_equipment, fitness_goal, injuries_limitations, workout_preferences,
       created_at, user_id, has_new_progress,
       client_invitations!client_invitations_client_id_fkey(id, status, client_email, created_at)`,
      { count: 'exact' }
    )
    .eq('trainer_id', auth.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    clientsQuery = clientsQuery.ilike('name', `%${search}%`);
  }

  // Run queries IN PARALLEL — optimizat pentru speed
  const [clientsResult, plansResult, workoutPlansResult] = await Promise.all([
    clientsQuery,
    // Optimizare: Doar ultimul plan per client (folosește DISTINCT ON în Postgres)
    supabase
      .from('meal_plans')
      .select('id, client_id, created_at')
      .eq('trainer_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('workout_plans')
      .select('id, client_id, created_at')
      .eq('trainer_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(500),
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

  const workoutPlanMap = {};
  if (workoutPlansResult.data) {
    for (const plan of workoutPlansResult.data) {
      if (!workoutPlanMap[plan.client_id]) {
        workoutPlanMap[plan.client_id] = { planId: plan.id, createdAt: plan.created_at };
      }
    }
  }

  // Process clients and add invitation status (has_new_progress comes directly from DB column)
  const processedClients = (clientsResult.data || []).map(client => {
    const pendingInvite = client.client_invitations?.find(inv => inv.status === 'pending');
    return {
      ...client,
      invitation_status: client.user_id ? 'accepted' : (pendingInvite ? 'pending' : null),
      invitation_email: pendingInvite?.client_email || null,
      client_invitations: undefined,
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

  return NextResponse.json({
    clients: processedClients,
    plans: planMap,
    workoutPlans: workoutPlanMap,
    total,
    page,
    limit,
    totalPages,
  });
}

// POST /api/clients — create a new client
export async function POST(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'trainer') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  // ─── Database Rate Limiting ────────────────────────────────
  try {
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc('check_rate_limit', {
        p_user_id: String(auth.userId),
        p_endpoint: 'create-client',
        p_max_requests: 50,  // Max 50 clienți noi per oră
        p_window_minutes: 60
      });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
    } else if (rateLimitResult && rateLimitResult.length > 0) {
      const { allowed, remaining, reset_at } = rateLimitResult[0];
      
      if (!allowed) {
        const resetDate = new Date(reset_at);
        const minutesRemaining = Math.ceil((resetDate - new Date()) / 60000);
        return NextResponse.json(
          { error: `Ai atins limita de 50 clienți noi per oră. Încearcă din nou în ${minutesRemaining} minute.` },
          { status: 429, headers: { 'Retry-After': String(minutesRemaining * 60) } }
        );
      }
    }
  } catch (err) {
    console.error('Rate limit exception:', err);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  // ─── Subscription check (live din DB, nu din JWT stale) ───────────────────
  const { checkSubscription } = await import('@/app/lib/checkSubscription');
  const sub = await checkSubscription(auth.userId);
  if (!sub.allowed) return sub.response;

  // ─── Client Limit — atomic check-and-reserve în DB (previne race condition) ─
  // Pentru trial: limita se aplică pe total_clients_created (nu scade la ștergere)
  // Pentru paid: limita se aplică pe clienți activi
  {
    let maxClients = sub.maxClients;

    let limitReached = false;
    if (sub.status === 'trial') {
      // Atomic: incrementează DOAR dacă sub limită — un singur query, fără race
      const { data: incremented, error: incErr } = await supabase
        .rpc('try_increment_clients_created', {
          p_user_id: String(auth.userId),
          p_max_count: maxClients,
        });
      if (incErr) {
        console.error('[client limit] rpc error:', incErr.message);
        // Fail-safe: blochăm dacă RPC nu există (forțează deploy SQL)
        return NextResponse.json({ error: 'Eroare internă la verificarea limitei.' }, { status: 500 });
      }
      if (!incremented) limitReached = true;
    } else {
      // Paid: verifică clienți activi
      const { count: activeCount } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('trainer_id', auth.userId);
      if ((activeCount ?? 0) >= maxClients) limitReached = true;
    }

    if (limitReached) {
      const planLabel = sub.status === 'trial'
        ? `trial (maxim ${maxClients} clienți, inclusiv cei șterși)`
        : sub.plan === 'pro' ? 'Pro' : 'Starter';
      return NextResponse.json(
        {
          error: `Ai atins limita de ${maxClients} client${maxClients === 1 ? '' : 'i'} pentru planul ${planLabel}. Fă upgrade pentru mai mulți clienți.`,
          code: 'CLIENT_LIMIT_REACHED',
          limit: maxClients,
        },
        { status: 403 }
      );
    }
  }

  // ─── Sanitizare input-uri (XSS Protection) ───────────────────
  try {
    if (body.name) body.name = sanitizeName(body.name);
    if (body.allergies) body.allergies = sanitizeFoodRestrictions(body.allergies);
    if (body.foodPreferences) body.foodPreferences = sanitizeFoodPreferences(body.foodPreferences);
    if (body.injuriesLimitations) body.injuriesLimitations = sanitizeText(body.injuriesLimitations);
    if (body.workoutPreferences) body.workoutPreferences = sanitizeText(body.workoutPreferences);
    
    // Sanitizare numere
    if (body.age) body.age = sanitizeNumber(body.age, { min: 10, max: 120, allowFloat: false });
    if (body.weight) body.weight = sanitizeNumber(body.weight, { min: 20, max: 300 });
    if (body.height) body.height = sanitizeNumber(body.height, { min: 100, max: 250, allowFloat: false });
    if (body.mealsPerDay) body.mealsPerDay = sanitizeNumber(body.mealsPerDay, { min: 1, max: 6, allowFloat: false });
    if (body.workoutsPerWeek) body.workoutsPerWeek = sanitizeNumber(body.workoutsPerWeek, { min: 2, max: 5, allowFloat: false });
  } catch (sanitizeError) {
    return NextResponse.json(
      { error: `Date invalide: ${sanitizeError.message}` },
      { status: 400 }
    );
  }

  const { name, age, weight, height, goal, gender, activityLevel, dietType, allergies, mealsPerDay, foodPreferences } = body;
  const resolvedWorkoutsPerWeek = body.workoutsPerWeek
    ? parseInt(body.workoutsPerWeek)
    : mapActivityToWorkouts(activityLevel || 'moderate');
  const resolvedTrainingSplit = normalizeTrainingSplit(body.trainingSplit);

  const missing = [];
  if (!name)          missing.push('nume');
  if (!age)           missing.push('vârstă');
  if (!weight)        missing.push('greutate');
  if (!height)        missing.push('înălțime');
  if (!resolvedTrainingSplit) missing.push('split antrenament');
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
      meals_per_day: parseInt(mealsPerDay) || 5,
      food_preferences: foodPreferences || null,
      training_split: resolvedTrainingSplit,
      workouts_per_week: resolvedWorkoutsPerWeek,
      fitness_level: body.fitnessLevel || 'beginner',
      available_equipment: body.availableEquipment || 'full gym',
      fitness_goal: body.fitnessGoal || 'muscle gain',
      injuries_limitations: body.injuriesLimitations || null,
      workout_preferences: body.workoutPreferences || null,
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

  // Nota: total_clients_created a fost deja incrementat atomic mai sus (try_increment_clients_created)
  // Nu mai e nevoie de un al doilea increment aici.

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
