import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import bcrypt from 'bcrypt';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

export async function PATCH(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { ip, userAgent } = getRequestMeta(request);

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'auth-profile-patch',
    maxRequests: 20,
    windowMinutes: 10,
  });
  if (rateLimit) return rateLimit;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const { name, email, currentPassword, newPassword } = body;

  // Validări de bază
  if (name !== undefined && (!name || name.trim().length < 2)) {
    return NextResponse.json({ error: 'Numele trebuie să aibă cel puțin 2 caractere.' }, { status: 400 });
  }
  if (email !== undefined) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Format email invalid.' }, { status: 400 });
    }
  }
  if (newPassword !== undefined && newPassword.length < 8) {
    return NextResponse.json({ error: 'Parola nouă trebuie să aibă cel puțin 8 caractere.' }, { status: 400 });
  }

  // Aduce userul curent
  const { data: currentUser, error: fetchError } = await supabase
    .from('users')
    .select('id, name, email, password')
    .eq('id', auth.userId)
    .single();

  if (fetchError || !currentUser) {
    await logActivity({
      action: 'auth.profile_update',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'user_not_found' },
    });
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  // Dacă schimbă parola, verifică parola curentă
  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Introdu parola curentă pentru a schimba parola.' }, { status: 400 });
    }
    const match = await bcrypt.compare(currentPassword, currentUser.password);
    if (!match) {
      await logActivity({
        action: 'auth.profile_update',
        status: 'failure',
        userId: auth.userId,
        email: currentUser.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'wrong_current_password', attemptedFields: ['password'] },
      });
      return NextResponse.json({ error: 'Parola curentă este incorectă.' }, { status: 400 });
    }
  }

  // Dacă schimbă emailul, verifică să nu fie deja folosit
  if (email && email !== currentUser.email) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    if (existing) {
      await logActivity({
        action: 'auth.profile_update',
        status: 'failure',
        userId: auth.userId,
        email: currentUser.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'email_exists', attemptedFields: ['email'] },
      });
      return NextResponse.json({ error: 'Acest email este deja folosit.' }, { status: 400 });
    }
  }

  // Construiește obiectul de update
  const updates = {};
  if (name) updates.name = name.trim();
  if (email) updates.email = email.toLowerCase().trim();
  if (newPassword) updates.password = await bcrypt.hash(newPassword, 12);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nicio modificare de salvat.' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update(updates)
    .eq('id', auth.userId);

  if (updateError) {
    await logActivity({
      action: 'auth.profile_update',
      status: 'error',
      userId: auth.userId,
      email: currentUser.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'db_error', error: updateError.message },
    });
    return NextResponse.json({ error: 'Eroare la salvarea datelor.' }, { status: 500 });
  }

  // Sincronizează numele și în tabelul clients (vizibil în dashboard-ul antrenorului)
  if (updates.name) {
    await supabase
      .from('clients')
      .update({ name: updates.name })
      .eq('user_id', auth.userId);

    // Actualizează și clientName din JSON-ul planurilor deja generate
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', auth.userId)
      .single();

    if (clientRow?.id) {
      // meal_plans
      const { data: mealPlans } = await supabase
        .from('meal_plans')
        .select('id, plan_data')
        .eq('client_id', clientRow.id);

      if (mealPlans?.length) {
        await Promise.all(mealPlans.map(p =>
          supabase.from('meal_plans').update({
            plan_data: { ...p.plan_data, clientName: updates.name }
          }).eq('id', p.id)
        ));
      }

      // workout_plans
      const { data: workoutPlans } = await supabase
        .from('workout_plans')
        .select('id, plan_data')
        .eq('client_id', clientRow.id);

      if (workoutPlans?.length) {
        await Promise.all(workoutPlans.map(p =>
          supabase.from('workout_plans').update({
            plan_data: { ...p.plan_data, clientName: updates.name }
          }).eq('id', p.id)
        ));
      }
    }
  }

  await logActivity({
    action: 'auth.profile_update',
    status: 'success',
    userId: auth.userId,
    email: updates.email || currentUser.email,
    ipAddress: ip,
    userAgent,
    details: {
      changedFields: Object.keys(updates).map((field) => field === 'password' ? 'password' : field),
    },
  });

  return NextResponse.json({
    success: true,
    user: {
      id: auth.userId,
      name: updates.name || currentUser.name,
      email: updates.email || currentUser.email,
    },
  });
}
