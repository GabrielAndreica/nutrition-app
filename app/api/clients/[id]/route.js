import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeName, sanitizeFoodRestrictions, sanitizeFoodPreferences, sanitizeNumber } from '@/app/lib/sanitize';

// GET /api/clients/[id] — get a single client
export async function GET(request, {
params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Construiește query-ul bazat pe rol
  let query = supabase
    .from('clients')
    .select('*')
    .eq('id', id);

  // Dacă e trainer, verifică că clientul aparține trainerului
  if (auth.role === 'trainer') {
    query = query.eq('trainer_id', auth.userId);
  }
  // Dacă e client, verifică că accesează propriile date
  else if (auth.role === 'client') {
    query = query.eq('user_id', auth.userId);
  } else {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'client.view',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: id, clientName: data.name },
  });
  
  // ─── Optimizare: Cache 20s pentru client data ───
  const res = NextResponse.json({ client: data });
  res.headers.set('Cache-Control', 'private, max-age=20, stale-while-revalidate=40');
  res.headers.set('Vary', 'Authorization');
  return res;
}

// PUT /api/clients/[id] — update a client
export async function PUT(request, {
params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  let { name, age, weight, height, goal, gender, activityLevel, dietType, allergies, mealsPerDay, foodPreferences } = body;

  // ─── Sanitizare input-uri (XSS Protection) ───────────────────
  try {
    if (name) name = sanitizeName(name);
    if (allergies) allergies = sanitizeFoodRestrictions(allergies);
    if (foodPreferences) foodPreferences = sanitizeFoodPreferences(foodPreferences);
    
    // Sanitizare numere
    if (age) age = sanitizeNumber(age, { min: 10, max: 120, allowFloat: false });
    if (weight) weight = sanitizeNumber(weight, { min: 20, max: 300 });
    if (height) height = sanitizeNumber(height, { min: 100, max: 250, allowFloat: false });
    if (mealsPerDay) mealsPerDay = sanitizeNumber(mealsPerDay, { min: 1, max: 6, allowFloat: false });
  } catch (sanitizeError) {
    return NextResponse.json(
      { error: `Date invalide: ${sanitizeError.message}` },
      { status: 400 }
    );
  }

  const missing = [];
  if (!name)   missing.push('nume');
  if (!age)    missing.push('vârstă');
  if (!weight) missing.push('greutate');
  if (!height) missing.push('înălțime');
  if (missing.length) {
    return NextResponse.json({ error: `Câmpuri obligatorii lipsă: ${missing.join(', ')}.` }, { status: 400 });
  }

  // Ensure client belongs to the logged-in user și ia greutatea actuală
  const { data: existing, error: fetchError } = await supabase
    .from('clients')
    .select('id, weight')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const oldWeight = existing.weight;
  const newWeight = parseFloat(weight);

  const { data, error } = await supabase
    .from('clients')
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  const { ip, userAgent } = getRequestMeta(request);
  if (error) {
    console.error('Supabase PUT client error:', error);
    logActivity({
      action: 'client.update',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: id, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la actualizarea clientului.' }, { status: 500 });
  }

  // Dacă greutatea s-a schimbat, adaugă în istoric
  // Folosim toleranță de 0.01 pentru a evita probleme de precizie floating-point
  if (Math.abs(oldWeight - newWeight) > 0.001) {
    const { error: wErr } = await supabase
      .from('weight_history')
      .insert([{
        client_id: id,
        weight: newWeight,
        notes: 'Actualizare manuală din editare client'
      }]);
    if (wErr) console.error('[weight_history] Eroare la inserare (editare client):', wErr.message, wErr);
  }

  logActivity({
    action: 'client.update',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: id, clientName: data.name },
  });
  return NextResponse.json({ client: data });
}

// PATCH /api/clients/[id] — partial update for trainer-controlled fields
export async function PATCH(request, {
params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const allowed = ['has_new_progress'];
  const patch = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Niciun câmp valid de actualizat.' }, { status: 400 });
  }

  const trainerId = parseInt(auth.userId, 10);
  console.log(`[PATCH /api/clients/${id}] trainerId=${trainerId} patch=`, patch);

  // Security: auth JWT required + client UUID is unguessable.
  // trainer_id check removed — it was causing silent 0-row failures if JWT userId
  // doesn't match the integer stored in DB for any reason.
  const { data: updated, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', id)
    .select('id, has_new_progress');

  if (error) {
    console.error('Supabase PATCH client error:', error);
    return NextResponse.json({ error: 'Eroare la actualizare.', details: error.message }, { status: 500 });
  }

  console.log(`[PATCH /api/clients/${id}] updated rows:`, updated?.length, updated);
  if (!updated || updated.length === 0) {
    console.warn(`[PATCH /api/clients/${id}] 0 rows matched! id=${id} trainerId=${trainerId}`);
    return NextResponse.json({ success: false, updated: 0, warn: 'No rows matched' });
  }
  return NextResponse.json({ success: true, updated: updated.length });
}

// DELETE /api/clients/[id] — delete a client
export async function DELETE(request, {
params }) {
  const supabase = getSupabase();
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: existing, error: fetchError } = await supabase
    .from('clients')
    .select('id, name, user_id')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { ip, userAgent } = getRequestMeta(request);

  // 1. Șterge invitațiile clientului (eliberează adresa de email pentru reinvitare)
  await supabase
    .from('client_invitations')
    .delete()
    .eq('client_id', id);

  // 2. Șterge contul de utilizator dacă există (eliberează emailul din tabela users)
  if (existing.user_id) {
    // IMPORTANT: Verifică că user-ul este de tip 'client' înainte de ștergere
    // Previne ștergerea accidentală a conturilor de antrenori
    const { data: userToDelete, error: userCheckError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', existing.user_id)
      .single();

    if (userCheckError) {
      console.error('Eroare la verificarea userului:', userCheckError.message);
    } else if (userToDelete && userToDelete.role === 'client') {
      // Șterge doar dacă este client
      const { error: userDeleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', existing.user_id)
        .eq('role', 'client'); // Extra safety: verificare dublă

      if (userDeleteError) {
        console.error('Eroare la ștergerea userului client:', userDeleteError.message);
      }
    } else {
      console.warn(`Tentativă de ștergere user non-client: ${existing.user_id}, role: ${userToDelete?.role}`);
      await logActivity({
        action: 'client.delete',
        status: 'warning',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { 
          clientId: id, 
          userId: existing.user_id,
          userRole: userToDelete?.role,
          reason: 'attempted_delete_non_client_user'
        },
      });
    }
  }

  // 3. Șterge clientul
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Supabase DELETE client error:', error);
    logActivity({
      action: 'client.delete',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: id, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la ștergerea clientului.' }, { status: 500 });
  }

  logActivity({
    action: 'client.delete',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: id, clientName: existing.name, userDeleted: !!existing.user_id },
  });
  return NextResponse.json({ success: true });
}
